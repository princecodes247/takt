use std::f32::consts::TAU;
use std::fs::File;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::Arc;

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

/// Key-range and velocity-range mapping for a single sample inside a `SampleBank`.
#[derive(Debug, Clone)]
pub struct SampleZone {
    pub min_note: u8,
    pub max_note: u8,
    pub root_note: u8,
    pub min_vel: u8,
    pub max_vel: u8,
    pub root_vel: u8,
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
    /// Finds the best zone index for a given MIDI note and velocity.
    pub fn find_zone_index(&self, note: u8, velocity: u8) -> Option<usize> {
        self.zones
            .iter()
            .enumerate()
            .find(|(_, z)| {
                note >= z.min_note
                    && note <= z.max_note
                    && velocity >= z.min_vel
                    && velocity <= z.max_vel
            })
            .map(|(idx, _)| idx)
            .or_else(|| {
                self.zones
                    .iter()
                    .enumerate()
                    .min_by_key(|(_, z)| {
                        (z.root_note as i32 - note as i32).abs() * 128
                            + (z.root_vel as i32 - velocity as i32).abs()
                    })
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

    let mut frames = Vec::with_capacity(
        track
            .codec_params
            .n_frames
            .map(|n| n as usize)
            .unwrap_or(0),
    );
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

/// Lazy-loadable descriptor for a built-in or user-provided sound bank.
pub struct LazySampleBank {
    pub id: String,
    pub name: String,
    pub category: String,
    pub supported_params: Vec<&'static str>,
    pub release_ms: f32,
    pub source_dir: Option<PathBuf>,
    pub loaded: Option<Arc<SampleBank>>,
}

impl LazySampleBank {
    /// Returns the loaded `SampleBank`, decoding or synthesizing it on first access.
    pub fn get_or_load(&mut self) -> Arc<SampleBank> {
        if let Some(bank) = &self.loaded {
            return Arc::clone(bank);
        }
        let bank = if let Some(dir) = &self.source_dir {
            try_load_dir_bank(&self.id, &self.name, self.release_ms, dir)
                .unwrap_or_else(|| synthesize_starter_bank(&self.id, &self.name, self.release_ms))
        } else {
            synthesize_starter_bank(&self.id, &self.name, self.release_ms)
        };
        let arc = Arc::new(bank);
        self.loaded = Some(Arc::clone(&arc));
        arc
    }
}

/// Discovers built-in and custom `assets/samples/<id>/` banks without decoding audio yet.
pub fn discover_banks(samples_dir: Option<&Path>) -> Vec<LazySampleBank> {
    let specs = [
        ("model-d", "Model D Grand", "Model D", 65.0_f32),
        ("model-d-warm", "Model D Warm", "Model D", 85.0_f32),
        ("epiano", "Electric Piano", "Electric Pianos", 55.0_f32),
        ("pad", "Synth Pad", "Synth & Pads", 180.0_f32),
    ];

    let mut banks: Vec<LazySampleBank> = specs
        .into_iter()
        .map(|(id, name, category, release_ms)| {
            let source_dir = samples_dir
                .map(|dir| dir.join(id))
                .filter(|p| has_sample_files(p));
            LazySampleBank {
                id: id.to_string(),
                name: name.to_string(),
                category: category.to_string(),
                supported_params: supported_params_for(id, category),
                release_ms,
                source_dir,
                loaded: None,
            }
        })
        .collect();

    if let Some(dir) = samples_dir {
        if let Ok(entries) = std::fs::read_dir(dir) {
            let mut extra_dirs: Vec<(String, PathBuf)> = entries
                .flatten()
                .filter_map(|e| {
                    let path = e.path();
                    if !path.is_dir() {
                        return None;
                    }
                    let id = path.file_name()?.to_str()?.to_string();
                    if specs.iter().any(|(builtin_id, _, _, _)| *builtin_id == id) {
                        return None;
                    }
                    if !has_sample_files(&path) {
                        return None;
                    }
                    Some((id, path))
                })
                .collect();
            extra_dirs.sort_by(|a, b| a.0.cmp(&b.0));

            for (id, path) in extra_dirs {
                let (meta_name, meta_cat) = read_meta_txt(&path);
                let name = meta_name.unwrap_or_else(|| format_voice_display_name(&id));
                let category = meta_cat.unwrap_or_else(|| infer_voice_category(&id));
                let supported_params = supported_params_for(&id, &category);
                banks.push(LazySampleBank {
                    name,
                    category,
                    supported_params,
                    id,
                    release_ms: 75.0,
                    source_dir: Some(path),
                    loaded: None,
                });
            }
        }
    }

    banks
}

fn read_meta_txt(dir: &Path) -> (Option<String>, Option<String>) {
    let Ok(text) = std::fs::read_to_string(dir.join("meta.txt")) else {
        return (None, None);
    };
    let mut name = None;
    let mut category = None;
    for line in text.lines() {
        if let Some(v) = line.strip_prefix("name=") {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                name = Some(trimmed.to_string());
            }
        } else if let Some(v) = line.strip_prefix("category=") {
            let trimmed = v.trim();
            if !trimmed.is_empty() {
                category = Some(trimmed.to_string());
            }
        }
    }
    (name, category)
}

fn infer_voice_category(id: &str) -> String {
    if id.starts_with("md-") || id.starts_with("model-d") {
        "Model D".to_string()
    } else if id.contains("salamander") || id.contains("upright") {
        "Acoustic Pianos".to_string()
    } else if id.contains("fm-piano") || id.contains("epiano") || id.contains("stage-73") {
        "Electric Pianos".to_string()
    } else {
        "Custom".to_string()
    }
}

fn supported_params_for(id: &str, category: &str) -> Vec<&'static str> {
    let is_epiano = matches!(category, "Electric Pianos")
        || id.contains("epiano")
        || id.contains("rhodes")
        || id.contains("wurlitzer");

    if is_epiano {
        return vec![
            "hammer",
            "brightness",
            "tremolo",
            "chorus",
            "delay",
            "attack",
            "release",
            "offset",
            "veltrack",
            "reverb",
            "width",
        ];
    }

    let is_hammered = matches!(
        category,
        "Model D" | "Acoustic Pianos" | "GS · Piano" | "GS · Chromatic"
    ) || id.contains("piano")
        || id.contains("harpsichord")
        || id.contains("clav");

    if is_hammered {
        return vec![
            "hammer",
            "brightness",
            "attack",
            "release",
            "offset",
            "veltrack",
            "reverb",
            "width",
        ];
    }

    if matches!(
        category,
        "Synth & Pads" | "GS · Synth Lead" | "GS · Synth Pad" | "GS · Bass"
    ) {
        return vec![
            "glide",
            "brightness",
            "resonance",
            "chorus",
            "delay",
            "tremolo",
            "attack",
            "release",
            "veltrack",
            "reverb",
            "width",
        ];
    }

    if category == "GS · Organ" {
        return vec![
            "brightness",
            "chorus",
            "tremolo",
            "attack",
            "release",
            "reverb",
            "width",
        ];
    }

    if category == "GS · Drums" {
        return vec!["brightness", "release", "veltrack", "reverb", "width"];
    }

    // Plucked, strings, brass, winds, ethnic, FX
    vec![
        "brightness",
        "chorus",
        "delay",
        "attack",
        "release",
        "veltrack",
        "reverb",
        "width",
    ]
}

fn has_sample_files(dir: &Path) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return false;
    };
    entries.flatten().any(|e| {
        let p = e.path();
        p.is_file()
            && p.file_stem()
                .and_then(|s| s.to_str())
                .and_then(parse_sample_stem)
                .is_some()
    })
}

