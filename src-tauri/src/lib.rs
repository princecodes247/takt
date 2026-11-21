use std::path::PathBuf;
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use takt_engine::audio::list_output_devices;
use takt_engine::engine::TaktEngine;
use takt_engine::midi::{list_midi_devices, MidiDeviceWatcher, MidiEvent};
use takt_engine::voice::{SoundParams, VoiceMode};
use tauri::{Emitter, Manager, State};

type Reply<T> = mpsc::SyncSender<Result<T, String>>;

enum EngineCmd {
    GetInitialState(Reply<InitialStateDto>),
    SelectMidi(Option<String>, Reply<StatusDto>),
    SetMidiDevices(Vec<String>, Reply<StatusDto>),
    SelectAudio(Option<String>, Option<u32>, Reply<StatusDto>),
    SelectSound(String, Reply<StatusDto>),
    SetVolume(f32),
    Panic(Reply<StatusDto>),
    TestNote(u8, bool, u8),
    SetSustain(bool),
    MidiDevicesChanged,
    LoadBackingTrack(String, Vec<u8>, String, Reply<StatusDto>),
    SetBackingTrackPlaying(bool, Reply<StatusDto>),
    SetBackingTrackLoop(bool, Reply<StatusDto>),
    SetBackingTrackVolume(f32),
    SeekBackingTrack(u32),
    SetWorshipPad(bool, i8, Reply<StatusDto>),
    SetWorshipPadVolume(f32),
    SetWorshipPadVoice(u8),
    SetSoundParams(SoundParams),
    AddLayer(String, Reply<StatusDto>),
    RemoveLayer(usize, Reply<StatusDto>),
    SetLayerSound(usize, String, Reply<StatusDto>),
    UpdateLayer {
        index: usize,
        enabled: bool,
        volume: f32,
        min_note: u8,
        max_note: u8,
        octave_shift: i8,
        params: SoundParams,
    },
}

