use std::f32::consts::TAU;
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicI8, AtomicU32, Ordering};
use std::sync::Arc;

use rtrb::{Consumer, Producer};

use crate::sampler::SampleData;

/// Real-time backing track player that mixes a decoded `SampleData` into the audio stream.
pub struct BackingTrackPlayer {
    track: Option<Arc<SampleData>>,
    position: f64,
    track_rx: Consumer<Arc<SampleData>>,
    reclaim_tx: Producer<Arc<SampleData>>,
    playing: Arc<AtomicBool>,
    looping: Arc<AtomicBool>,
    volume: Arc<AtomicU32>,
    position_ms: Arc<AtomicU32>,
    seek_frame: Arc<AtomicI64>,
}

impl BackingTrackPlayer {
    pub fn new(
        track: Option<Arc<SampleData>>,
        track_rx: Consumer<Arc<SampleData>>,
        reclaim_tx: Producer<Arc<SampleData>>,
        playing: Arc<AtomicBool>,
        looping: Arc<AtomicBool>,
        volume: Arc<AtomicU32>,
        position_ms: Arc<AtomicU32>,
        seek_frame: Arc<AtomicI64>,
    ) -> Self {
        Self {
            track,
            position: 0.0,
            track_rx,
            reclaim_tx,
            playing,
            looping,
            volume,
            position_ms,
            seek_frame,
        }
    }

    /// Renders active backing track frames into `mix_buf` (interleaved stereo `[L, R, ...]`).
    pub fn render_into(&mut self, output: &mut [f32], channels: u16, sample_rate: u32) {
        while let Ok(new_track) = self.track_rx.pop() {
            if let Some(old) = self.track.replace(new_track) {
                let _ = self.reclaim_tx.push(old);
            }
            self.position = 0.0;
        }

        let seek = self.seek_frame.swap(-1, Ordering::AcqRel);
        if seek >= 0 {
            if let Some(track) = &self.track {
                let max_pos = track.frames.len().saturating_sub(1) as f64;
                self.position = (seek as f64).clamp(0.0, max_pos);
                let ms = (self.position / track.sample_rate as f64 * 1000.0) as u32;
                self.position_ms.store(ms, Ordering::Relaxed);
            }
        }

        if !self.playing.load(Ordering::Relaxed) {
            return;
        }

        let Some(track) = &self.track else {
            self.playing.store(false, Ordering::Relaxed);
            return;
        };
        if track.frames.is_empty() {
            self.playing.store(false, Ordering::Relaxed);
            return;
        }

        let ch = channels.max(1) as usize;
        let num_frames = output.len() / ch;
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let rate_ratio = track.sample_rate as f64 / sample_rate as f64;
        let total_frames = track.frames.len();
        let looping = self.looping.load(Ordering::Relaxed);

        for frame_idx in 0..num_frames {
            let pos_idx = self.position as usize;
            if pos_idx >= total_frames {
                if looping {
                    self.position %= total_frames as f64;
                } else {
                    self.playing.store(false, Ordering::Relaxed);
                    self.position = 0.0;
                    break;
                }
            }

            let idx0 = (self.position as usize).min(total_frames - 1);
            let idx1 = if idx0 + 1 < total_frames {
                idx0 + 1
            } else if looping {
                0
            } else {
                idx0
            };
            let frac = (self.position - idx0 as f64) as f32;
            let s0 = track.frames[idx0];
            let s1 = track.frames[idx1];
            let l = (s0[0] + (s1[0] - s0[0]) * frac) * vol;
            let r = (s0[1] + (s1[1] - s0[1]) * frac) * vol;

            let base = frame_idx * ch;
            if ch == 1 {
                output[base] = (output[base] + (l + r) * 0.5).clamp(-1.0, 1.0);
            } else {
                output[base] = (output[base] + l).clamp(-1.0, 1.0);
                output[base + 1] = (output[base + 1] + r).clamp(-1.0, 1.0);
            }

            self.position += rate_ratio;
            if self.position >= total_frames as f64 {
                if looping {
                    self.position -= total_frames as f64;
                } else {
                    self.playing.store(false, Ordering::Relaxed);
                    self.position = 0.0;
                    break;
                }
            }
        }

        let ms = (self.position / track.sample_rate as f64 * 1000.0) as u32;
        self.position_ms.store(ms, Ordering::Relaxed);
    }
}

