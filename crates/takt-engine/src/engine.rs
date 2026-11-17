use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicI8, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer, RingBuffer};

use crate::audio::{open_output_stream, AudioStreamConfig, AudioStreamHandle};
use crate::backing::{synthesize_demo_backing_track, BackingTrackPlayer, WorshipPadPlayer};
use crate::midi::{open_midi_input, MidiEvent, MidiInputHandle};
use crate::sampler::{decode_audio_bytes, discover_banks, LazySampleBank, SampleBank, SampleData};
use crate::voice::{AtomicSoundParams, SoundParams, VoicePool};
use crate::EngineError;

const MIDI_QUEUE_CAP: usize = 1024;
const CTRL_QUEUE_CAP: usize = 128;
const BANK_QUEUE_CAP: usize = 16;

/// Summary of the current sound bank for UI display.
#[derive(Debug, Clone)]
pub struct SoundInfo {
    pub id: String,
    pub name: String,
    pub category: String,
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
    pub active_midi_notes: Vec<u8>,
    pub backing_track_name: Option<String>,
    pub backing_track_playing: bool,
    pub backing_track_loop: bool,
    pub backing_track_volume: f32,
    pub backing_track_position_ms: u32,
    pub backing_track_duration_ms: u32,
    pub worship_pad_enabled: bool,
    pub worship_pad_key: i8,
    pub worship_pad_volume: f32,
    pub sound_params: SoundParams,
}

/// Coordinates MIDI input, sample bank loading, and the real-time audio stream.
pub struct TaktEngine {
    banks: Vec<LazySampleBank>,
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
    midi_active_notes: Arc<[AtomicU64; 2]>,
    // Backing track state
    current_track: Option<Arc<SampleData>>,
    current_track_name: Option<String>,
    track_tx: Producer<Arc<SampleData>>,
    reclaim_track_rx: Consumer<Arc<SampleData>>,
    track_playing: Arc<AtomicBool>,
    track_looping: Arc<AtomicBool>,
    track_volume: Arc<AtomicU32>,
    track_position_ms: Arc<AtomicU32>,
    track_seek_frame: Arc<AtomicI64>,
    // Worship pad state
    pad_enabled: Arc<AtomicBool>,
    pad_key: Arc<AtomicI8>,
    pad_volume: Arc<AtomicU32>,
    sound_params: Arc<AtomicSoundParams>,
}

