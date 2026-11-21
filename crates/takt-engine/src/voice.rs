use std::f32::consts::TAU;
use std::sync::atomic::{AtomicU32, AtomicU8, Ordering};

use crate::midi::MidiEvent;
use crate::sampler::SampleBank;

pub const MAX_VOICES: usize = 32;
const PITCH_BEND_SEMITONES: f32 = 2.0;
const VIBRATO_RATE_HZ: f32 = 5.5;
const MAX_VIBRATO_SEMITONES: f32 = 0.35;

/// Polyphony / playing mode for `VoicePool`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum VoiceMode {
    Poly = 0,
    Mono = 1,
    Legato = 2,
}

impl VoiceMode {
    pub fn from_u8(v: u8) -> Self {
        match v {
            1 => Self::Mono,
            2 => Self::Legato,
            _ => Self::Poly,
        }
    }
}

/// Real-time adjustable voice-shaping parameters.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SoundParams {
    /// Low-pass tone brightness in `0.0..=1.0` (`1.0` = full bandwidth).
    pub brightness: f32,
    /// Attack ramp time in milliseconds (`0.0..=400.0`).
    pub attack_ms: f32,
    /// Release tail time in milliseconds (`20.0..=1500.0`).
    pub release_ms: f32,
    /// Stereo reverb wet mix in `0.0..=0.7`.
    pub reverb_mix: f32,
    /// Mid/side stereo width in `0.0..=1.5` (`1.0` = natural stereo).
    pub stereo_width: f32,
    /// Hammer hardness in `0.0..=1.0` (`0.5` = neutral; shifts velocity layers & tone).
    pub hammer_hardness: f32,
    /// Sample start offset in milliseconds (`0.0..=40.0`) for faster touch response.
    pub sample_offset_ms: f32,
    /// Velocity-to-volume dynamic range in `0.0..=1.0` (`0.88` = natural piano dynamics).
    pub vel_track: f32,
    /// Portamento / glide time in milliseconds (`0.0..=400.0`).
    pub glide_ms: f32,
    /// Low-pass filter resonance in `0.0..=0.85`.
    pub resonance: f32,
    /// Stereo chorus wet mix in `0.0..=1.0`.
    pub chorus_mix: f32,
    /// Stereo auto-pan / tremolo depth in `0.0..=1.0`.
    pub tremolo_depth: f32,
    /// Stereo ambient delay wet mix in `0.0..=0.6`.
    pub delay_mix: f32,
    /// Poly / Mono / Legato voice mode.
    pub voice_mode: VoiceMode,
    /// Decay time in milliseconds (`10.0..=10000.0`).
    pub decay_ms: f32,
    /// Sustain level in `0.0..=1.0`.
    pub sustain_level: f32,
    /// Mod-wheel low-pass filter minimum cutoff in Hz (`20.0..=20000.0`).
    pub mod_filter_min_hz: f32,
    /// Mod-wheel low-pass filter maximum cutoff in Hz (`20.0..=20000.0`).
    pub mod_filter_max_hz: f32,
    /// Compressor enabled flag.
    pub comp_enabled: bool,
    /// Compressor input gain in dB (`-12.0..=12.0`).
    pub comp_input_db: f32,
    /// Compressor attack in ms (`1.0..=100.0`).
    pub comp_attack_ms: f32,
    /// Compressor release in ms (`10.0..=500.0`).
    pub comp_release_ms: f32,
    /// Compressor ratio (`1.0..=20.0`).
    pub comp_ratio: f32,
    /// Compressor threshold in dB (`-60.0..=0.0`).
    pub comp_threshold_db: f32,
    /// Compressor wet/dry mix (`0.0..=1.0`).
    pub comp_mix: f32,
    /// Compressor output makeup gain in dB (`-12.0..=12.0`).
    pub comp_output_db: f32,
    /// 8-band Equalizer enabled flag.
    pub eq_enabled: bool,
    /// 8-band EQ frequencies (HPF, LowShelf, Peak1..4, HighShelf, LPF).
    pub eq_freqs: [f32; 8],
    /// 6 EQ gains in dB (LowShelf, Peak1..4, HighShelf).
    pub eq_gains: [f32; 6],
    /// 4 EQ bandwidths (Peak1..4).
    pub eq_qs: [f32; 4],
    /// Ignore sustain pedal for this layer.
    pub block_sustain: bool,
    /// Stereo pan in `-1.0..=1.0`.
    pub pan: f32,
}

impl Default for SoundParams {
    fn default() -> Self {
        Self {
            brightness: 1.0,
            attack_ms: 0.0,
            release_ms: 85.0,
            reverb_mix: 0.15,
            stereo_width: 1.0,
            hammer_hardness: 0.5,
            sample_offset_ms: 0.0,
            vel_track: 0.88,
            glide_ms: 0.0,
            resonance: 0.0,
            chorus_mix: 0.0,
            tremolo_depth: 0.0,
            delay_mix: 0.0,
            voice_mode: VoiceMode::Poly,
            decay_ms: 10000.0,
            sustain_level: 1.0,
            mod_filter_min_hz: 200.0,
            mod_filter_max_hz: 20000.0,
            comp_enabled: false,
            comp_input_db: 0.0,
            comp_attack_ms: 15.0,
            comp_release_ms: 49.0,
            comp_ratio: 4.2,
            comp_threshold_db: -29.0,
            comp_mix: 0.85,
            comp_output_db: 3.5,
            eq_enabled: false,
            eq_freqs: [67.0, 200.0, 197.0, 345.0, 1000.0, 5417.0, 1101.0, 9000.0],
            eq_gains: [0.0; 6],
            eq_qs: [0.28, 0.30, 0.50, 0.36],
            block_sustain: false,
            pan: 0.0,
        }
    }
}

/// Lock-free atomic mirror of `SoundParams` for zero-allocation audio-thread reads.
pub struct AtomicSoundParams {
    brightness: AtomicU32,
    attack_ms: AtomicU32,
    release_ms: AtomicU32,
    reverb_mix: AtomicU32,
    stereo_width: AtomicU32,
    hammer_hardness: AtomicU32,
    sample_offset_ms: AtomicU32,
    vel_track: AtomicU32,
    glide_ms: AtomicU32,
    resonance: AtomicU32,
    chorus_mix: AtomicU32,
    tremolo_depth: AtomicU32,
    delay_mix: AtomicU32,
    voice_mode: AtomicU8,
    decay_ms: AtomicU32,
    sustain_level: AtomicU32,
    mod_filter_min_hz: AtomicU32,
    mod_filter_max_hz: AtomicU32,
    comp_enabled: AtomicU8,
    comp_input_db: AtomicU32,
    comp_attack_ms: AtomicU32,
    comp_release_ms: AtomicU32,
    comp_ratio: AtomicU32,
    comp_threshold_db: AtomicU32,
    comp_mix: AtomicU32,
    comp_output_db: AtomicU32,
    eq_enabled: AtomicU8,
    eq_freqs: [AtomicU32; 8],
    eq_gains: [AtomicU32; 6],
    eq_qs: [AtomicU32; 4],
    block_sustain: AtomicU8,
    pan: AtomicU32,
}