#[derive(Clone, Copy)]
struct PadSlot {
    key: i8,
    gain: f32,
    target_gain: f32,
    phases: [f64; 6],
}

impl Default for PadSlot {
    fn default() -> Self {
        Self {
            key: -1,
            gain: 0.0,
            target_gain: 0.0,
            phases: [0.0; 6],
        }
    }
}

/// Real-time, zero-allocation ambient worship drone pad with smooth A/B key crossfading.
pub struct WorshipPadPlayer {
    slots: [PadSlot; 2],
    active_slot: usize,
    current_key: i8,
    lfo_phase: f32,
    target_key: Arc<AtomicI8>,
    enabled: Arc<AtomicBool>,
    volume: Arc<AtomicU32>,
    voice: Arc<std::sync::atomic::AtomicU8>,
}

impl WorshipPadPlayer {
    pub fn new(
        target_key: Arc<AtomicI8>,
        enabled: Arc<AtomicBool>,
        volume: Arc<AtomicU32>,
        voice: Arc<std::sync::atomic::AtomicU8>,
    ) -> Self {
        Self {
            slots: [PadSlot::default(); 2],
            active_slot: 0,
            current_key: -1,
            lfo_phase: 0.0,
            target_key,
            enabled,
            volume,
            voice,
        }
    }