impl TaktEngine {
    /// Creates the engine, discovers sound banks (loading only the active one), and starts the default audio stream.
    pub fn new(samples_dir: Option<&Path>) -> Result<Self, EngineError> {
        let mut banks = discover_banks(samples_dir);
        if let Some(first) = banks.get_mut(0) {
            let _ = first.get_or_load();
        }

        let (ctrl_tx, _ctrl_rx) = RingBuffer::new(CTRL_QUEUE_CAP);
        let (bank_tx, _bank_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (_reclaim_tx, reclaim_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (track_tx, _track_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (_reclaim_track_tx, reclaim_track_rx) = RingBuffer::new(BANK_QUEUE_CAP);

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
            midi_active_notes: Arc::new([AtomicU64::new(0), AtomicU64::new(0)]),
            current_track: Some(Arc::new(synthesize_demo_backing_track())),
            current_track_name: Some("Demo Groove · 120 BPM (C)".to_string()),
            track_tx,
            reclaim_track_rx,
            track_playing: Arc::new(AtomicBool::new(false)),
            track_looping: Arc::new(AtomicBool::new(true)),
            track_volume: Arc::new(AtomicU32::new(0.75_f32.to_bits())),
            track_position_ms: Arc::new(AtomicU32::new(0)),
            track_seek_frame: Arc::new(AtomicI64::new(-1)),
            pad_enabled: Arc::new(AtomicBool::new(false)),
            pad_key: Arc::new(AtomicI8::new(0)),
            pad_volume: Arc::new(AtomicU32::new(0.55_f32.to_bits())),
            sound_params: Arc::new(AtomicSoundParams::default()),
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
                category: b.category.clone(),
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

    /// Switches the active sound bank (lazy-loading on first use) without allocating or dropping on the audio thread.
    pub fn select_sound(&mut self, sound_id: &str) -> Result<(), EngineError> {
        let idx = self
            .banks
            .iter()
            .position(|b| b.id == sound_id)
            .ok_or_else(|| EngineError::SampleLoad(format!("unknown sound: {sound_id}")))?;
        self.active_bank_idx = idx;
        self.drain_reclaimed_banks();
        let bank = self.banks[idx].get_or_load();
        let _ = self.bank_tx.push(bank);
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

    /// Decodes and loads a backing track (WAV, FLAC, OGG) into memory and queues it to the audio thread.
    pub fn load_backing_track_bytes(
        &mut self,
        name: String,
        bytes: Vec<u8>,
        extension: &str,
    ) -> Result<(), EngineError> {
        let sample = Arc::new(decode_audio_bytes(bytes, extension)?);
        self.drain_reclaimed_banks();
        self.track_playing.store(false, Ordering::Relaxed);
        self.track_position_ms.store(0, Ordering::Relaxed);
        self.current_track = Some(Arc::clone(&sample));
        self.current_track_name = Some(name);
        let _ = self.track_tx.push(sample);
        Ok(())
    }

    pub fn set_backing_track_playing(&self, playing: bool) {
        if self.current_track.is_some() {
            self.track_playing.store(playing, Ordering::Relaxed);
        }
    }

    pub fn set_backing_track_loop(&self, looping: bool) {
        self.track_looping.store(looping, Ordering::Relaxed);
    }

    pub fn set_backing_track_volume(&self, volume: f32) {
        self.track_volume
            .store(volume.clamp(0.0, 1.5).to_bits(), Ordering::Relaxed);
    }

    pub fn seek_backing_track_ms(&self, ms: u32) {
        if let Some(track) = &self.current_track {
            let frame = ((ms as f64 / 1000.0) * track.sample_rate as f64) as i64;
            self.track_seek_frame.store(frame, Ordering::Release);
        }
    }

    pub fn set_worship_pad(&self, enabled: bool, key: i8) {
        self.pad_key.store(key.clamp(0, 11), Ordering::Relaxed);
        self.pad_enabled.store(enabled, Ordering::Relaxed);
    }

    pub fn set_worship_pad_volume(&self, volume: f32) {
        self.pad_volume
            .store(volume.clamp(0.0, 1.5).to_bits(), Ordering::Relaxed);
    }

    pub fn set_sound_params(&self, params: SoundParams) {
        self.sound_params.store(params);
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

        let mut active_midi_notes = Vec::new();
        for (half, atom) in self.midi_active_notes.iter().enumerate() {
            let mut bits = atom.load(Ordering::Relaxed);
            while bits != 0 {
                let bit = bits.trailing_zeros() as u8;
                active_midi_notes.push((half as u8) * 64 + bit);
                bits &= bits - 1;
            }
        }

        let backing_track_duration_ms = self
            .current_track
            .as_ref()
            .map(|t| (t.frames.len() as f64 / t.sample_rate as f64 * 1000.0) as u32)
            .unwrap_or(0);

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
            active_midi_notes,
            backing_track_name: self.current_track_name.clone(),
            backing_track_playing: self.track_playing.load(Ordering::Relaxed),
            backing_track_loop: self.track_looping.load(Ordering::Relaxed),
            backing_track_volume: f32::from_bits(self.track_volume.load(Ordering::Relaxed)),
            backing_track_position_ms: self.track_position_ms.load(Ordering::Relaxed),
            backing_track_duration_ms,
            worship_pad_enabled: self.pad_enabled.load(Ordering::Relaxed),
            worship_pad_key: self.pad_key.load(Ordering::Relaxed),
            worship_pad_volume: f32::from_bits(self.pad_volume.load(Ordering::Relaxed)),
            sound_params: self.sound_params.load(),
        }
    }

    fn drain_reclaimed_banks(&mut self) {
        while let Ok(old_bank) = self.reclaim_rx.pop() {
            drop(old_bank);
        }
        while let Ok(old_track) = self.reclaim_track_rx.pop() {
            drop(old_track);
        }
    }

    fn restart_audio_stream(&mut self) -> Result<(), EngineError> {
        self.audio_handle = None;
        self.drain_reclaimed_banks();

        let (midi_tx, mut midi_rx) = RingBuffer::new(MIDI_QUEUE_CAP);
        let (ctrl_tx, mut ctrl_rx) = RingBuffer::new(CTRL_QUEUE_CAP);
        let (bank_tx, mut bank_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (mut reclaim_tx, reclaim_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (track_tx, track_rx) = RingBuffer::new(BANK_QUEUE_CAP);
        let (reclaim_track_tx, reclaim_track_rx) = RingBuffer::new(BANK_QUEUE_CAP);

        self.midi_tx = Some(midi_tx);
        self.ctrl_tx = ctrl_tx;
        self.bank_tx = bank_tx;
        self.reclaim_rx = reclaim_rx;
        self.track_tx = track_tx;
        self.reclaim_track_rx = reclaim_track_rx;

        let mut active_bank = self.banks[self.active_bank_idx].get_or_load();
        let mut pool = VoicePool::default();
        let mut backing_player = BackingTrackPlayer::new(
            self.current_track.clone(),
            track_rx,
            reclaim_track_tx,
            Arc::clone(&self.track_playing),
            Arc::clone(&self.track_looping),
            Arc::clone(&self.track_volume),
            Arc::clone(&self.track_position_ms),
            Arc::clone(&self.track_seek_frame),
        );
        let mut worship_pad = WorshipPadPlayer::new(
            Arc::clone(&self.pad_key),
            Arc::clone(&self.pad_enabled),
            Arc::clone(&self.pad_volume),
        );
        let volume_atomic = Arc::clone(&self.master_volume);
        let playing_atomic = Arc::clone(&self.is_playing);
        let voices_atomic = Arc::clone(&self.active_voices);
        let midi_notes_atomic = Arc::clone(&self.midi_active_notes);
        let sound_params_atomic = Arc::clone(&self.sound_params);
        midi_notes_atomic[0].store(0, Ordering::Relaxed);
        midi_notes_atomic[1].store(0, Ordering::Relaxed);

        let handle = open_output_stream(&self.audio_config, move |output, channels, sample_rate| {
            let params = sound_params_atomic.load();
            // 1. Check for a new SampleBank; push the old one back for non-RT deallocation.
            while let Ok(new_bank) = bank_rx.pop() {
                pool.handle_event_with_params(MidiEvent::AllNotesOff, &active_bank, sample_rate, params);
                midi_notes_atomic[0].store(0, Ordering::Relaxed);
                midi_notes_atomic[1].store(0, Ordering::Relaxed);
                let old_bank = std::mem::replace(&mut active_bank, new_bank);
                let _ = reclaim_tx.push(old_bank);
            }

            // 2. Drain control events (panic, injected test events) and MIDI events.
            while let Ok(ev) = ctrl_rx.pop() {
                if matches!(ev, MidiEvent::AllNotesOff) {
                    midi_notes_atomic[0].store(0, Ordering::Relaxed);
                    midi_notes_atomic[1].store(0, Ordering::Relaxed);
                }
                pool.handle_event_with_params(ev, &active_bank, sample_rate, params);
            }
            while let Ok(ev) = midi_rx.pop() {
                match ev {
                    MidiEvent::NoteOn { note, .. } => {
                        let n = note & 127;
                        midi_notes_atomic[(n >> 6) as usize].fetch_or(1u64 << (n & 63), Ordering::Relaxed);
                    }
                    MidiEvent::NoteOff { note, .. } => {
                        let n = note & 127;
                        midi_notes_atomic[(n >> 6) as usize].fetch_and(!(1u64 << (n & 63)), Ordering::Relaxed);
                    }
                    MidiEvent::AllNotesOff => {
                        midi_notes_atomic[0].store(0, Ordering::Relaxed);
                        midi_notes_atomic[1].store(0, Ordering::Relaxed);
                    }
                    _ => {}
                }
                pool.handle_event_with_params(ev, &active_bank, sample_rate, params);
            }

            // 3. Render active voices, backing track, and worship pad.
            let master_vol = f32::from_bits(volume_atomic.load(Ordering::Relaxed));
            let any_active =
                pool.render_with_params(output, channels, sample_rate, master_vol, &active_bank, params);
            backing_player.render_into(output, channels, sample_rate);
            worship_pad.render_into(output, channels, sample_rate);
            playing_atomic.store(any_active, Ordering::Relaxed);
            voices_atomic.store(pool.active_voice_count(), Ordering::Relaxed);
        })?;

        self.audio_handle = Some(handle);
        Ok(())
    }
}

