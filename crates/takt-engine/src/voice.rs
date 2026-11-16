use std::f32::consts::TAU;

use crate::midi::MidiEvent;
use crate::sampler::SampleBank;

pub const MAX_VOICES: usize = 32;
const PITCH_BEND_SEMITONES: f32 = 2.0;
const VIBRATO_RATE_HZ: f32 = 5.5;
const MAX_VIBRATO_SEMITONES: f32 = 0.35;

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
    pub zone_idx: usize,
    pub position: f64,
    pub velocity_gain: f32,
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
            zone_idx: 0,
            position: 0.0,
            velocity_gain: 0.0,
            env_gain: 0.0,
            release_step: 0.0,
            age: 0,
        }
    }
}

/// Fixed-size 32-voice sampler pool with zero heap allocation on the audio thread.
pub struct VoicePool {
    voices: [Voice; MAX_VOICES],
    sustain_pressed: bool,
    pitch_bend_semitones: f32,
    mod_wheel: f32,
    lfo_phase: f32,
    age_counter: u64,
}

impl Default for VoicePool {
    fn default() -> Self {
        Self {
            voices: [Voice::default(); MAX_VOICES],
            sustain_pressed: false,
            pitch_bend_semitones: 0.0,
            mod_wheel: 0.0,
            lfo_phase: 0.0,
            age_counter: 0,
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
        match event {
            MidiEvent::NoteOn {
                channel,
                note,
                velocity,
            } => {
                let Some(zone_idx) = bank.find_zone_index(note) else {
                    return;
                };
                // Re-trigger same note cleanly if already sounding on this channel.
                for v in &mut self.voices {
                    if v.state != VoiceState::Idle && v.channel == channel && v.note == note {
                        v.state = VoiceState::Releasing;
                        v.release_step = release_step_for_ms(5.0, sample_rate);
                    }
                }

                let slot = self.allocate_voice_slot();
                self.age_counter = self.age_counter.wrapping_add(1);
                let norm_vel = (velocity as f32 / 127.0).clamp(0.0, 1.0);
                let velocity_gain = 0.12 + 0.88 * norm_vel.powf(1.4);

                self.voices[slot] = Voice {
                    state: VoiceState::Playing,
                    channel,
                    note,
                    zone_idx,
                    position: 0.0,
                    velocity_gain,
                    env_gain: 1.0,
                    release_step: release_step_for_ms(bank.release_ms, sample_rate),
                    age: self.age_counter,
                };
            }
            MidiEvent::NoteOff { channel, note } => {
                for v in &mut self.voices {
                    if v.state == VoiceState::Playing && v.channel == channel && v.note == note {
                        if self.sustain_pressed {
                            v.state = VoiceState::Sustained;
                        } else {
                            v.state = VoiceState::Releasing;
                            v.release_step = release_step_for_ms(bank.release_ms, sample_rate);
                        }
                    }
                }
            }
            MidiEvent::SustainPedal { pressed, .. } => {
                self.sustain_pressed = pressed;
                if !pressed {
                    let step = release_step_for_ms(bank.release_ms, sample_rate);
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
            MidiEvent::AllNotesOff => {
                self.sustain_pressed = false;
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
        output.fill(0.0);
        let ch = channels.max(1) as usize;
        let num_frames = output.len() / ch;
        if num_frames == 0 || bank.zones.is_empty() {
            return false;
        }

        let mut any_active = false;
        let lfo_inc = VIBRATO_RATE_HZ / sample_rate as f32;

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

                let gain = v.velocity_gain * v.env_gain;
                mix_l += sample_l * gain;
                mix_r += sample_r * gain;

                let semitones =
                    (v.note as f32 - zone.root_note as f32) + self.pitch_bend_semitones + vibrato;
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
                }
            }

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
}

