use std::f32::consts::TAU;
use std::fs::File;
use std::io::Cursor;
use std::path::Path;

use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

use crate::EngineError;

/// Decoded stereo audio sample stored completely in memory.
#[derive(Debug, Clone)]
pub struct SampleData {
    /// Stereo interleaved frames `[L, R, L, R, ...]`.
    pub frames: Vec<[f32; 2]>,
    pub sample_rate: u32,
    pub loop_region: Option<(usize, usize)>,
}

/// Key-range mapping for a single sample inside a `SampleBank`.
#[derive(Debug, Clone)]
pub struct SampleZone {
    pub min_note: u8,
    pub max_note: u8,
    pub root_note: u8,
    pub sample: SampleData,
}

/// A playable instrument sound consisting of mapped sample zones.
#[derive(Debug, Clone)]
pub struct SampleBank {
    pub id: String,
    pub name: String,
    pub release_ms: f32,
    pub zones: Vec<SampleZone>,
}

impl SampleBank {
    /// Finds the best zone index for a given MIDI note.
    pub fn find_zone_index(&self, note: u8) -> Option<usize> {
        self.zones
            .iter()
            .enumerate()
            .find(|(_, z)| note >= z.min_note && note <= z.max_note)
            .map(|(idx, _)| idx)
            .or_else(|| {
                self.zones
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, z)| (z.root_note as i16 - note as i16).abs())
                    .map(|(idx, _)| idx)
            })
    }
}

/// Decodes an audio file (WAV, FLAC, OGG) from disk into memory using `symphonia`.
pub fn decode_audio_file(path: &Path) -> Result<SampleData, EngineError> {
    let file = File::open(path)
        .map_err(|e| EngineError::SampleLoad(format!("failed to open {}: {e}", path.display())))?;
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());
    decode_media_stream(mss, &hint)
}

/// Decodes an audio buffer (WAV, FLAC, OGG) from memory using `symphonia`.
pub fn decode_audio_bytes(bytes: Vec<u8>, extension: &str) -> Result<SampleData, EngineError> {
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let mss = MediaSourceStream::new(Box::new(Cursor::new(bytes)), Default::default());
    decode_media_stream(mss, &hint)
}

fn decode_media_stream(
    mss: MediaSourceStream,
    hint: &Hint,
) -> Result<SampleData, EngineError> {
    let probed = symphonia::default::get_probe()
        .format(
            hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| EngineError::SampleLoad(format!("unsupported format: {e}")))?;

    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| EngineError::SampleLoad("no audio track found".to_string()))?;

    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| EngineError::SampleLoad("missing sample rate".to_string()))?;
    let channels = track
        .codec_params
        .channels
        .map(|c| c.count())
        .unwrap_or(1)
        .max(1);

    let mut decoder = symphonia::default::get_codecs()
        .make(&track.codec_params, &DecoderOptions::default())
        .map_err(|e| EngineError::SampleLoad(format!("decoder init failed: {e}")))?;

    let mut frames = Vec::new();
    let mut sample_buf: Option<SampleBuffer<f32>> = None;

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(SymphoniaError::IoError(err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(SymphoniaError::ResetRequired) => {
                decoder.reset();
                continue;
            }
            Err(e) => return Err(EngineError::SampleLoad(format!("packet read failed: {e}"))),
        };

        if packet.track_id() != track_id {
            continue;
        }

        let decoded = match decoder.decode(&packet) {
            Ok(d) => d,
            Err(SymphoniaError::DecodeError(_)) => continue,
            Err(e) => return Err(EngineError::SampleLoad(format!("decode failed: {e}"))),
        };

        let spec = *decoded.spec();
        let buf = sample_buf.get_or_insert_with(|| {
            SampleBuffer::<f32>::new(decoded.capacity() as u64, spec)
        });
        buf.copy_interleaved_ref(decoded);
        let samples = buf.samples();

        for chunk in samples.chunks_exact(channels) {
            let left = chunk[0];
            let right = if channels > 1 { chunk[1] } else { left };
            frames.push([left, right]);
        }
    }

    if frames.is_empty() {
        return Err(EngineError::SampleLoad("decoded sample was empty".to_string()));
    }

    Ok(SampleData {
        frames,
        sample_rate,
        loop_region: None,
    })
}