impl Default for AtomicSoundParams {
    fn default() -> Self {
        let d = SoundParams::default();
        Self {
            brightness: AtomicU32::new(d.brightness.to_bits()),
            attack_ms: AtomicU32::new(d.attack_ms.to_bits()),
            release_ms: AtomicU32::new(d.release_ms.to_bits()),
            reverb_mix: AtomicU32::new(d.reverb_mix.to_bits()),
            stereo_width: AtomicU32::new(d.stereo_width.to_bits()),
            hammer_hardness: AtomicU32::new(d.hammer_hardness.to_bits()),
            sample_offset_ms: AtomicU32::new(d.sample_offset_ms.to_bits()),
            vel_track: AtomicU32::new(d.vel_track.to_bits()),
            glide_ms: AtomicU32::new(d.glide_ms.to_bits()),
            resonance: AtomicU32::new(d.resonance.to_bits()),
            chorus_mix: AtomicU32::new(d.chorus_mix.to_bits()),
            tremolo_depth: AtomicU32::new(d.tremolo_depth.to_bits()),
            delay_mix: AtomicU32::new(d.delay_mix.to_bits()),
            voice_mode: AtomicU8::new(d.voice_mode as u8),
            decay_ms: AtomicU32::new(d.decay_ms.to_bits()),
            sustain_level: AtomicU32::new(d.sustain_level.to_bits()),
            mod_filter_min_hz: AtomicU32::new(d.mod_filter_min_hz.to_bits()),
            mod_filter_max_hz: AtomicU32::new(d.mod_filter_max_hz.to_bits()),
            comp_enabled: AtomicU8::new(u8::from(d.comp_enabled)),
            comp_input_db: AtomicU32::new(d.comp_input_db.to_bits()),
            comp_attack_ms: AtomicU32::new(d.comp_attack_ms.to_bits()),
            comp_release_ms: AtomicU32::new(d.comp_release_ms.to_bits()),
            comp_ratio: AtomicU32::new(d.comp_ratio.to_bits()),
            comp_threshold_db: AtomicU32::new(d.comp_threshold_db.to_bits()),
            comp_mix: AtomicU32::new(d.comp_mix.to_bits()),
            comp_output_db: AtomicU32::new(d.comp_output_db.to_bits()),
            eq_enabled: AtomicU8::new(u8::from(d.eq_enabled)),
            eq_freqs: d.eq_freqs.map(|v| AtomicU32::new(v.to_bits())),
            eq_gains: d.eq_gains.map(|v| AtomicU32::new(v.to_bits())),
            eq_qs: d.eq_qs.map(|v| AtomicU32::new(v.to_bits())),
            block_sustain: AtomicU8::new(u8::from(d.block_sustain)),
            pan: AtomicU32::new(d.pan.to_bits()),
        }
    }
}