struct AppState {
    tx: Sender<EngineCmd>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AudioDeviceDto {
    name: String,
    is_default: bool,
    default_sample_rate: u32,
    channels: u16,
    supported_buffer_sizes: Vec<u32>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SoundDto {
    id: String,
    name: String,
    category: String,
    supported_params: Vec<&'static str>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SoundParamsDto {
    brightness: f32,
    attack_ms: f32,
    release_ms: f32,
    reverb_mix: f32,
    stereo_width: f32,
    hammer_hardness: f32,
    sample_offset_ms: f32,
    vel_track: f32,
    glide_ms: f32,
    resonance: f32,
    chorus_mix: f32,
    tremolo_depth: f32,
    delay_mix: f32,
    voice_mode: String,
    #[serde(default = "default_decay_ms")]
    decay_ms: f32,
    #[serde(default = "default_one")]
    sustain_level: f32,
    #[serde(default = "default_mod_min")]
    mod_filter_min_hz: f32,
    #[serde(default = "default_mod_max")]
    mod_filter_max_hz: f32,
    #[serde(default)]
    comp_enabled: bool,
    #[serde(default)]
    comp_input_db: f32,
    #[serde(default = "default_comp_attack")]
    comp_attack_ms: f32,
    #[serde(default = "default_comp_release")]
    comp_release_ms: f32,
    #[serde(default = "default_comp_ratio")]
    comp_ratio: f32,
    #[serde(default = "default_comp_thresh")]
    comp_threshold_db: f32,
    #[serde(default = "default_comp_mix")]
    comp_mix: f32,
    #[serde(default = "default_comp_out")]
    comp_output_db: f32,
    #[serde(default)]
    eq_enabled: bool,
    #[serde(default = "default_eq_freqs")]
    eq_freqs: [f32; 8],
    #[serde(default)]
    eq_gains: [f32; 6],
    #[serde(default = "default_eq_qs")]
    eq_qs: [f32; 4],
    #[serde(default)]
    block_sustain: bool,
    #[serde(default)]
    pan: f32,
}

fn default_decay_ms() -> f32 { 10000.0 }
fn default_one() -> f32 { 1.0 }
fn default_mod_min() -> f32 { 200.0 }
fn default_mod_max() -> f32 { 20000.0 }
fn default_comp_attack() -> f32 { 15.0 }
fn default_comp_release() -> f32 { 49.0 }
fn default_comp_ratio() -> f32 { 4.2 }
fn default_comp_thresh() -> f32 { -29.0 }
fn default_comp_mix() -> f32 { 0.85 }
fn default_comp_out() -> f32 { 3.5 }
fn default_eq_freqs() -> [f32; 8] { [67.0, 200.0, 197.0, 345.0, 1000.0, 5417.0, 1101.0, 9000.0] }
fn default_eq_qs() -> [f32; 4] { [0.28, 0.30, 0.50, 0.36] }

impl From<SoundParams> for SoundParamsDto {
    fn from(p: SoundParams) -> Self {
        let voice_mode = match p.voice_mode {
            VoiceMode::Poly => "poly",
            VoiceMode::Mono => "mono",
            VoiceMode::Legato => "legato",
        }
        .to_string();
        Self {
            brightness: p.brightness,
            attack_ms: p.attack_ms,
            release_ms: p.release_ms,
            reverb_mix: p.reverb_mix,
            stereo_width: p.stereo_width,
            hammer_hardness: p.hammer_hardness,
            sample_offset_ms: p.sample_offset_ms,
            vel_track: p.vel_track,
            glide_ms: p.glide_ms,
            resonance: p.resonance,
            chorus_mix: p.chorus_mix,
            tremolo_depth: p.tremolo_depth,
            delay_mix: p.delay_mix,
            voice_mode,
            decay_ms: p.decay_ms,
            sustain_level: p.sustain_level,
            mod_filter_min_hz: p.mod_filter_min_hz,
            mod_filter_max_hz: p.mod_filter_max_hz,
            comp_enabled: p.comp_enabled,
            comp_input_db: p.comp_input_db,
            comp_attack_ms: p.comp_attack_ms,
            comp_release_ms: p.comp_release_ms,
            comp_ratio: p.comp_ratio,
            comp_threshold_db: p.comp_threshold_db,
            comp_mix: p.comp_mix,
            comp_output_db: p.comp_output_db,
            eq_enabled: p.eq_enabled,
            eq_freqs: p.eq_freqs,
            eq_gains: p.eq_gains,
            eq_qs: p.eq_qs,
            block_sustain: p.block_sustain,
            pan: p.pan,
        }
    }
}

impl From<SoundParamsDto> for SoundParams {
    fn from(p: SoundParamsDto) -> Self {
        let voice_mode = match p.voice_mode.as_str() {
            "mono" => VoiceMode::Mono,
            "legato" => VoiceMode::Legato,
            _ => VoiceMode::Poly,
        };
        Self {
            brightness: p.brightness,
            attack_ms: p.attack_ms,
            release_ms: p.release_ms,
            reverb_mix: p.reverb_mix,
            stereo_width: p.stereo_width,
            hammer_hardness: p.hammer_hardness,
            sample_offset_ms: p.sample_offset_ms,
            vel_track: p.vel_track,
            glide_ms: p.glide_ms,
            resonance: p.resonance,
            chorus_mix: p.chorus_mix,
            tremolo_depth: p.tremolo_depth,
            delay_mix: p.delay_mix,
            voice_mode,
            decay_ms: p.decay_ms,
            sustain_level: p.sustain_level,
            mod_filter_min_hz: p.mod_filter_min_hz,
            mod_filter_max_hz: p.mod_filter_max_hz,
            comp_enabled: p.comp_enabled,
            comp_input_db: p.comp_input_db,
            comp_attack_ms: p.comp_attack_ms,
            comp_release_ms: p.comp_release_ms,
            comp_ratio: p.comp_ratio,
            comp_threshold_db: p.comp_threshold_db,
            comp_mix: p.comp_mix,
            comp_output_db: p.comp_output_db,
            eq_enabled: p.eq_enabled,
            eq_freqs: p.eq_freqs,
            eq_gains: p.eq_gains,
            eq_qs: p.eq_qs,
            block_sustain: p.block_sustain,
            pan: p.pan,
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LayerDto {
    sound_id: String,
    sound_name: String,
    category: String,
    supported_params: Vec<&'static str>,
    enabled: bool,
    volume: f32,
    min_note: u8,
    max_note: u8,
    octave_shift: i8,
    params: SoundParamsDto,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusDto {
    audio_device: String,
    sample_rate: u32,
    buffer_size: Option<u32>,
    estimated_latency_ms: f32,
    midi_devices: Vec<String>,
    desired_midi_devices: Vec<String>,
    active_sound_id: String,
    master_volume: f32,
    is_playing: bool,
    active_voices: usize,
    sustain_active: bool,
    backing_track_name: Option<String>,
    backing_track_playing: bool,
    backing_track_loop: bool,
    backing_track_volume: f32,
    backing_track_position_ms: u32,
    backing_track_duration_ms: u32,
    worship_pad_enabled: bool,
    worship_pad_key: i8,
    worship_pad_volume: f32,
    worship_pad_voice: u8,
    sound_params: SoundParamsDto,
    layers: Vec<LayerDto>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct InitialStateDto {
    midi_devices: Vec<String>,
    audio_devices: Vec<AudioDeviceDto>,
    sounds: Vec<SoundDto>,
    status: StatusDto,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TelemetryDto {
    is_playing: bool,
    active_voices: usize,
    estimated_latency_ms: f32,
    midi_devices: Vec<String>,
    desired_midi_devices: Vec<String>,
    active_midi_notes: Vec<u8>,
    sustain_active: bool,
    backing_track_playing: bool,
    backing_track_position_ms: u32,
    backing_track_duration_ms: u32,
}

fn to_status_dto(engine: &mut TaktEngine) -> StatusDto {
    let st = engine.status();
    StatusDto {
        audio_device: st.audio_device,
        sample_rate: st.sample_rate,
        buffer_size: st.buffer_size,
        estimated_latency_ms: st.estimated_latency_ms,
        midi_devices: st.midi_devices,
        desired_midi_devices: st.desired_midi_devices,
        active_sound_id: st.active_sound_id,
        master_volume: st.master_volume,
        is_playing: st.is_playing,
        active_voices: st.active_voices,
        sustain_active: st.sustain_active,
        backing_track_name: st.backing_track_name,
        backing_track_playing: st.backing_track_playing,
        backing_track_loop: st.backing_track_loop,
        backing_track_volume: st.backing_track_volume,
        backing_track_position_ms: st.backing_track_position_ms,
        backing_track_duration_ms: st.backing_track_duration_ms,
        worship_pad_enabled: st.worship_pad_enabled,
        worship_pad_key: st.worship_pad_key,
        worship_pad_volume: st.worship_pad_volume,
        worship_pad_voice: st.worship_pad_voice,
        sound_params: st.sound_params.into(),
        layers: st
            .layers
            .into_iter()
            .map(|l| LayerDto {
                sound_id: l.sound_id,
                sound_name: l.sound_name,
                category: l.category,
                supported_params: l.supported_params,
                enabled: l.enabled,
                volume: l.volume,
                min_note: l.min_note,
                max_note: l.max_note,
                octave_shift: l.octave_shift,
                params: l.params.into(),
            })
            .collect(),
    }
}

fn collect_midi_names() -> Vec<String> {
    list_midi_devices()
        .unwrap_or_default()
        .into_iter()
        .map(|d| d.name)
        .collect()
}

fn collect_audio_devices() -> Vec<AudioDeviceDto> {
    list_output_devices()
        .unwrap_or_default()
        .into_iter()
        .map(|d| AudioDeviceDto {
            name: d.name,
            is_default: d.is_default,
            default_sample_rate: d.default_sample_rate,
            channels: d.channels,
            supported_buffer_sizes: d.supported_buffer_sizes,
        })
        .collect()
}

async fn call_engine<T: Send + 'static>(
    tx: &Sender<EngineCmd>,
    make_cmd: impl FnOnce(Reply<T>) -> EngineCmd,
) -> Result<T, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    tx.send(make_cmd(reply_tx))
        .map_err(|_| "engine thread stopped".to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        reply_rx
            .recv()
            .map_err(|_| "engine thread dropped reply".to_string())?
    })
    .await
    .map_err(|e| format!("engine task failed: {e}"))?
}

#[tauri::command]
async fn get_initial_state(state: State<'_, AppState>) -> Result<InitialStateDto, String> {
    call_engine(&state.tx, EngineCmd::GetInitialState).await
}

#[tauri::command]
async fn refresh_audio_devices() -> Vec<AudioDeviceDto> {
    tauri::async_runtime::spawn_blocking(collect_audio_devices)
        .await
        .unwrap_or_default()
}

#[tauri::command]
async fn refresh_midi_devices(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let _ = state.tx.send(EngineCmd::MidiDevicesChanged);
    tauri::async_runtime::spawn_blocking(collect_midi_names)
        .await
        .map_err(|e| format!("failed to list MIDI devices: {e}"))
}

#[tauri::command]
async fn select_midi_device(
    state: State<'_, AppState>,
    device_name: Option<String>,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::SelectMidi(device_name, reply)).await
}

#[tauri::command]
async fn set_midi_devices(
    state: State<'_, AppState>,
    devices: Vec<String>,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::SetMidiDevices(devices, reply)).await
}

#[tauri::command]
async fn select_audio_device(
    state: State<'_, AppState>,
    device_name: Option<String>,
    buffer_size: Option<u32>,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SelectAudio(device_name, buffer_size, reply)
    })
    .await
}

#[tauri::command]
async fn select_sound(state: State<'_, AppState>, sound_id: String) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::SelectSound(sound_id, reply)).await
}

#[tauri::command]
fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetVolume(volume))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
async fn panic_all_notes_off(state: State<'_, AppState>) -> Result<StatusDto, String> {
    call_engine(&state.tx, EngineCmd::Panic).await
}