/// Returns the 3 built-in starter sound banks (Grand Piano, Electric Piano, Synth Pad).
///
/// If WAV files exist under `samples_dir/<id>/<note>.wav`, they are decoded via `symphonia`;
/// otherwise, built-in synthesized multi-zone starter samples are generated in memory.
pub fn load_built_in_banks(samples_dir: Option<&Path>) -> Vec<SampleBank> {
    let specs = [
        ("piano", "Grand Piano", 45.0_f32),
        ("epiano", "Electric Piano", 55.0_f32),
        ("pad", "Synth Pad", 180.0_f32),
    ];

    specs
        .into_iter()
        .map(|(id, name, release_ms)| {
            if let Some(dir) = samples_dir {
                let bank_dir = dir.join(id);
                if let Some(bank) = try_load_dir_bank(id, name, release_ms, &bank_dir) {
                    return bank;
                }
            }
            synthesize_starter_bank(id, name, release_ms)
        })
        .collect()
}

fn try_load_dir_bank(
    id: &str,
    name: &str,
    release_ms: f32,
    dir: &Path,
) -> Option<SampleBank> {
    let entries = std::fs::read_dir(dir).ok()?;
    let mut loaded: Vec<(u8, SampleData)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Ok(root_note) = stem.parse::<u8>() else {
            continue;
        };
        if let Ok(sample) = decode_audio_file(&path) {
            loaded.push((root_note, sample));
        }
    }

    if loaded.is_empty() {
        return None;
    }

    loaded.sort_by_key(|(note, _)| *note);
    let zones = build_zones_from_roots(loaded);
    Some(SampleBank {
        id: id.to_string(),
        name: name.to_string(),
        release_ms,
        zones,
    })
}

fn build_zones_from_roots(roots: Vec<(u8, SampleData)>) -> Vec<SampleZone> {
    let count = roots.len();
    let mut zones = Vec::with_capacity(count);
    for (i, (root_note, sample)) in roots.iter().enumerate() {
        let min_note = if i == 0 {
            0
        } else {
            ((roots[i - 1].0 as u16 + *root_note as u16) / 2 + 1) as u8
        };
        let max_note = if i + 1 == count {
            127
        } else {
            ((*root_note as u16 + roots[i + 1].0 as u16) / 2) as u8
        };
        zones.push(SampleZone {
            min_note,
            max_note,
            root_note: *root_note,
            sample: sample.clone(),
        });
    }
    zones
}

fn synthesize_starter_bank(id: &str, name: &str, release_ms: f32) -> SampleBank {
    let sample_rate = 44_100;
    let root_notes = [36_u8, 48, 60, 72, 84];
    let roots = root_notes
        .into_iter()
        .map(|note| {
            let sample = match id {
                "epiano" => synth_epiano_sample(note, sample_rate),
                "pad" => synth_pad_sample(note, sample_rate),
                _ => synth_piano_sample(note, sample_rate),
            };
            (note, sample)
        })
        .collect();

    SampleBank {
        id: id.to_string(),
        name: name.to_string(),
        release_ms,
        zones: build_zones_from_roots(roots),
    }
}

fn midi_note_to_hz(note: u8) -> f32 {
    440.0 * 2.0_f32.powf((note as f32 - 69.0) / 12.0)
}

fn synth_piano_sample(note: u8, sample_rate: u32) -> SampleData {
    let duration_secs = 2.5_f32;
    let total = (sample_rate as f32 * duration_secs) as usize;
    let freq = midi_note_to_hz(note);
    let mut frames = Vec::with_capacity(total);

    for i in 0..total {
        let t = i as f32 / sample_rate as f32;
        let attack = (t / 0.004).min(1.0);
        let decay = (-t * 2.4).exp();
        let bright_decay = (-t * 7.5).exp();

        let fundamental = (TAU * freq * t).sin();
        let h2 = 0.45 * (TAU * freq * 2.0 * t).sin() * bright_decay;
        let h3 = 0.22 * (TAU * freq * 3.0 * t).sin() * bright_decay;
        let h4 = 0.10 * (TAU * freq * 4.0 * t).sin() * (-t * 12.0).exp();

        let mono = (fundamental + h2 + h3 + h4) * attack * decay * 0.55;
        frames.push([mono, mono]);
    }

    SampleData {
        frames,
        sample_rate,
        loop_region: None,
    }
}

fn synth_epiano_sample(note: u8, sample_rate: u32) -> SampleData {
    let duration_secs = 2.8_f32;
    let total = (sample_rate as f32 * duration_secs) as usize;
    let freq = midi_note_to_hz(note);
    let mut frames = Vec::with_capacity(total);

    for i in 0..total {
        let t = i as f32 / sample_rate as f32;
        let attack = (t / 0.005).min(1.0);
        let body_decay = (-t * 1.4).exp();
        let tine_decay = (-t * 9.0).exp();

        let body = (TAU * freq * t + 0.35 * (TAU * freq * 2.0 * t).sin() * (-t * 4.0).exp()).sin();
        let tine = 0.28 * (TAU * freq * 7.0 * t).sin() * tine_decay;
        let tremolo = 1.0 - 0.12 * (0.5 + 0.5 * (TAU * 4.2 * t).sin());

        let left = (body * body_decay + tine) * attack * tremolo * 0.6;
        let right = (body * body_decay + tine) * attack * (2.0 - tremolo) * 0.6;
        frames.push([left, right]);
    }

    SampleData {
        frames,
        sample_rate,
        loop_region: None,
    }
}