impl AtomicSoundParams {
    pub fn store(&self, p: SoundParams) {
        self.brightness
            .store(p.brightness.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.attack_ms
            .store(p.attack_ms.clamp(0.0, 2000.0).to_bits(), Ordering::Relaxed);
        self.release_ms
            .store(p.release_ms.clamp(20.0, 5000.0).to_bits(), Ordering::Relaxed);
        self.reverb_mix
            .store(p.reverb_mix.clamp(0.0, 0.7).to_bits(), Ordering::Relaxed);
        self.stereo_width
            .store(p.stereo_width.clamp(0.0, 1.5).to_bits(), Ordering::Relaxed);
        self.hammer_hardness
            .store(p.hammer_hardness.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.sample_offset_ms
            .store(p.sample_offset_ms.clamp(0.0, 40.0).to_bits(), Ordering::Relaxed);
        self.vel_track
            .store(p.vel_track.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.glide_ms
            .store(p.glide_ms.clamp(0.0, 400.0).to_bits(), Ordering::Relaxed);
        self.resonance
            .store(p.resonance.clamp(0.0, 0.85).to_bits(), Ordering::Relaxed);
        self.chorus_mix
            .store(p.chorus_mix.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.tremolo_depth
            .store(p.tremolo_depth.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.delay_mix
            .store(p.delay_mix.clamp(0.0, 0.6).to_bits(), Ordering::Relaxed);
        self.voice_mode
            .store(p.voice_mode as u8, Ordering::Relaxed);
        self.decay_ms
            .store(p.decay_ms.clamp(10.0, 10000.0).to_bits(), Ordering::Relaxed);
        self.sustain_level
            .store(p.sustain_level.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.mod_filter_min_hz
            .store(p.mod_filter_min_hz.clamp(20.0, 20000.0).to_bits(), Ordering::Relaxed);
        self.mod_filter_max_hz
            .store(p.mod_filter_max_hz.clamp(20.0, 20000.0).to_bits(), Ordering::Relaxed);
        self.comp_enabled
            .store(u8::from(p.comp_enabled), Ordering::Relaxed);
        self.comp_input_db
            .store(p.comp_input_db.clamp(-12.0, 12.0).to_bits(), Ordering::Relaxed);
        self.comp_attack_ms
            .store(p.comp_attack_ms.clamp(1.0, 100.0).to_bits(), Ordering::Relaxed);
        self.comp_release_ms
            .store(p.comp_release_ms.clamp(10.0, 500.0).to_bits(), Ordering::Relaxed);
        self.comp_ratio
            .store(p.comp_ratio.clamp(1.0, 20.0).to_bits(), Ordering::Relaxed);
        self.comp_threshold_db
            .store(p.comp_threshold_db.clamp(-60.0, 0.0).to_bits(), Ordering::Relaxed);
        self.comp_mix
            .store(p.comp_mix.clamp(0.0, 1.0).to_bits(), Ordering::Relaxed);
        self.comp_output_db
            .store(p.comp_output_db.clamp(-12.0, 12.0).to_bits(), Ordering::Relaxed);
        self.eq_enabled
            .store(u8::from(p.eq_enabled), Ordering::Relaxed);
        for (a, v) in self.eq_freqs.iter().zip(p.eq_freqs) {
            a.store(v.clamp(20.0, 20000.0).to_bits(), Ordering::Relaxed);
        }
        for (a, v) in self.eq_gains.iter().zip(p.eq_gains) {
            a.store(v.clamp(-18.0, 18.0).to_bits(), Ordering::Relaxed);
        }
        for (a, v) in self.eq_qs.iter().zip(p.eq_qs) {
            a.store(v.clamp(0.1, 4.0).to_bits(), Ordering::Relaxed);
        }
        self.block_sustain
            .store(u8::from(p.block_sustain), Ordering::Relaxed);
        self.pan
            .store(p.pan.clamp(-1.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn load(&self) -> SoundParams {
        SoundParams {
            brightness: f32::from_bits(self.brightness.load(Ordering::Relaxed)),
            attack_ms: f32::from_bits(self.attack_ms.load(Ordering::Relaxed)),
            release_ms: f32::from_bits(self.release_ms.load(Ordering::Relaxed)),
            reverb_mix: f32::from_bits(self.reverb_mix.load(Ordering::Relaxed)),
            stereo_width: f32::from_bits(self.stereo_width.load(Ordering::Relaxed)),
            hammer_hardness: f32::from_bits(self.hammer_hardness.load(Ordering::Relaxed)),
            sample_offset_ms: f32::from_bits(self.sample_offset_ms.load(Ordering::Relaxed)),
            vel_track: f32::from_bits(self.vel_track.load(Ordering::Relaxed)),
            glide_ms: f32::from_bits(self.glide_ms.load(Ordering::Relaxed)),
            resonance: f32::from_bits(self.resonance.load(Ordering::Relaxed)),
            chorus_mix: f32::from_bits(self.chorus_mix.load(Ordering::Relaxed)),
            tremolo_depth: f32::from_bits(self.tremolo_depth.load(Ordering::Relaxed)),
            delay_mix: f32::from_bits(self.delay_mix.load(Ordering::Relaxed)),
            voice_mode: VoiceMode::from_u8(self.voice_mode.load(Ordering::Relaxed)),
            decay_ms: f32::from_bits(self.decay_ms.load(Ordering::Relaxed)),
            sustain_level: f32::from_bits(self.sustain_level.load(Ordering::Relaxed)),
            mod_filter_min_hz: f32::from_bits(self.mod_filter_min_hz.load(Ordering::Relaxed)),
            mod_filter_max_hz: f32::from_bits(self.mod_filter_max_hz.load(Ordering::Relaxed)),
            comp_enabled: self.comp_enabled.load(Ordering::Relaxed) != 0,
            comp_input_db: f32::from_bits(self.comp_input_db.load(Ordering::Relaxed)),
            comp_attack_ms: f32::from_bits(self.comp_attack_ms.load(Ordering::Relaxed)),
            comp_release_ms: f32::from_bits(self.comp_release_ms.load(Ordering::Relaxed)),
            comp_ratio: f32::from_bits(self.comp_ratio.load(Ordering::Relaxed)),
            comp_threshold_db: f32::from_bits(self.comp_threshold_db.load(Ordering::Relaxed)),
            comp_mix: f32::from_bits(self.comp_mix.load(Ordering::Relaxed)),
            comp_output_db: f32::from_bits(self.comp_output_db.load(Ordering::Relaxed)),
            eq_enabled: self.eq_enabled.load(Ordering::Relaxed) != 0,
            eq_freqs: std::array::from_fn(|i| f32::from_bits(self.eq_freqs[i].load(Ordering::Relaxed))),
            eq_gains: std::array::from_fn(|i| f32::from_bits(self.eq_gains[i].load(Ordering::Relaxed))),
            eq_qs: std::array::from_fn(|i| f32::from_bits(self.eq_qs[i].load(Ordering::Relaxed))),
            block_sustain: self.block_sustain.load(Ordering::Relaxed) != 0,
            pan: f32::from_bits(self.pan.load(Ordering::Relaxed)),
        }
    }
}

struct CombFilter {
    buf: Vec<f32>,
    idx: usize,
    filter_store: f32,
}

impl CombFilter {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; len.max(1)],
            idx: 0,
            filter_store: 0.0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32, feedback: f32, damp: f32) -> f32 {
        let out = self.buf[self.idx];
        self.filter_store = out * (1.0 - damp) + self.filter_store * damp;
        self.buf[self.idx] = input + self.filter_store * feedback;
        self.idx += 1;
        if self.idx >= self.buf.len() {
            self.idx = 0;
        }
        out
    }
}

struct AllpassFilter {
    buf: Vec<f32>,
    idx: usize,
}

impl AllpassFilter {
    fn new(len: usize) -> Self {
        Self {
            buf: vec![0.0; len.max(1)],
            idx: 0,
        }
    }

    #[inline]
    fn process(&mut self, input: f32) -> f32 {
        let buf_out = self.buf[self.idx];
        let out = -input + buf_out;
        self.buf[self.idx] = input + buf_out * 0.5;
        self.idx += 1;
        if self.idx >= self.buf.len() {
            self.idx = 0;
        }
        out
    }
}

/// Pre-allocated stereo Schroeder reverb (zero allocations in `process`).
struct StereoReverb {
    combs_l: [CombFilter; 4],
    combs_r: [CombFilter; 4],
    allpass_l: [AllpassFilter; 2],
    allpass_r: [AllpassFilter; 2],
}

impl Default for StereoReverb {
    fn default() -> Self {
        Self {
            combs_l: [
                CombFilter::new(1557),
                CombFilter::new(1617),
                CombFilter::new(1491),
                CombFilter::new(1422),
            ],
            combs_r: [
                CombFilter::new(1580),
                CombFilter::new(1640),
                CombFilter::new(1514),
                CombFilter::new(1445),
            ],
            allpass_l: [AllpassFilter::new(225), AllpassFilter::new(556)],
            allpass_r: [AllpassFilter::new(248), AllpassFilter::new(579)],
        }
    }
}

impl StereoReverb {
    #[inline]
    fn process(&mut self, in_l: f32, in_r: f32) -> (f32, f32) {
        let mono_in = (in_l + in_r) * 0.25;
        let feedback = 0.82;
        let damp = 0.32;

        let mut wet_l = 0.0;
        let mut wet_r = 0.0;
        for c in &mut self.combs_l {
            wet_l += c.process(mono_in, feedback, damp);
        }
        for c in &mut self.combs_r {
            wet_r += c.process(mono_in, feedback, damp);
        }
        for a in &mut self.allpass_l {
            wet_l = a.process(wet_l);
        }
        for a in &mut self.allpass_r {
            wet_r = a.process(wet_r);
        }
        (wet_l * 0.35, wet_r * 0.35)
    }
}

const CHORUS_BUF_LEN: usize = 2048;

struct StereoChorus {
    buf_l: [f32; CHORUS_BUF_LEN],
    buf_r: [f32; CHORUS_BUF_LEN],
    write_idx: usize,
    lfo_phase: f32,
}

impl Default for StereoChorus {
    fn default() -> Self {
        Self {
            buf_l: [0.0; CHORUS_BUF_LEN],
            buf_r: [0.0; CHORUS_BUF_LEN],
            write_idx: 0,
            lfo_phase: 0.0,
        }
    }
}

impl StereoChorus {
    #[inline]
    fn read_frac(buf: &[f32; CHORUS_BUF_LEN], write_idx: usize, delay_samples: f32) -> f32 {
        let len = CHORUS_BUF_LEN as f32;
        let mut pos = write_idx as f32 - delay_samples;
        if pos < 0.0 {
            pos += len;
        }
        let i0 = (pos as usize) & (CHORUS_BUF_LEN - 1);
        let i1 = (i0 + 1) & (CHORUS_BUF_LEN - 1);
        let frac = pos - (pos as usize) as f32;
        buf[i0] + (buf[i1] - buf[i0]) * frac
    }

    #[inline]
    fn process(&mut self, in_l: f32, in_r: f32, sample_rate: u32) -> (f32, f32) {
        self.buf_l[self.write_idx] = in_l;
        self.buf_r[self.write_idx] = in_r;

        let sr = sample_rate as f32;
        let mod_s = (self.lfo_phase * TAU).sin();
        self.lfo_phase = (self.lfo_phase + 0.55 / sr).fract();

        let base_delay = 0.014 * sr;
        let depth = 0.0045 * sr;
        let wet_l = Self::read_frac(&self.buf_l, self.write_idx, base_delay + depth * mod_s);
        let wet_r = Self::read_frac(&self.buf_r, self.write_idx, base_delay - depth * mod_s);

        self.write_idx = (self.write_idx + 1) & (CHORUS_BUF_LEN - 1);
        (wet_l, wet_r)
    }
}

const DELAY_BUF_LEN: usize = 48_000;

struct StereoDelay {
    buf_l: Vec<f32>,
    buf_r: Vec<f32>,
    idx: usize,
    damp_l: f32,
    damp_r: f32,
}

impl Default for StereoDelay {
    fn default() -> Self {
        Self {
            buf_l: vec![0.0; DELAY_BUF_LEN],
            buf_r: vec![0.0; DELAY_BUF_LEN],
            idx: 0,
            damp_l: 0.0,
            damp_r: 0.0,
        }
    }
}

impl StereoDelay {
    #[inline]
    fn process(&mut self, in_l: f32, in_r: f32, sample_rate: u32) -> (f32, f32) {
        let delay_samples = ((0.36 * sample_rate as f32) as usize).clamp(1, DELAY_BUF_LEN - 1);
        let read_idx = (self.idx + DELAY_BUF_LEN - delay_samples) % DELAY_BUF_LEN;
        let tap_l = self.buf_l[read_idx];
        let tap_r = self.buf_r[read_idx];

        self.damp_l = tap_l * 0.65 + self.damp_l * 0.35;
        self.damp_r = tap_r * 0.65 + self.damp_r * 0.35;

        // Ping-pong cross-feedback
        self.buf_l[self.idx] = in_l + self.damp_r * 0.38;
        self.buf_r[self.idx] = in_r + self.damp_l * 0.38;
        self.idx = (self.idx + 1) % DELAY_BUF_LEN;
        (tap_l, tap_r)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VoiceState {
    Idle,
    Playing,
    Sustained,
    Releasing,
}

#[derive(Debug, Clone, Copy)]
pub struct Voice {
    pub state: VoiceState,
    pub channel: u8,
    pub note: u8,
    pub current_note: f32,
    pub zone_idx: usize,
    pub position: f64,
    pub velocity_gain: f32,
    pub attack_gain: f32,
    pub attack_step: f32,
    pub env_gain: f32,
    pub release_step: f32,
    pub age: u64,
}

impl Default for Voice {
    fn default() -> Self {
        Self {
            state: VoiceState::Idle,
            channel: 0,
            note: 0,
            current_note: 0.0,
            zone_idx: 0,
            position: 0.0,
            velocity_gain: 0.0,
            attack_gain: 1.0,
            attack_step: 1.0,
            env_gain: 0.0,
            release_step: 0.0,
            age: 0,
        }
    }
}

#[derive(Default, Clone, Copy)]
struct StereoBiquad {
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    x1_l: f32,
    x2_l: f32,
    y1_l: f32,
    y2_l: f32,
    x1_r: f32,
    x2_r: f32,
    y1_r: f32,
    y2_r: f32,
}

impl StereoBiquad {
    fn set_hpf(&mut self, freq_hz: f32, sr: f32) {
        let w0 = TAU * (freq_hz.clamp(20.0, sr * 0.45) / sr);
        let alpha = w0.sin() / std::f32::consts::SQRT_2;
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 + cos_w0) * 0.5) / a0;
        self.b1 = -(1.0 + cos_w0) / a0;
        self.b2 = ((1.0 + cos_w0) * 0.5) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn set_lpf(&mut self, freq_hz: f32, sr: f32) {
        let w0 = TAU * (freq_hz.clamp(20.0, sr * 0.45) / sr);
        let alpha = w0.sin() / std::f32::consts::SQRT_2;
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha;
        self.b0 = ((1.0 - cos_w0) * 0.5) / a0;
        self.b1 = (1.0 - cos_w0) / a0;
        self.b2 = ((1.0 - cos_w0) * 0.5) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha) / a0;
    }

    fn set_peaking(&mut self, freq_hz: f32, gain_db: f32, bw: f32, sr: f32) {
        if gain_db.abs() < 0.05 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * (freq_hz.clamp(20.0, sr * 0.45) / sr);
        let q = (1.0 / bw.clamp(0.1, 4.0)).clamp(0.3, 10.0);
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();
        let a0 = 1.0 + alpha / a;
        self.b0 = (1.0 + alpha * a) / a0;
        self.b1 = (-2.0 * cos_w0) / a0;
        self.b2 = (1.0 - alpha * a) / a0;
        self.a1 = (-2.0 * cos_w0) / a0;
        self.a2 = (1.0 - alpha / a) / a0;
    }

    fn set_shelf(&mut self, freq_hz: f32, gain_db: f32, high: bool, sr: f32) {
        if gain_db.abs() < 0.05 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }
        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = TAU * (freq_hz.clamp(20.0, sr * 0.45) / sr);
        let cos_w0 = w0.cos();
        let sin_w0 = w0.sin();
        let beta = (a.sqrt() / 0.7071) * sin_w0;
        if high {
            let a0 = (a + 1.0) - (a - 1.0) * cos_w0 + beta;
            self.b0 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 + beta)) / a0;
            self.b1 = (-2.0 * a * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
            self.b2 = (a * ((a + 1.0) + (a - 1.0) * cos_w0 - beta)) / a0;
            self.a1 = (2.0 * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
            self.a2 = ((a + 1.0) - (a - 1.0) * cos_w0 - beta) / a0;
        } else {
            let a0 = (a + 1.0) + (a - 1.0) * cos_w0 + beta;
            self.b0 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 + beta)) / a0;
            self.b1 = (2.0 * a * ((a - 1.0) - (a + 1.0) * cos_w0)) / a0;
            self.b2 = (a * ((a + 1.0) - (a - 1.0) * cos_w0 - beta)) / a0;
            self.a1 = (-2.0 * ((a - 1.0) + (a + 1.0) * cos_w0)) / a0;
            self.a2 = ((a + 1.0) + (a - 1.0) * cos_w0 - beta) / a0;
        }
    }

    #[inline]
    fn process(&mut self, l: f32, r: f32) -> (f32, f32) {
        let out_l = self.b0 * l + self.b1 * self.x1_l + self.b2 * self.x2_l
            - self.a1 * self.y1_l
            - self.a2 * self.y2_l;
        self.x2_l = self.x1_l;
        self.x1_l = l;
        self.y2_l = self.y1_l;
        self.y1_l = out_l;

        let out_r = self.b0 * r + self.b1 * self.x1_r + self.b2 * self.x2_r
            - self.a1 * self.y1_r
            - self.a2 * self.y2_r;
        self.x2_r = self.x1_r;
        self.x1_r = r;
        self.y2_r = self.y1_r;
        self.y1_r = out_r;
        (out_l, out_r)
    }
}

/// Fixed-size 32-voice sampler pool with zero heap allocation on the audio thread.
pub struct VoicePool {
    voices: [Voice; MAX_VOICES],
    sustain_pressed: bool,
    pitch_bend_semitones: f32,
    mod_wheel: f32,
    lfo_phase: f32,
    tremolo_phase: f32,
    last_note: Option<f32>,
    mono_stack: [(u8, u8, u8); 16],
    mono_stack_len: usize,
    age_counter: u64,
    svf_low_l: f32,
    svf_band_l: f32,
    svf_low_r: f32,
    svf_band_r: f32,
    bark_lp_l: f32,
    bark_lp_r: f32,
    comp_env: f32,
    eq_filters: [StereoBiquad; 8],
    reverb: Box<StereoReverb>,
    chorus: Box<StereoChorus>,
    delay: Box<StereoDelay>,
}

impl Default for VoicePool {
    fn default() -> Self {
        Self {
            voices: [Voice::default(); MAX_VOICES],
            sustain_pressed: false,
            pitch_bend_semitones: 0.0,
            mod_wheel: 0.0,
            lfo_phase: 0.0,
            tremolo_phase: 0.0,
            last_note: None,
            mono_stack: [(0, 0, 0); 16],
            mono_stack_len: 0,
            age_counter: 0,
            svf_low_l: 0.0,
            svf_band_l: 0.0,
            svf_low_r: 0.0,
            svf_band_r: 0.0,
            bark_lp_l: 0.0,
            bark_lp_r: 0.0,
            comp_env: 0.0,
            eq_filters: [StereoBiquad::default(); 8],
            reverb: Box::default(),
            chorus: Box::default(),
            delay: Box::default(),
        }
    }
}

impl VoicePool {
    pub fn active_voice_count(&self) -> usize {
        self.voices
            .iter()
            .filter(|v| v.state != VoiceState::Idle)
            .count()
    }

    pub fn handle_event(&mut self, event: MidiEvent, bank: &SampleBank, sample_rate: u32) {
        self.handle_event_with_params(event, bank, sample_rate, SoundParams::default());
    }

    pub fn handle_event_with_params(
        &mut self,
        event: MidiEvent,
        bank: &SampleBank,
        sample_rate: u32,
        params: SoundParams,
    ) {
        match event {
            MidiEvent::NoteOn {
                channel,
                note,
                velocity,
            } => {
                let effective_vel =
                    (velocity as f32 + (params.hammer_hardness - 0.5) * 90.0).clamp(1.0, 127.0) as u8;
                let Some(zone_idx) = bank.find_zone_index(note, effective_vel) else {
                    return;
                };

                if params.voice_mode != VoiceMode::Poly {
                    self.push_mono_note(channel, note, velocity);
                    if params.voice_mode == VoiceMode::Legato {
                        if let Some(v) = self
                            .voices
                            .iter_mut()
                            .find(|v| v.state == VoiceState::Playing || v.state == VoiceState::Sustained)
                        {
                            v.state = VoiceState::Playing;
                            v.channel = channel;
                            v.note = note;
                            self.last_note = Some(note as f32);
                            return;
                        }
                    }
                    // Mono retrigger (or first note of Legato): quickly release any existing voices
                    let fast_step = release_step_for_ms(5.0, sample_rate);
                    for v in &mut self.voices {
                        if v.state != VoiceState::Idle {
                            v.state = VoiceState::Releasing;
                            v.release_step = fast_step;
                        }
                    }
                } else {
                    // Re-trigger same note cleanly if already sounding on this channel.
                    for v in &mut self.voices {
                        if v.state != VoiceState::Idle && v.channel == channel && v.note == note {
                            v.state = VoiceState::Releasing;
                            v.release_step = release_step_for_ms(5.0, sample_rate);
                        }
                    }
                }

                let slot = self.allocate_voice_slot();
                self.age_counter = self.age_counter.wrapping_add(1);
                let norm_vel = (velocity as f32 / 127.0).clamp(0.0, 1.0);
                let vel_track = params.vel_track.clamp(0.0, 1.0);
                let velocity_gain = (1.0 - vel_track) + vel_track * norm_vel.powf(1.4);

                let zone_sample = &bank.zones[zone_idx].sample;
                let max_offset = zone_sample.frames.len().saturating_sub(2) as f64;
                let position = (params.sample_offset_ms as f64 * 0.001 * zone_sample.sample_rate as f64)
                    .clamp(0.0, max_offset);

                let soft_hammer_attack = if params.hammer_hardness < 0.5 {
                    (0.5 - params.hammer_hardness) * 12.0
                } else {
                    0.0
                };
                let offset_anti_click = if position > 0.0 { 2.0 } else { 0.0 };
                let total_attack_ms = params.attack_ms.max(offset_anti_click) + soft_hammer_attack;
                let (attack_gain, attack_step) = if total_attack_ms <= 0.5 {
                    (1.0, 1.0)
                } else {
                    (0.0, release_step_for_ms(total_attack_ms, sample_rate))
                };

                let start_note = if params.glide_ms > 1.0 {
                    self.last_note.unwrap_or(note as f32)
                } else {
                    note as f32
                };
                self.last_note = Some(note as f32);

                self.voices[slot] = Voice {
                    state: VoiceState::Playing,
                    channel,
                    note,
                    current_note: start_note,
                    zone_idx,
                    position,
                    velocity_gain,
                    attack_gain,
                    attack_step,
                    env_gain: 1.0,
                    release_step: release_step_for_ms(params.release_ms, sample_rate),
                    age: self.age_counter,
                };
            }
            MidiEvent::NoteOff { channel, note } => {
                if params.voice_mode != VoiceMode::Poly {
                    let was_top = self.mono_stack_len > 0
                        && self.mono_stack[self.mono_stack_len - 1].0 == channel
                        && self.mono_stack[self.mono_stack_len - 1].1 == note;
                    self.remove_mono_note(channel, note);
                    if was_top && self.mono_stack_len > 0 {
                        let (prev_ch, prev_note, prev_vel) =
                            self.mono_stack[self.mono_stack_len - 1];
                        if params.voice_mode == VoiceMode::Legato {
                            if let Some(v) = self
                                .voices
                                .iter_mut()
                                .find(|v| v.state == VoiceState::Playing)
                            {
                                v.channel = prev_ch;
                                v.note = prev_note;
                                self.last_note = Some(prev_note as f32);
                                return;
                            }
                        } else {
                            // Mono mode: retrigger previous held note
                            let mut next_params = params;
                            next_params.voice_mode = VoiceMode::Poly;
                            let fast_step = release_step_for_ms(5.0, sample_rate);
                            for v in &mut self.voices {
                                if v.state != VoiceState::Idle {
                                    v.state = VoiceState::Releasing;
                                    v.release_step = fast_step;
                                }
                            }
                            self.handle_event_with_params(
                                MidiEvent::NoteOn {
                                    channel: prev_ch,
                                    note: prev_note,
                                    velocity: prev_vel,
                                },
                                bank,
                                sample_rate,
                                next_params,
                            );
                            return;
                        }
                    }
                }
                for v in &mut self.voices {
                    if v.state == VoiceState::Playing && v.channel == channel && v.note == note {
                        if self.sustain_pressed {
                            v.state = VoiceState::Sustained;
                        } else {
                            v.state = VoiceState::Releasing;
                            v.release_step = release_step_for_ms(params.release_ms, sample_rate);
                        }
                    }
                }
            }
            MidiEvent::SustainPedal { pressed, .. } => {
                if params.block_sustain && pressed {
                    return;
                }
                self.sustain_pressed = pressed;
                if !pressed {
                    let step = release_step_for_ms(params.release_ms, sample_rate);
                    for v in &mut self.voices {
                        if v.state == VoiceState::Sustained {
                            v.state = VoiceState::Releasing;
                            v.release_step = step;
                        }
                    }
                }
            }
            MidiEvent::ModWheel { value, .. } => {
                self.mod_wheel = (value as f32 / 127.0).clamp(0.0, 1.0);
            }
            MidiEvent::PitchBend { value, .. } => {
                self.pitch_bend_semitones = (value as f32 / 8192.0) * PITCH_BEND_SEMITONES;
            }
            MidiEvent::ProgramChange { .. } => {}
            MidiEvent::AllNotesOff => {
                self.sustain_pressed = false;
                self.mono_stack_len = 0;
                let fast_step = release_step_for_ms(5.0, sample_rate);
                for v in &mut self.voices {
                    if v.state != VoiceState::Idle {
                        v.state = VoiceState::Releasing;
                        v.release_step = fast_step;
                    }
                }
            }
        }
    }

    fn push_mono_note(&mut self, channel: u8, note: u8, velocity: u8) {
        self.remove_mono_note(channel, note);
        if self.mono_stack_len >= self.mono_stack.len() {
            self.mono_stack.copy_within(1.., 0);
            self.mono_stack_len -= 1;
        }
        self.mono_stack[self.mono_stack_len] = (channel, note, velocity);
        self.mono_stack_len += 1;
    }

    fn remove_mono_note(&mut self, channel: u8, note: u8) {
        if let Some(pos) = self.mono_stack[..self.mono_stack_len]
            .iter()
            .position(|&(ch, n, _)| ch == channel && n == note)
        {
            self.mono_stack.copy_within(pos + 1..self.mono_stack_len, pos);
            self.mono_stack_len -= 1;
        }
    }

    fn allocate_voice_slot(&self) -> usize {
        if let Some((idx, _)) = self
            .voices
            .iter()
            .enumerate()
            .find(|(_, v)| v.state == VoiceState::Idle)
        {
            return idx;
        }

        // Prefer stealing the oldest releasing voice first, then the oldest active voice.
        if let Some((idx, _)) = self
            .voices
            .iter()
            .enumerate()
            .filter(|(_, v)| v.state == VoiceState::Releasing)
            .min_by_key(|(_, v)| v.age)
        {
            return idx;
        }

        self.voices
            .iter()
            .enumerate()
            .min_by_key(|(_, v)| v.age)
            .map(|(idx, _)| idx)
            .unwrap_or(0)
    }

    /// Renders all active voices into `output` and returns `true` if any voice was sounding.
    pub fn render(
        &mut self,
        output: &mut [f32],
        channels: u16,
        sample_rate: u32,
        master_volume: f32,
        bank: &SampleBank,
    ) -> bool {
        self.render_with_params(
            output,
            channels,
            sample_rate,
            master_volume,
            bank,
            SoundParams::default(),
        )
    }

    pub fn render_with_params(
        &mut self,
        output: &mut [f32],
        channels: u16,
        sample_rate: u32,
        master_volume: f32,
        bank: &SampleBank,
        params: SoundParams,
    ) -> bool {
        output.fill(0.0);
        let ch = channels.max(1) as usize;
        let num_frames = output.len() / ch;
        if num_frames == 0 || bank.zones.is_empty() {
            return false;
        }

        let mut any_active = false;
        let lfo_inc = VIBRATO_RATE_HZ / sample_rate as f32;
        let trem_inc = 4.4 / sample_rate as f32;
        let glide_coeff = if params.glide_ms > 1.0 {
            1.0 - (-1.0 / (params.glide_ms * 0.001 * sample_rate as f32)).exp()
        } else {
            1.0
        };
        let hammer_bright = if params.hammer_hardness < 0.5 {
            0.35 + 1.3 * params.hammer_hardness
        } else {
            1.0
        };
        let eff_brightness = (params.brightness * hammer_bright).clamp(0.0, 1.0);
        let mod_filter_active = params.mod_filter_max_hz < 19500.0;
        let use_svf = eff_brightness < 0.995 || params.resonance > 0.01 || mod_filter_active;
        let svf_f = if use_svf {
            let base_cutoff = 600.0 * (30.0_f32).powf(eff_brightness);
            let mod_cutoff = if mod_filter_active {
                let lo = params.mod_filter_min_hz.min(params.mod_filter_max_hz);
                let hi = params.mod_filter_min_hz.max(params.mod_filter_max_hz);
                lo + (hi - lo) * self.mod_wheel
            } else {
                base_cutoff
            };
            let cutoff = base_cutoff.min(mod_cutoff).min(sample_rate as f32 * 0.42);
            (2.0 * (std::f32::consts::PI * cutoff / sample_rate as f32).sin()).clamp(0.01, 0.85)
        } else {
            0.85
        };
        let decay_step = if params.sustain_level < 0.999 {
            release_step_for_ms(params.decay_ms.max(10.0), sample_rate)
        } else {
            0.0
        };
        let sr_f = sample_rate as f32;
        if params.eq_enabled {
            self.eq_filters[0].set_hpf(params.eq_freqs[0], sr_f);
            self.eq_filters[1].set_shelf(params.eq_freqs[1], params.eq_gains[0], false, sr_f);
            for p in 0..4 {
                self.eq_filters[2 + p].set_peaking(
                    params.eq_freqs[2 + p],
                    params.eq_gains[1 + p],
                    params.eq_qs[p],
                    sr_f,
                );
            }
            self.eq_filters[6].set_shelf(params.eq_freqs[6], params.eq_gains[5], true, sr_f);
            self.eq_filters[7].set_lpf(params.eq_freqs[7], sr_f);
        }
        let comp_in_gain = 10.0_f32.powf(params.comp_input_db / 20.0);
        let comp_out_gain = 10.0_f32.powf(params.comp_output_db / 20.0);
        let comp_att_coeff = (-1.0 / (params.comp_attack_ms.max(1.0) * 0.001 * sr_f)).exp();
        let comp_rel_coeff = (-1.0 / (params.comp_release_ms.max(10.0) * 0.001 * sr_f)).exp();
        let pan = params.pan.clamp(-1.0, 1.0);
        let pan_l = (1.0 - pan).min(1.0);
        let pan_r = (1.0 + pan).min(1.0);
        let svf_q = (1.0 - params.resonance.clamp(0.0, 0.85) * 0.88).clamp(0.12, 1.0);
        let use_bark = params.hammer_hardness > 0.51;
        let bark_amount = ((params.hammer_hardness - 0.5) * 2.0).clamp(0.0, 1.0);
        let bark_alpha = if use_bark {
            let dt = 1.0 / sample_rate as f32;
            let rc = 1.0 / (TAU * 1800.0);
            (dt / (rc + dt)).clamp(0.01, 1.0)
        } else {
            1.0
        };
        let use_chorus = params.chorus_mix > 0.005;
        let use_tremolo = params.tremolo_depth > 0.005;
        let use_delay = params.delay_mix > 0.005;
        let use_reverb = params.reverb_mix > 0.001;

        for frame_idx in 0..num_frames {
            let vibrato = if self.mod_wheel > 0.001 {
                (self.lfo_phase * TAU).sin() * self.mod_wheel * MAX_VIBRATO_SEMITONES
            } else {
                0.0
            };
            self.lfo_phase = (self.lfo_phase + lfo_inc).fract();

            let mut mix_l = 0.0_f32;
            let mut mix_r = 0.0_f32;

            for v in &mut self.voices {
                if v.state == VoiceState::Idle {
                    continue;
                }
                let Some(zone) = bank.zones.get(v.zone_idx) else {
                    v.state = VoiceState::Idle;
                    continue;
                };
                let frames = &zone.sample.frames;
                if frames.is_empty() {
                    v.state = VoiceState::Idle;
                    continue;
                }

                let pos_idx = v.position as usize;
                if pos_idx >= frames.len() {
                    v.state = VoiceState::Idle;
                    continue;
                }

                any_active = true;
                let frac = (v.position - pos_idx as f64) as f32;
                let s0 = frames[pos_idx];
                let next_idx = if let Some((loop_start, loop_end)) = zone.sample.loop_region {
                    if v.state != VoiceState::Releasing && pos_idx + 1 >= loop_end {
                        loop_start
                    } else {
                        (pos_idx + 1).min(frames.len() - 1)
                    }
                } else {
                    (pos_idx + 1).min(frames.len() - 1)
                };
                let s1 = frames[next_idx];
                let sample_l = s0[0] + (s1[0] - s0[0]) * frac;
                let sample_r = s0[1] + (s1[1] - s0[1]) * frac;

                let gain = v.velocity_gain * v.env_gain * v.attack_gain;
                mix_l += sample_l * gain;
                mix_r += sample_r * gain;

                if v.attack_gain < 1.0 {
                    v.attack_gain = (v.attack_gain + v.attack_step).min(1.0);
                }

                if (v.note as f32 - v.current_note).abs() > 0.001 {
                    v.current_note += (v.note as f32 - v.current_note) * glide_coeff;
                } else {
                    v.current_note = v.note as f32;
                }

                let semitones =
                    (v.current_note - zone.root_note as f32) + self.pitch_bend_semitones + vibrato;
                let pitch_ratio = 2.0_f64.powf(semitones as f64 / 12.0);
                let rate_ratio = zone.sample.sample_rate as f64 / sample_rate as f64;
                v.position += pitch_ratio * rate_ratio;

                if let Some((loop_start, loop_end)) = zone.sample.loop_region {
                    if v.state != VoiceState::Releasing && v.position >= loop_end as f64 {
                        let loop_len = (loop_end - loop_start).max(1) as f64;
                        v.position = loop_start as f64 + ((v.position - loop_start as f64) % loop_len);
                    }
                }

                if v.position >= frames.len() as f64 {
                    v.state = VoiceState::Idle;
                    continue;
                }

                if v.state == VoiceState::Releasing {
                    v.env_gain -= v.release_step;
                    if v.env_gain <= 0.0 {
                        v.env_gain = 0.0;
                        v.state = VoiceState::Idle;
                    }
                } else if v.attack_gain >= 1.0 && decay_step > 0.0 && v.env_gain > params.sustain_level {
                    v.env_gain = (v.env_gain - decay_step).max(params.sustain_level);
                }
            }

            if use_bark {
                self.bark_lp_l += bark_alpha * (mix_l - self.bark_lp_l);
                self.bark_lp_r += bark_alpha * (mix_r - self.bark_lp_r);
                let hi_l = mix_l - self.bark_lp_l;
                let hi_r = mix_r - self.bark_lp_r;
                // Add upper-mid tine/hammer presence + subtle asymmetric harmonic bark
                let drive = 1.0 + bark_amount * 1.4;
                mix_l = (mix_l + hi_l * bark_amount * 1.35) * (1.0 - 0.12 * bark_amount)
                    + (mix_l * drive).tanh() * (0.16 * bark_amount);
                mix_r = (mix_r + hi_r * bark_amount * 1.35) * (1.0 - 0.12 * bark_amount)
                    + (mix_r * drive).tanh() * (0.16 * bark_amount);
            }

            if use_svf {
                let hp_l = mix_l - self.svf_low_l - svf_q * self.svf_band_l;
                self.svf_band_l += svf_f * hp_l;
                self.svf_low_l += svf_f * self.svf_band_l;
                mix_l = self.svf_low_l;

                let hp_r = mix_r - self.svf_low_r - svf_q * self.svf_band_r;
                self.svf_band_r += svf_f * hp_r;
                self.svf_low_r += svf_f * self.svf_band_r;
                mix_r = self.svf_low_r;
            }

            if use_tremolo {
                let mod_t = (self.tremolo_phase * TAU).sin();
                let depth = params.tremolo_depth;
                mix_l *= 1.0 - depth * (0.5 + 0.5 * mod_t);
                mix_r *= 1.0 - depth * (0.5 - 0.5 * mod_t);
            }
            self.tremolo_phase = (self.tremolo_phase + trem_inc).fract();

            if use_chorus {
                let (ch_l, ch_r) = self.chorus.process(mix_l, mix_r, sample_rate);
                let cm = params.chorus_mix;
                mix_l = mix_l * (1.0 - cm * 0.4) + ch_l * cm * 0.65;
                mix_r = mix_r * (1.0 - cm * 0.4) + ch_r * cm * 0.65;
            }

            if (params.stereo_width - 1.0).abs() > 0.01 {
                let mid = 0.5 * (mix_l + mix_r);
                let side = 0.5 * (mix_l - mix_r) * params.stereo_width;
                mix_l = mid + side;
                mix_r = mid - side;
            }

            if use_delay {
                let (dl_l, dl_r) = self.delay.process(mix_l, mix_r, sample_rate);
                mix_l += dl_l * params.delay_mix;
                mix_r += dl_r * params.delay_mix;
            }

            if use_reverb {
                let (wet_l, wet_r) = self.reverb.process(mix_l, mix_r);
                mix_l += wet_l * params.reverb_mix;
                mix_r += wet_r * params.reverb_mix;
            }

            if params.comp_enabled {
                let dry_l = mix_l;
                let dry_r = mix_r;
                let in_l = mix_l * comp_in_gain;
                let in_r = mix_r * comp_in_gain;
                let peak = in_l.abs().max(in_r.abs());
                let coeff = if peak > self.comp_env { comp_att_coeff } else { comp_rel_coeff };
                self.comp_env = coeff * self.comp_env + (1.0 - coeff) * peak;
                let env_db = 20.0 * (self.comp_env.max(1e-6)).log10();
                let gain_db = if env_db > params.comp_threshold_db {
                    let over = env_db - params.comp_threshold_db;
                    -(over * (1.0 - 1.0 / params.comp_ratio.max(1.0)))
                } else {
                    0.0
                };
                let gr = 10.0_f32.powf(gain_db / 20.0) * comp_out_gain;
                let wet_l = in_l * gr;
                let wet_r = in_r * gr;
                let cmix = params.comp_mix.clamp(0.0, 1.0);
                mix_l = dry_l * (1.0 - cmix) + wet_l * cmix;
                mix_r = dry_r * (1.0 - cmix) + wet_r * cmix;
            }

            if params.eq_enabled {
                for band in &mut self.eq_filters {
                    (mix_l, mix_r) = band.process(mix_l, mix_r);
                }
            }

            mix_l *= pan_l;
            mix_r *= pan_r;

            let out_l = (mix_l * master_volume).tanh();
            let out_r = (mix_r * master_volume).tanh();
            let base = frame_idx * ch;
            if ch == 1 {
                output[base] = (out_l + out_r) * 0.5;
            } else {
                output[base] = out_l;
                output[base + 1] = out_r;
                for extra in 2..ch {
                    output[base + extra] = 0.0;
                }
            }
        }

        any_active
    }
}

#[inline]
fn release_step_for_ms(ms: f32, sample_rate: u32) -> f32 {
    let samples = (ms.max(1.0) * 0.001 * sample_rate as f32).max(1.0);
    1.0 / samples
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sampler::load_built_in_banks;

    #[test]
    fn steals_oldest_voice_at_32_limit() {
        let bank = &load_built_in_banks(None)[0];
        let mut pool = VoicePool::default();

        for n in 0..32_u8 {
            pool.handle_event(
                MidiEvent::NoteOn {
                    channel: 0,
                    note: 40 + n,
                    velocity: 100,
                },
                bank,
                44_100,
            );
        }
        assert_eq!(pool.active_voice_count(), 32);

        // 33rd note should steal note 40 (oldest) and keep active count at 32.
        pool.handle_event(
            MidiEvent::NoteOn {
                channel: 0,
                note: 90,
                velocity: 100,
            },
            bank,
            44_100,
        );
        assert_eq!(pool.active_voice_count(), 32);
        assert!(pool.voices.iter().any(|v| v.note == 90));
        assert!(!pool.voices.iter().any(|v| v.note == 40));
    }

    #[test]
    fn sustain_pedal_holds_until_released() {
        let bank = &load_built_in_banks(None)[0];
        let mut pool = VoicePool::default();

        pool.handle_event(
            MidiEvent::SustainPedal {
                channel: 0,
                pressed: true,
            },
            bank,
            44_100,
        );
        pool.handle_event(
            MidiEvent::NoteOn {
                channel: 0,
                note: 60,
                velocity: 100,
            },
            bank,
            44_100,
        );
        pool.handle_event(
            MidiEvent::NoteOff {
                channel: 0,
                note: 60,
            },
            bank,
            44_100,
        );
        assert_eq!(pool.voices[0].state, VoiceState::Sustained);

        pool.handle_event(
            MidiEvent::SustainPedal {
                channel: 0,
                pressed: false,
            },
            bank,
            44_100,
        );
        assert_eq!(pool.voices[0].state, VoiceState::Releasing);
    }

    #[test]
    fn panic_stops_all_voices_cleanly() {
        let bank = &load_built_in_banks(None)[0];
        let mut pool = VoicePool::default();
        for n in 60..70 {
            pool.handle_event(
                MidiEvent::NoteOn {
                    channel: 0,
                    note: n,
                    velocity: 100,
                },
                bank,
                44_100,
            );
        }
        pool.handle_event(MidiEvent::AllNotesOff, bank, 44_100);
        let mut buf = vec![0.0_f32; 1024 * 2];
        pool.render(&mut buf, 2, 44_100, 1.0, bank);
        assert_eq!(pool.active_voice_count(), 0);
    }

    #[test]
    fn hammer_hardness_shifts_velocity_layer_selection() {
        use crate::sampler::{SampleBank, SampleData, SampleZone};
        let soft_sample = SampleData {
            frames: vec![[0.2, 0.2]; 100],
            sample_rate: 44_100,
            loop_region: None,
        };
        let hard_sample = SampleData {
            frames: vec![[0.9, 0.9]; 100],
            sample_rate: 44_100,
            loop_region: None,
        };
        let bank = SampleBank {
            id: "multi".to_string(),
            name: "Multi".to_string(),
            release_ms: 50.0,
            zones: vec![
                SampleZone {
                    min_note: 0,
                    max_note: 127,
                    root_note: 60,
                    min_vel: 0,
                    max_vel: 75,
                    root_vel: 50,
                    sample: soft_sample,
                },
                SampleZone {
                    min_note: 0,
                    max_note: 127,
                    root_note: 60,
                    min_vel: 76,
                    max_vel: 127,
                    root_vel: 110,
                    sample: hard_sample,
                },
            ],
        };

        let mut pool = VoicePool::default();
        let hard_params = SoundParams {
            hammer_hardness: 1.0,
            ..SoundParams::default()
        };
        pool.handle_event_with_params(
            MidiEvent::NoteOn {
                channel: 0,
                note: 60,
                velocity: 60,
            },
            &bank,
            44_100,
            hard_params,
        );
        assert_eq!(pool.voices[0].zone_idx, 1);
    }

    #[test]
    fn glide_slews_pitch_smoothly_toward_target_note() {
        let bank = &load_built_in_banks(None)[0];
        let mut pool = VoicePool::default();
        let params = SoundParams {
            glide_ms: 100.0,
            ..SoundParams::default()
        };
        pool.handle_event_with_params(
            MidiEvent::NoteOn {
                channel: 0,
                note: 60,
                velocity: 100,
            },
            bank,
            44_100,
            params,
        );
        pool.handle_event_with_params(
            MidiEvent::NoteOn {
                channel: 0,
                note: 72,
                velocity: 100,
            },
            bank,
            44_100,
            params,
        );
        assert!((pool.voices[1].current_note - 60.0).abs() < 0.01);
        let mut buf = vec![0.0_f32; 512 * 2];
        pool.render_with_params(&mut buf, 2, 44_100, 1.0, bank, params);
        assert!(pool.voices[1].current_note > 60.5 && pool.voices[1].current_note < 72.0);
    }

    #[test]
    fn mono_and_legato_modes_keep_single_playing_voice() {
        let bank = &load_built_in_banks(None)[0];
        let mut pool = VoicePool::default();
        let legato_params = SoundParams {
            voice_mode: VoiceMode::Legato,
            glide_ms: 80.0,
            ..SoundParams::default()
        };
        pool.handle_event_with_params(
            MidiEvent::NoteOn {
                channel: 0,
                note: 60,
                velocity: 100,
            },
            bank,
            44_100,
            legato_params,
        );
        pool.handle_event_with_params(
            MidiEvent::NoteOn {
                channel: 0,
                note: 67,
                velocity: 100,
            },
            bank,
            44_100,
            legato_params,
        );
        let playing_count = pool
            .voices
            .iter()
            .filter(|v| v.state == VoiceState::Playing)
            .count();
        assert_eq!(playing_count, 1);
        assert_eq!(pool.voices[0].note, 67);
    }
}