#[tauri::command]
fn trigger_test_note(
    state: State<'_, AppState>,
    note: u8,
    down: bool,
    velocity: Option<u8>,
) -> Result<(), String> {
    let vel = velocity.unwrap_or(100).min(127);
    state
        .tx
        .send(EngineCmd::TestNote(note, down, vel))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
async fn set_sustain(state: State<'_, AppState>, pressed: bool) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetSustain(pressed))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
async fn load_backing_track(
    state: State<'_, AppState>,
    request: tauri::ipc::Request<'_>,
) -> Result<StatusDto, String> {
    let name = request
        .headers()
        .get("x-track-name")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
        .unwrap_or_else(|| "Track.wav".to_string());
    let ext = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("wav")
        .to_lowercase();
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(data) => data.clone(),
        tauri::ipc::InvokeBody::Json(_) => {
            return Err("expected raw binary audio payload".to_string());
        }
    };
    call_engine(&state.tx, |reply| {
        EngineCmd::LoadBackingTrack(name, bytes, ext, reply)
    })
    .await
}

#[tauri::command]
async fn set_backing_track_playing(
    state: State<'_, AppState>,
    playing: bool,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SetBackingTrackPlaying(playing, reply)
    })
    .await
}

#[tauri::command]
async fn set_backing_track_loop(state: State<'_, AppState>, looping: bool) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SetBackingTrackLoop(looping, reply)
    })
    .await
}