    pub fn render_into(&mut self, output: &mut [f32], channels: u16, sample_rate: u32) {
        let enabled = self.enabled.load(Ordering::Relaxed);
        let desired_key = if enabled {
            self.target_key.load(Ordering::Relaxed).clamp(0, 11)
        } else {
            -1
        };

        if desired_key != self.current_key {
            self.current_key = desired_key;
            // Fade out the currently active slot.
            self.slots[self.active_slot].target_gain = 0.0;
            if desired_key >= 0 {
                // Switch to the other slot for smooth A/B crossfade.
                let next_slot = 1 - self.active_slot;
                self.active_slot = next_slot;
                if self.slots[next_slot].key != desired_key {
                    self.slots[next_slot].key = desired_key;
                    self.slots[next_slot].gain = 0.0;
                    self.slots[next_slot].phases = [0.0; 6];
                }
                self.slots[next_slot].target_gain = 1.0;
            }
        }

        if self.slots[0].gain <= 0.0001
            && self.slots[0].target_gain == 0.0
            && self.slots[1].gain <= 0.0001
            && self.slots[1].target_gain == 0.0
        {
            return;
        }

        let ch = channels.max(1) as usize;
        let num_frames = output.len() / ch;
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let voice = self.voice.load(Ordering::Relaxed);
        let fade_step = 1.0 / (sample_rate as f32 * 1.4).max(1.0);
        let lfo_rate = match voice {
            1 => 0.22, // Shimmer
            4 => 0.18, // Airy Choir
            _ => 0.14,
        };
        let lfo_inc = lfo_rate / sample_rate as f32;
        let sr = sample_rate as f64;

        for frame_idx in 0..num_frames {
            let shimmer_lfo = 0.75 + 0.25 * (self.lfo_phase * TAU).sin();
            self.lfo_phase = (self.lfo_phase + lfo_inc).fract();

            let mut pad_l = 0.0_f32;
            let mut pad_r = 0.0_f32;

            for slot in &mut self.slots {
                if slot.gain <= 0.0001 && slot.target_gain == 0.0 {
                    slot.gain = 0.0;
                    continue;
                }

                if slot.gain < slot.target_gain {
                    slot.gain = (slot.gain + fade_step).min(slot.target_gain);
                } else if slot.gain > slot.target_gain {
                    slot.gain = (slot.gain - fade_step).max(slot.target_gain);
                }

                // Base root in C2..B2 (MIDI 36..47) + C3..B3 + fifth + octave.
                let root_midi = 36.0 + slot.key as f64;
                let f_sub = 440.0 * 2.0_f64.powf((root_midi - 69.0) / 12.0);
                let f_root = f_sub * 2.0;
                let f_fifth = f_root * 1.498_307; // 7 semitones
                let f_oct = f_root * 2.0;
                let f_hi_fifth = f_oct * 1.498_307;

                let detune = match voice {
                    5 => 0.0045, // Bright Analog: wider detune
                    1 | 4 => 0.0032,
                    _ => 0.0025,
                };

                let freqs = match voice {
                    1 => [
                        f_sub,
                        f_root * (1.0 - detune),
                        f_root * (1.0 + detune),
                        f_oct * 0.9985,
                        f_oct * 1.0015,
                        f_hi_fifth,
                    ],
                    2 => [
                        f_sub,
                        f_root,
                        f_fifth,
                        f_oct,
                        f_hi_fifth,
                        f_oct * 2.0,
                    ],
                    _ => [
                        f_sub,
                        f_root * (1.0 - detune),
                        f_root * (1.0 + detune),
                        f_fifth * 0.9985,
                        f_fifth * 1.0015,
                        f_oct,
                    ],
                };

                let mut s = [0.0_f32; 6];
                for i in 0..6 {
                    let ph = slot.phases[i] as f32;
                    s[i] = match voice {
                        // Bright Analog: warm saturated saw-like blend
                        5 => {
                            let sine = (ph * TAU).sin();
                            let tri = (ph * 2.0 * TAU).sin() * 0.35 + (ph * 3.0 * TAU).sin() * 0.16;
                            (sine + tri) * 0.78
                        }
                        // Organ: drawbar-like 1st + 2nd harmonic warmth
                        2 => (ph * TAU).sin() * 0.85 + (ph * 2.0 * TAU).sin() * 0.22,
                        _ => (ph * TAU).sin(),
                    };
                    slot.phases[i] = (slot.phases[i] + freqs[i] / sr).fract();
                }

                let env = slot.gain * slot.gain * 0.22; // smooth equal-power-like curve
                let (l, r) = match voice {
                    // 1: Shimmer (lush high octave + fifth swell)
                    1 => (
                        (s[0] * 0.25 + s[1] * 0.34 + s[2] * 0.16 + s[3] * 0.30 * shimmer_lfo + s[5] * 0.24 * shimmer_lfo) * env,
                        (s[0] * 0.25 + s[2] * 0.34 + s[1] * 0.16 + s[4] * 0.30 * shimmer_lfo + s[5] * 0.24 * shimmer_lfo) * env,
                    ),
                    // 2: Organ (rich drawbar balance)
                    2 => (
                        (s[0] * 0.36 + s[1] * 0.36 + s[2] * 0.26 + s[3] * 0.24 + s[4] * 0.14 + s[5] * 0.08) * env,
                        (s[0] * 0.36 + s[1] * 0.36 + s[2] * 0.26 + s[3] * 0.24 + s[4] * 0.14 + s[5] * 0.08) * env,
                    ),
                    // 3: Deep Sub (warm low foundation)
                    3 => (
                        (s[0] * 0.62 + s[1] * 0.34 + s[2] * 0.18 + s[3] * 0.14) * env,
                        (s[0] * 0.62 + s[2] * 0.34 + s[1] * 0.18 + s[4] * 0.14) * env,
                    ),
                    // 4: Airy Choir (wide fifth + breathing upper octave)
                    4 => (
                        (s[0] * 0.22 + s[1] * 0.32 + s[3] * 0.36 + s[5] * 0.28 * shimmer_lfo) * env,
                        (s[0] * 0.22 + s[2] * 0.32 + s[4] * 0.36 + s[5] * 0.28 * shimmer_lfo) * env,
                    ),
                    // 5: Bright Analog
                    5 => (
                        (s[0] * 0.30 + s[1] * 0.44 + s[2] * 0.22 + s[3] * 0.26 + s[5] * 0.22 * shimmer_lfo) * env,
                        (s[0] * 0.30 + s[2] * 0.44 + s[1] * 0.22 + s[4] * 0.26 + s[5] * 0.22 * shimmer_lfo) * env,
                    ),
                    // 0: Warm (default)
                    _ => (
                        (s[0] * 0.35 + s[1] * 0.42 + s[2] * 0.18 + s[3] * 0.28 + s[5] * 0.16 * shimmer_lfo) * env,
                        (s[0] * 0.35 + s[2] * 0.42 + s[1] * 0.18 + s[4] * 0.28 + s[5] * 0.16 * shimmer_lfo) * env,
                    ),
                };
                pad_l += l;
                pad_r += r;
            }

            let base = frame_idx * ch;
            if ch == 1 {
                output[base] = (output[base] + (pad_l + pad_r) * 0.5 * vol).clamp(-1.0, 1.0);
            } else {
                output[base] = (output[base] + pad_l * vol).clamp(-1.0, 1.0);
                output[base + 1] = (output[base + 1] + pad_r * vol).clamp(-1.0, 1.0);
            }
        }
    }
}

