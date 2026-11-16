use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer, RingBuffer};

use crate::audio::{open_output_stream, AudioStreamConfig, AudioStreamHandle};
use crate::midi::{open_midi_input, MidiEvent, MidiInputHandle};
use crate::sampler::{load_built_in_banks, SampleBank};
use crate::voice::VoicePool;
use crate::EngineError;

const MIDI_QUEUE_CAP: usize = 1024;
const CTRL_QUEUE_CAP: usize = 128;
const BANK_QUEUE_CAP: usize = 16;

/// Summary of the current sound bank for UI display.
#[derive(Debug, Clone)]
pub struct SoundInfo {
    pub id: String,
    pub name: String,
}

/// Live telemetry snapshot from the engine.
#[derive(Debug, Clone)]
pub struct EngineStatus {
    pub audio_device: String,
    pub sample_rate: u32,
    pub buffer_size: Option<u32>,
    pub estimated_latency_ms: f32,
    pub midi_device: Option<String>,
    pub active_sound_id: String,
    pub master_volume: f32,
    pub is_playing: bool,
    pub active_voices: usize,
}

/// Coordinates MIDI input, sample bank loading, and the real-time audio stream.
pub struct TaktEngine {
    banks: Vec<Arc<SampleBank>>,
    active_bank_idx: usize,
    audio_config: AudioStreamConfig,
    audio_handle: Option<AudioStreamHandle>,
    midi_handle: Option<MidiInputHandle>,
    midi_tx: Option<Producer<MidiEvent>>,
    ctrl_tx: Producer<MidiEvent>,
    bank_tx: Producer<Arc<SampleBank>>,
    reclaim_rx: Consumer<Arc<SampleBank>>,
    master_volume: Arc<AtomicU32>,
    is_playing: Arc<AtomicBool>,
    active_voices: Arc<AtomicUsize>,
}