#[tauri::command]
fn set_backing_track_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetBackingTrackVolume(volume))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
fn seek_backing_track(state: State<'_, AppState>, position_ms: u32) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SeekBackingTrack(position_ms))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
async fn set_worship_pad(
    state: State<'_, AppState>,
    enabled: bool,
    key: i8,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SetWorshipPad(enabled, key, reply)
    })
    .await
}

#[tauri::command]
fn set_worship_pad_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetWorshipPadVolume(volume))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
fn set_worship_pad_voice(state: State<'_, AppState>, voice: u8) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetWorshipPadVoice(voice))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
fn set_sound_params(state: State<'_, AppState>, params: SoundParamsDto) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetSoundParams(params.into()))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
async fn add_layer(state: State<'_, AppState>, sound_id: String) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::AddLayer(sound_id, reply)).await
}

#[tauri::command]
async fn remove_layer(state: State<'_, AppState>, index: usize) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::RemoveLayer(index, reply)).await
}

#[tauri::command]
async fn set_layer_sound(
    state: State<'_, AppState>,
    index: usize,
    sound_id: String,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SetLayerSound(index, sound_id, reply)
    })
    .await
}

#[tauri::command]
fn update_layer(
    state: State<'_, AppState>,
    index: usize,
    enabled: bool,
    volume: f32,
    min_note: u8,
    max_note: u8,
    octave_shift: i8,
    params: SoundParamsDto,
) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::UpdateLayer {
            index,
            enabled,
            volume,
            min_note,
            max_note,
            octave_shift,
            params: params.into(),
        })
        .map_err(|_| "engine thread stopped".to_string())
}