fn synth_pad_sample(note: u8, sample_rate: u32) -> SampleData {
    let duration_secs = 3.0_f32;
    let total = (sample_rate as f32 * duration_secs) as usize;
    let freq = midi_note_to_hz(note);
    let mut frames = Vec::with_capacity(total);

    for i in 0..total {
        let t = i as f32 / sample_rate as f32;
        let attack = (t / 0.08).min(1.0);
        let d1 = (TAU * freq * 0.996 * t).sin();
        let d2 = (TAU * freq * t).sin();
        let d3 = (TAU * freq * 1.004 * t).sin();
        let sub = 0.35 * (TAU * freq * 0.5 * t).sin();
        let shimmer = 0.15 * (TAU * freq * 2.0 * t).sin();

        let left = (d1 * 0.45 + d2 * 0.35 + sub + shimmer) * attack * 0.32;
        let right = (d3 * 0.45 + d2 * 0.35 + sub + shimmer) * attack * 0.32;
        frames.push([left, right]);
    }

    // Loop the sustained middle section with an equal-power crossfade so held pad notes never click.
    let loop_start = (sample_rate as f32 * 0.5) as usize;
    let loop_end = (sample_rate as f32 * 2.5) as usize;
    let xfade = ((sample_rate as f32 * 0.25) as usize).min(loop_start);

    for k in 0..xfade {
        let theta = (k as f32 / xfade as f32) * std::f32::consts::FRAC_PI_2;
        let fade_out = theta.cos();
        let fade_in = theta.sin();
        let tail_idx = loop_end - xfade + k;
        let pre_idx = loop_start - xfade + k;
        frames[tail_idx][0] = frames[tail_idx][0] * fade_out + frames[pre_idx][0] * fade_in;
        frames[tail_idx][1] = frames[tail_idx][1] * fade_out + frames[pre_idx][1] * fade_in;
    }
    frames[loop_end] = frames[loop_start];

    SampleData {
        frames,
        sample_rate,
        loop_region: Some((loop_start, loop_end)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_minimal_wav_via_symphonia() {
        // Build a minimal 16-bit mono PCM WAV in memory (441 frames at 44100 Hz).
        let num_samples: u32 = 441;
        let data_bytes = num_samples * 2;
        let mut wav = Vec::with_capacity(44 + data_bytes as usize);
        wav.extend_from_slice(b"RIFF");
        wav.extend_from_slice(&(36 + data_bytes).to_le_bytes());
        wav.extend_from_slice(b"WAVE");
        wav.extend_from_slice(b"fmt ");
        wav.extend_from_slice(&16_u32.to_le_bytes());
        wav.extend_from_slice(&1_u16.to_le_bytes()); // PCM
        wav.extend_from_slice(&1_u16.to_le_bytes()); // mono
        wav.extend_from_slice(&44100_u32.to_le_bytes());
        wav.extend_from_slice(&(44100_u32 * 2).to_le_bytes());
        wav.extend_from_slice(&2_u16.to_le_bytes());
        wav.extend_from_slice(&16_u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&data_bytes.to_le_bytes());
        for i in 0..num_samples {
            let s = ((TAU * 440.0 * i as f32 / 44100.0).sin() * 16000.0) as i16;
            wav.extend_from_slice(&s.to_le_bytes());
        }

        let decoded = decode_audio_bytes(wav, "wav").expect("should decode WAV");
        assert_eq!(decoded.sample_rate, 44100);
        assert_eq!(decoded.frames.len(), num_samples as usize);
    }

    #[test]
    fn built_in_banks_include_three_sounds() {
        let banks = load_built_in_banks(None);
        assert_eq!(banks.len(), 3);
        assert!(banks.iter().all(|b| b.find_zone_index(60).is_some()));
    }

    #[test]
    fn synth_pad_loop_boundary_is_continuous() {
        let pad = synth_pad_sample(60, 44_100);
        let (loop_start, loop_end) = pad.loop_region.expect("pad should have loop region");
        let diff_l = (pad.frames[loop_end - 1][0] - pad.frames[loop_start][0]).abs();
        let diff_r = (pad.frames[loop_end - 1][1] - pad.frames[loop_start][1]).abs();
        assert!(diff_l < 0.02, "left loop jump too large: {diff_l}");
        assert!(diff_r < 0.02, "right loop jump too large: {diff_r}");
    }
}