impl TaktEngine {
    /// Creates the engine, loads built-in sound banks into memory, and starts the default audio stream.
    pub fn new(samples_dir: Option<&Path>) -> Result<Self, EngineError> {
        let banks: Vec<Arc<SampleBank>> = load_built_in_banks(samples_dir)
            .into_iter()
            .map(Arc::new)
            .collect();

        let (ctrl_tx, _ctrl_rx) = RingBuffer::new(CTRL_QUEUE_CAP);
        let (bank_tx, _bank_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (_reclaim_tx, reclaim_rx) = RingBuffer::new(BANK_QUEUE_CAP);

        let mut engine = Self {
            banks,
            active_bank_idx: 0,
            audio_config: AudioStreamConfig::default(),
            audio_handle: None,
            midi_handle: None,
            midi_tx: None,
            ctrl_tx,
            bank_tx,
            reclaim_rx,
            master_volume: Arc::new(AtomicU32::new(0.8_f32.to_bits())),
            is_playing: Arc::new(AtomicBool::new(false)),
            active_voices: Arc::new(AtomicUsize::new(0)),
        };

        engine.restart_audio_stream()?;
        Ok(engine)
    }

    pub fn sounds(&self) -> Vec<SoundInfo> {
        self.banks
            .iter()
            .map(|b| SoundInfo {
                id: b.id.clone(),
                name: b.name.clone(),
            })
            .collect()
    }

    /// Selects the audio output device and optional buffer size, restarting the stream cleanly.
    pub fn select_audio_output(
        &mut self,
        device_name: Option<String>,
        buffer_size: Option<u32>,
    ) -> Result<(), EngineError> {
        let prev_midi = self.midi_handle.as_ref().map(|m| m.device_name.clone());
        self.audio_config = AudioStreamConfig {
            device_name,
            buffer_size,
        };
        self.restart_audio_stream()?;
        if let Some(midi_name) = prev_midi {
            let _ = self.select_midi_input(Some(midi_name));
        }
        Ok(())
    }

    /// Connects to a MIDI input device by name, or disconnects if `None`.
    pub fn select_midi_input(&mut self, device_name: Option<String>) -> Result<(), EngineError> {
        self.panic();
        self.midi_handle = None;

        let Some(name) = device_name else {
            return Ok(());
        };

        self.restart_audio_stream()?;
        let mut prod = self
            .midi_tx
            .take()
            .ok_or_else(|| EngineError::StreamError("MIDI producer unavailable".to_string()))?;

        let handle = open_midi_input(&name, move |event| {
            let _ = prod.push(event);
        })?;
        self.midi_handle = Some(handle);
        Ok(())
    }

    /// Switches the active built-in sound without allocating or dropping on the audio thread.
    pub fn select_sound(&mut self, sound_id: &str) -> Result<(), EngineError> {
        let idx = self
            .banks
            .iter()
            .position(|b| b.id == sound_id)
            .ok_or_else(|| EngineError::SampleLoad(format!("unknown sound: {sound_id}")))?;
        self.active_bank_idx = idx;
        self.drain_reclaimed_banks();
        let _ = self.bank_tx.push(Arc::clone(&self.banks[idx]));
        Ok(())
    }

    pub fn set_master_volume(&self, volume: f32) {
        let clamped = volume.clamp(0.0, 1.5);
        self.master_volume.store(clamped.to_bits(), Ordering::Relaxed);
    }

    /// Sends an immediate All Notes Off / sustain-reset to the audio thread.
    pub fn panic(&mut self) {
        let _ = self.ctrl_tx.push(MidiEvent::AllNotesOff);
    }

    /// Injects a MIDI event directly (useful for testing and soak harnesses).
    pub fn inject_midi_event(&mut self, event: MidiEvent) {
        let _ = self.ctrl_tx.push(event);
    }

    pub fn status(&mut self) -> EngineStatus {
        self.drain_reclaimed_banks();
        let (audio_device, sample_rate, buffer_size, estimated_latency_ms) =
            match &self.audio_handle {
                Some(h) => (
                    h.device_name.clone(),
                    h.sample_rate,
                    h.buffer_size,
                    h.estimated_latency_ms,
                ),
                None => ("None".to_string(), 44_100, None, 0.0),
            };

        EngineStatus {
            audio_device,
            sample_rate,
            buffer_size,
            estimated_latency_ms,
            midi_device: self.midi_handle.as_ref().map(|m| m.device_name.clone()),
            active_sound_id: self.banks[self.active_bank_idx].id.clone(),
            master_volume: f32::from_bits(self.master_volume.load(Ordering::Relaxed)),
            is_playing: self.is_playing.load(Ordering::Relaxed),
            active_voices: self.active_voices.load(Ordering::Relaxed),
        }
    }

    fn drain_reclaimed_banks(&mut self) {
        while let Ok(old_bank) = self.reclaim_rx.pop() {
            drop(old_bank);
        }
    }

    fn restart_audio_stream(&mut self) -> Result<(), EngineError> {
        self.audio_handle = None;
        self.drain_reclaimed_banks();

        let (midi_tx, mut midi_rx) = RingBuffer::new(MIDI_QUEUE_CAP);
        let (ctrl_tx, mut ctrl_rx) = RingBuffer::new(CTRL_QUEUE_CAP);
        let (bank_tx, mut bank_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (mut reclaim_tx, reclaim_rx) = RingBuffer::new(BANK_QUEUE_CAP);

        self.midi_tx = Some(midi_tx);
        self.ctrl_tx = ctrl_tx;
        self.bank_tx = bank_tx;
        self.reclaim_rx = reclaim_rx;

        let mut active_bank = Arc::clone(&self.banks[self.active_bank_idx]);
        let mut pool = VoicePool::default();
        let volume_atomic = Arc::clone(&self.master_volume);
        let playing_atomic = Arc::clone(&self.is_playing);
        let voices_atomic = Arc::clone(&self.active_voices);

        let handle = open_output_stream(&self.audio_config, move |output, channels, sample_rate| {
            // 1. Check for a new SampleBank; push the old one back for non-RT deallocation.
            while let Ok(new_bank) = bank_rx.pop() {
                pool.handle_event(MidiEvent::AllNotesOff, &active_bank, sample_rate);
                let old_bank = std::mem::replace(&mut active_bank, new_bank);
                let _ = reclaim_tx.push(old_bank);
            }

            // 2. Drain control events (panic, injected test events) and MIDI events.
            while let Ok(ev) = ctrl_rx.pop() {
                pool.handle_event(ev, &active_bank, sample_rate);
            }
            while let Ok(ev) = midi_rx.pop() {
                pool.handle_event(ev, &active_bank, sample_rate);
            }

            // 3. Render active voices.
            let master_vol = f32::from_bits(volume_atomic.load(Ordering::Relaxed));
            let any_active = pool.render(output, channels, sample_rate, master_vol, &active_bank);
            playing_atomic.store(any_active, Ordering::Relaxed);
            voices_atomic.store(pool.active_voice_count(), Ordering::Relaxed);
        })?;

        self.audio_handle = Some(handle);
        Ok(())
    }
}