pub fn run() {
    let (tx, rx) = mpsc::channel::<EngineCmd>();
    let watcher_tx = tx.clone();

    tauri::Builder::default()
        .manage(AppState { tx })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            let samples_dir = [
                Some(PathBuf::from("assets/samples")),
                Some(PathBuf::from("../assets/samples")),
                app.path()
                    .resource_dir()
                    .ok()
                    .map(|p| p.join("assets/samples")),
            ]
            .into_iter()
            .flatten()
            .find(|p| p.exists());

            let midi_config_path = app
                .path()
                .app_config_dir()
                .ok()
                .map(|p| p.join("midi_config.json"));

            std::thread::spawn(move || {
                let mut engine = TaktEngine::new(samples_dir.as_deref())
                    .expect("failed to initialize TaktEngine");

                if let Some(ref cfg_path) = midi_config_path {
                    if let Ok(raw) = std::fs::read_to_string(cfg_path) {
                        if let Ok(saved) = serde_json::from_str::<Vec<String>>(&raw) {
                            engine.set_midi_devices(saved);
                        }
                    }
                }

                let save_midi_config = |devices: &[String]| {
                    if let Some(ref cfg_path) = midi_config_path {
                        if let Some(parent) = cfg_path.parent() {
                            let _ = std::fs::create_dir_all(parent);
                        }
                        if let Ok(json) = serde_json::to_string_pretty(devices) {
                            let _ = std::fs::write(cfg_path, json);
                        }
                    }
                };

                let _midi_watcher = MidiDeviceWatcher::new(move || {
                    let _ = watcher_tx.send(EngineCmd::MidiDevicesChanged);
                })
                .ok();

                let mut last_midi_list = collect_midi_names();
                let midi_scan_interval = Duration::from_millis(750);
                let mut last_midi_scan = Instant::now();
                let telemetry_interval = Duration::from_millis(50);
                let mut last_telemetry = Instant::now();
                let mut pending_cmd: Option<EngineCmd> = None;

                loop {
                    let mut midi_changed = false;
                    let mut process_cmd = |cmd: EngineCmd, midi_changed: &mut bool| match cmd {
                        EngineCmd::GetInitialState(reply) => {
                            let sounds = engine
                                .sounds()
                                .into_iter()
                                .map(|s| SoundDto {
                                    id: s.id,
                                    name: s.name,
                                    category: s.category,
                                    supported_params: s.supported_params,
                                })
                                .collect();
                            let _ = reply.send(Ok(InitialStateDto {
                                midi_devices: collect_midi_names(),
                                audio_devices: collect_audio_devices(),
                                sounds,
                                status: to_status_dto(&mut engine),
                            }));
                        }
                        EngineCmd::SelectMidi(name, reply) => {
                            let res = engine
                                .select_midi_input(name)
                                .map(|_| {
                                    let dto = to_status_dto(&mut engine);
                                    save_midi_config(&dto.desired_midi_devices);
                                    dto
                                })
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::SetMidiDevices(devices, reply) => {
                            engine.set_midi_devices(devices);
                            let dto = to_status_dto(&mut engine);
                            save_midi_config(&dto.desired_midi_devices);
                            let _ = reply.send(Ok(dto));
                        }
                        EngineCmd::SelectAudio(name, buf, reply) => {
                            let res = engine
                                .select_audio_output(name, buf)
                                .map(|_| to_status_dto(&mut engine))
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::SelectSound(id, reply) => {
                            let res = engine
                                .select_sound(&id)
                                .map(|_| to_status_dto(&mut engine))
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::SetVolume(vol) => {
                            engine.set_master_volume(vol);
                        }
                        EngineCmd::Panic(reply) => {
                            engine.panic();
                            let _ = reply.send(Ok(to_status_dto(&mut engine)));
                        }
                        EngineCmd::TestNote(note, down, velocity) => {
                            let event = if down {
                                MidiEvent::NoteOn {
                                    channel: 0,
                                    note,
                                    velocity,
                                }
                            } else {
                                MidiEvent::NoteOff { channel: 0, note }
                            };
                            engine.inject_midi_event(event);
                        }
                        EngineCmd::SetSustain(pressed) => {
                            engine.set_sustain(pressed);
                        }
                        EngineCmd::MidiDevicesChanged => {
                            *midi_changed = true;
                        }
                        EngineCmd::LoadBackingTrack(name, bytes, ext, reply) => {
                            let res = engine
                                .load_backing_track_bytes(name, bytes, &ext)
                                .map(|_| to_status_dto(&mut engine))
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::SetBackingTrackPlaying(playing, reply) => {
                            engine.set_backing_track_playing(playing);
                            let _ = reply.send(Ok(to_status_dto(&mut engine)));
                        }
                        EngineCmd::SetBackingTrackLoop(looping, reply) => {
                            engine.set_backing_track_loop(looping);
                            let _ = reply.send(Ok(to_status_dto(&mut engine)));
                        }
                        EngineCmd::SetBackingTrackVolume(vol) => {
                            engine.set_backing_track_volume(vol);
                        }
                        EngineCmd::SeekBackingTrack(ms) => {
                            engine.seek_backing_track_ms(ms);
                        }
                        EngineCmd::SetWorshipPad(enabled, key, reply) => {
                            engine.set_worship_pad(enabled, key);
                            let _ = reply.send(Ok(to_status_dto(&mut engine)));
                        }
                        EngineCmd::SetWorshipPadVolume(vol) => {
                            engine.set_worship_pad_volume(vol);
                        }
                        EngineCmd::SetWorshipPadVoice(voice) => {
                            engine.set_worship_pad_voice(voice);
                        }
                        EngineCmd::SetSoundParams(params) => {
                            engine.set_sound_params(params);
                        }
                        EngineCmd::AddLayer(sound_id, reply) => {
                            let res = engine
                                .add_layer(&sound_id)
                                .map(|_| to_status_dto(&mut engine))
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::RemoveLayer(idx, reply) => {
                            engine.remove_layer(idx);
                            let _ = reply.send(Ok(to_status_dto(&mut engine)));
                        }
                        EngineCmd::SetLayerSound(idx, sound_id, reply) => {
                            let res = engine
                                .set_layer_sound(idx, &sound_id)
                                .map(|_| to_status_dto(&mut engine))
                                .map_err(|e| e.to_string());
                            let _ = reply.send(res);
                        }
                        EngineCmd::UpdateLayer {
                            index,
                            enabled,
                            volume,
                            min_note,
                            max_note,
                            octave_shift,
                            params,
                        } => {
                            engine.update_layer(
                                index,
                                enabled,
                                volume,
                                min_note,
                                max_note,
                                octave_shift,
                                params,
                            );
                        }
                    };

                    if let Some(cmd) = pending_cmd.take() {
                        process_cmd(cmd, &mut midi_changed);
                    }
                    while let Ok(cmd) = rx.try_recv() {
                        process_cmd(cmd, &mut midi_changed);
                    }
                    drop(process_cmd);

                    if last_midi_scan.elapsed() >= midi_scan_interval {
                        last_midi_scan = Instant::now();
                        let current_midi = collect_midi_names();
                        if current_midi != last_midi_list {
                            last_midi_list = current_midi.clone();
                            engine.sync_midi_connections();
                            let _ = app_handle.emit("takt://midi-devices", current_midi);
                            midi_changed = false;
                        }
                    }

                    if midi_changed {
                        engine.sync_midi_connections();
                        let current_midi = collect_midi_names();
                        if current_midi != last_midi_list {
                            last_midi_list = current_midi.clone();
                            let _ = app_handle.emit("takt://midi-devices", current_midi);
                        }
                    }

                    if let Some(program) = engine.take_program_change() {
                        let _ = app_handle.emit("takt://program-change", program);
                    }

                    if last_telemetry.elapsed() >= telemetry_interval {
                        last_telemetry = Instant::now();
                        let st = engine.status();
                        let _ = app_handle.emit(
                            "takt://telemetry",
                            TelemetryDto {
                                is_playing: st.is_playing,
                                active_voices: st.active_voices,
                                estimated_latency_ms: st.estimated_latency_ms,
                                midi_devices: st.midi_devices,
                                desired_midi_devices: st.desired_midi_devices,
                                active_midi_notes: st.active_midi_notes,
                                sustain_active: st.sustain_active,
                                backing_track_playing: st.backing_track_playing,
                                backing_track_position_ms: st.backing_track_position_ms,
                                backing_track_duration_ms: st.backing_track_duration_ms,
                            },
                        );
                    }

                    let wait = telemetry_interval.saturating_sub(last_telemetry.elapsed());
                    match rx.recv_timeout(wait) {
                        Ok(cmd) => pending_cmd = Some(cmd),
                        Err(RecvTimeoutError::Timeout) => {}
                        Err(RecvTimeoutError::Disconnected) => break,
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            refresh_audio_devices,
            refresh_midi_devices,
            select_midi_device,
            set_midi_devices,
            select_audio_device,
            select_sound,
            set_volume,
            panic_all_notes_off,
            trigger_test_note,
            set_sustain,
            load_backing_track,
            set_backing_track_playing,
            set_backing_track_loop,
            set_backing_track_volume,
            seek_backing_track,
            set_worship_pad,
            set_worship_pad_volume,
            set_worship_pad_voice,
            set_sound_params,
            add_layer,
            remove_layer,
            set_layer_sound,
            update_layer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Takt");
}