/// Returns the built-in sound banks (Model D Grand, Model D Warm, Electric Piano, Synth Pad).
///
/// If WAV files exist under `samples_dir/<id>/<note>.wav`, they are decoded via `symphonia`;
/// otherwise, built-in synthesized multi-zone starter samples are generated in memory.
pub fn load_built_in_banks(samples_dir: Option<&Path>) -> Vec<SampleBank> {
    discover_banks(samples_dir)
        .into_iter()
        .map(|mut entry| {
            let arc = entry.get_or_load();
            Arc::try_unwrap(arc).unwrap_or_else(|a| (*a).clone())
        })
        .collect()
}

fn format_voice_display_name(id: &str) -> String {
    id.split(['-', '_'])
        .filter(|part| !part.is_empty())
        .map(|part| {
            if part.eq_ignore_ascii_case("md") {
                return "Model D".to_string();
            }
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_sample_stem(stem: &str) -> Option<(u8, u8)> {
    if let Some((note_str, vel_str)) = stem.split_once("_v") {
        let note = note_str.parse::<u8>().ok()?;
        let vel = vel_str.parse::<u8>().ok()?.clamp(1, 127);
        return Some((note, vel));
    }
    let note = stem.parse::<u8>().ok()?;
    Some((note, 100))
}

fn load_loop_map(dir: &Path) -> std::collections::HashMap<String, (usize, usize)> {
    let mut map = std::collections::HashMap::new();
    let Ok(text) = std::fs::read_to_string(dir.join("loops.txt")) else {
        return map;
    };
    for line in text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(stem), Some(s), Some(e)) = (parts.next(), parts.next(), parts.next()) else {
            continue;
        };
        if let (Ok(start), Ok(end)) = (s.parse::<usize>(), e.parse::<usize>()) {
            if end > start {
                map.insert(stem.to_string(), (start, end));
            }
        }
    }
    map
}

fn try_load_dir_bank(
    id: &str,
    name: &str,
    release_ms: f32,
    dir: &Path,
) -> Option<SampleBank> {
    let entries = std::fs::read_dir(dir).ok()?;
    let loop_map = load_loop_map(dir);
    let mut paths: Vec<(u8, u8, PathBuf, Option<(usize, usize)>)> = Vec::new();

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let Some(stem) = path.file_stem().and_then(|s| s.to_str()) else {
            continue;
        };
        let Some((root_note, root_vel)) = parse_sample_stem(stem) else {
            continue;
        };
        let loop_reg = loop_map.get(stem).copied();
        paths.push((root_note, root_vel, path, loop_reg));
    }

    if paths.is_empty() {
        return None;
    }

    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .min(paths.len())
        .max(1);
    let chunk_size = paths.len().div_ceil(workers);

    let mut loaded: Vec<(u8, u8, SampleData)> = std::thread::scope(|s| {
        let handles: Vec<_> = paths
            .chunks(chunk_size)
            .map(|chunk| {
                s.spawn(move || {
                    chunk
                        .iter()
                        .filter_map(|(note, vel, path, loop_reg)| {
                            decode_audio_file(path).ok().map(|mut sample| {
                                if let Some((ls, le)) = *loop_reg {
                                    if le <= sample.frames.len() && ls < le {
                                        sample.loop_region = Some((ls, le));
                                    }
                                }
                                (*note, *vel, sample)
                            })
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();

        let mut all = Vec::with_capacity(paths.len());
        for h in handles {
            if let Ok(part) = h.join() {
                all.extend(part);
            }
        }
        all
    });

    if loaded.is_empty() {
        return None;
    }

    let zones = build_zones_from_multi_roots(std::mem::take(&mut loaded));
    Some(SampleBank {
        id: id.to_string(),
        name: name.to_string(),
        release_ms,
        zones,
    })
}

fn build_zones_from_roots(roots: Vec<(u8, SampleData)>) -> Vec<SampleZone> {
    build_zones_from_multi_roots(
        roots
            .into_iter()
            .map(|(note, sample)| (note, 100, sample))
            .collect(),
    )
}

fn build_zones_from_multi_roots(mut roots: Vec<(u8, u8, SampleData)>) -> Vec<SampleZone> {
    roots.sort_by_key(|(note, vel, _)| (*note, *vel));

    // Group by distinct root_note
    let mut groups: Vec<(u8, Vec<(u8, SampleData)>)> = Vec::new();
    for (note, vel, sample) in roots {
        if let Some(last) = groups.last_mut() {
            if last.0 == note {
                last.1.push((vel, sample));
                continue;
            }
        }
        groups.push((note, vec![(vel, sample)]));
    }

    let count = groups.len();
    let group_ranges: Vec<(u8, u8)> = (0..count)
        .map(|i| {
            let min_note = if i == 0 {
                0
            } else {
                ((groups[i - 1].0 as u16 + groups[i].0 as u16) / 2 + 1) as u8
            };
            let max_note = if i + 1 == count {
                127
            } else {
                ((groups[i].0 as u16 + groups[i + 1].0 as u16) / 2) as u8
            };
            (min_note, max_note)
        })
        .collect();

    let mut zones = Vec::with_capacity(roots_len(&groups));
    for (i, (root_note, vel_layers)) in groups.into_iter().enumerate() {
        let (min_note, max_note) = group_ranges[i];
        let vcount = vel_layers.len();
        let vel_ranges: Vec<(u8, u8)> = (0..vcount)
            .map(|vi| {
                let min_vel = if vi == 0 {
                    0
                } else {
                    ((vel_layers[vi - 1].0 as u16 + vel_layers[vi].0 as u16) / 2 + 1) as u8
                };
                let max_vel = if vi + 1 == vcount {
                    127
                } else {
                    ((vel_layers[vi].0 as u16 + vel_layers[vi + 1].0 as u16) / 2) as u8
                };
                (min_vel, max_vel)
            })
            .collect();

        for (vi, (root_vel, sample)) in vel_layers.into_iter().enumerate() {
            let (min_vel, max_vel) = vel_ranges[vi];
            zones.push(SampleZone {
                min_note,
                max_note,
                root_note,
                min_vel,
                max_vel,
                root_vel,
                sample,
            });
        }
    }
    zones
}

fn roots_len(groups: &[(u8, Vec<(u8, SampleData)>)]) -> usize {
    groups.iter().map(|(_, v)| v.len()).sum()
}

fn synthesize_starter_bank(id: &str, name: &str, release_ms: f32) -> SampleBank {
    let sample_rate = 44_100;
    let root_notes: &[u8] = match id {
        "model-d" | "model-d-warm" => &[24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90],
        _ => &[36, 48, 60, 72, 84],
    };
    let roots = root_notes
        .iter()
        .copied()
        .map(|note| {
            let sample = match id {
                "model-d" => synth_model_d_sample(note, sample_rate, 1.0),
                "model-d-warm" => synth_model_d_sample(note, sample_rate, 0.48),
                "epiano" => synth_epiano_sample(note, sample_rate),
                "pad" => synth_pad_sample(note, sample_rate),
                _ => synth_model_d_sample(note, sample_rate, 1.0),
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

/// Physical-inspired Steinway Model D Concert Grand synthesis with string inharmonicity,
/// 3-string unison beating, hammer-felt transient, and stereo soundboard imaging.
fn synth_model_d_sample(note: u8, sample_rate: u32, brightness: f32) -> SampleData {
    let register = ((note as f32 - 21.0) / 87.0).clamp(0.0, 1.0);
    let duration_secs = 4.2 - register * 2.0; // Bass rings longer than treble
    let total = (sample_rate as f32 * duration_secs) as usize;
    let freq = midi_note_to_hz(note);

    // String stiffness inharmonicity coefficient B (higher in treble, subtle in bass)
    let inharm_b = 0.000035 * 2.0_f32.powf((note as f32 - 60.0) / 16.0);
    let max_partials: usize = if note < 45 {
        14
    } else if note < 70 {
        10
    } else {
        6
    };

    // Precompute partial frequencies (with inharmonicity) and amplitudes
    let nyquist = sample_rate as f32 * 0.45;
    let mut partials: Vec<(f32, f32, f32)> = Vec::with_capacity(max_partials);
    for n in 1..=max_partials {
        let nf = n as f32;
        let stretched_freq = nf * freq * (1.0 + inharm_b * nf * nf).sqrt();
        if stretched_freq >= nyquist {
            break;
        }
        // Bass notes have a slightly softer fundamental and richer 2nd-5th partials
        let bass_boost = if n == 1 && note < 48 { 0.72 } else { 1.0 };
        let rolloff = (1.0 / nf.powf(1.18 + (1.0 - brightness) * 0.55)) * bass_boost;
        let decay_rate = (0.75 + register * 1.45) * (1.0 + (nf - 1.0) * 0.48);
        partials.push((stretched_freq, rolloff, decay_rate));
    }

    // Stereo soundboard pan: bass slightly left, treble slightly right
    let pan = (register - 0.5) * 0.42;
    let gain_l = (0.5 * (1.0 - pan)).sqrt();
    let gain_r = (0.5 * (1.0 + pan)).sqrt();

    // Deterministic noise for hammer felt thump
    let mut rng: u32 = 0x9E37_79B9_u32.wrapping_add(note as u32 * 7919);
    let mut next_noise = || -> f32 {
        rng = rng.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        ((rng >> 9) as f32 / (u32::MAX >> 9) as f32) * 2.0 - 1.0
    };

    let mut frames = Vec::with_capacity(total);
    let unison_detune_l = 0.99955_f32; // ~0.78 cents flat
    let unison_detune_r = 1.00045_f32; // ~0.78 cents sharp

    for i in 0..total {
        let t = i as f32 / sample_rate as f32;
        let attack = (t / 0.0025).min(1.0);
        // Two-stage piano envelope: fast prompt soundboard bloom + singing aftersound
        let prompt_env = 0.38 * (-t * (4.5 + register * 3.0)).exp() + 0.62;

        let mut sum_l = 0.0_f32;
        let mut sum_r = 0.0_f32;
        for &(pf, amp, dec) in &partials {
            let env = (-t * dec).exp();
            let s_c = (TAU * pf * t).sin();
            let s_l = (TAU * pf * unison_detune_l * t).sin();
            let s_r = (TAU * pf * unison_detune_r * t).sin();
            sum_l += (s_c * 0.65 + s_l * 0.35) * amp * env;
            sum_r += (s_c * 0.65 + s_r * 0.35) * amp * env;
        }

        // Brief wool-felt hammer strike transient (~12ms)
        let hammer = if t < 0.015 {
            let h_env = (-t * 280.0).exp();
            let thump = (TAU * (110.0 + register * 180.0) * t).sin();
            (thump * 0.6 + next_noise() * 0.25 * brightness) * h_env * 0.14
        } else {
            0.0
        };

        // Smooth tail fade in final 40ms so non-looped notes never cut abruptly
        let tail_fade = ((duration_secs - t) / 0.04).clamp(0.0, 1.0);
        let scale = attack * prompt_env * tail_fade * 0.55;
        let left = (sum_l * scale + hammer) * gain_l;
        let right = (sum_r * scale + hammer) * gain_r;
        frames.push([left, right]);
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
    fn built_in_banks_include_four_sounds() {
        let banks = load_built_in_banks(None);
        assert_eq!(banks.len(), 4);
        assert!(banks.iter().all(|b| b.find_zone_index(60, 100).is_some()));
    }

    #[test]
    fn multi_velocity_zones_partition_cleanly() {
        let dummy = SampleData {
            frames: vec![[0.1, 0.1]],
            sample_rate: 44_100,
            loop_region: None,
        };
        let zones = build_zones_from_multi_roots(vec![
            (60, 30, dummy.clone()),
            (60, 80, dummy.clone()),
            (60, 120, dummy),
        ]);
        let bank = SampleBank {
            id: "test".to_string(),
            name: "Test".to_string(),
            release_ms: 50.0,
            zones,
        };
        assert_eq!(bank.zones[bank.find_zone_index(60, 20).unwrap()].root_vel, 30);
        assert_eq!(bank.zones[bank.find_zone_index(60, 75).unwrap()].root_vel, 80);
        assert_eq!(bank.zones[bank.find_zone_index(60, 115).unwrap()].root_vel, 120);
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