/// Synthesizes an 8-second seamless 120 BPM 4-bar backing track (C–G–Am–F) with drums and bass.
pub fn synthesize_demo_backing_track() -> SampleData {
    let sample_rate = 44_100_u32;
    let total_frames = (sample_rate * 8) as usize; // 4 bars at 120 BPM (2.0s per bar)
    let mut frames = Vec::with_capacity(total_frames);

    // Bass root MIDI notes per bar: C2 (36), G2 (43), A2 (45), F2 (41).
    let bar_roots = [36_u8, 43, 45, 41];
    let mut rng: u32 = 0x1234_5678;
    let mut next_noise = || -> f32 {
        rng = rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((rng >> 9) as f32 / (u32::MAX >> 9) as f32) * 2.0 - 1.0
    };

    for i in 0..total_frames {
        let t = i as f32 / sample_rate as f32;
        let bar_idx = ((t / 2.0) as usize).min(3);
        let bar_t = t - (bar_idx as f32 * 2.0);
        let beat_t = bar_t % 0.5; // 120 BPM quarter note = 0.5s
        let eighth_t = bar_t % 0.25;

        let noise = next_noise();

        // Kick on beats 1 & 3 (bar_t 0.0 and 1.0)
        let kick_t = bar_t % 1.0;
        let kick_env = (-kick_t * 16.0).exp();
        let kick_freq = 48.0 + 95.0 * (-kick_t * 35.0).exp();
        let kick = (TAU * kick_freq * kick_t).sin() * kick_env * 0.45;

        // Snare on beats 2 & 4 (bar_t 0.5 and 1.5)
        let snare_t = if bar_t >= 0.5 { (bar_t - 0.5) % 1.0 } else { 1.0 };
        let snare = if snare_t < 0.25 {
            let env = (-snare_t * 24.0).exp();
            let body = (TAU * 185.0 * snare_t).sin() * 0.4;
            (noise * 0.45 + body) * env * 0.28
        } else {
            0.0
        };

        // Closed hi-hat on 8th notes
        let hat_env = (-eighth_t * 65.0).exp();
        let hat = noise * hat_env * 0.09;

        // Warm bass playing 8th-note pulse
        let root_hz = 440.0 * 2.0_f32.powf((bar_roots[bar_idx] as f32 - 69.0) / 12.0);
        let bass_atk = (beat_t / 0.01).min(1.0);
        let bass_dec = (-beat_t * 2.8).exp();
        let bass = ((TAU * root_hz * t).sin() + 0.3 * (TAU * root_hz * 2.0 * t).sin())
            * bass_atk
            * bass_dec
            * 0.26;

        let mix = (kick + snare + hat + bass).clamp(-0.95, 0.95);
        frames.push([mix, mix]);
    }

    SampleData {
        frames,
        sample_rate,
        loop_region: None,
    }
}

