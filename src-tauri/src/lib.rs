use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::time::Duration;

use serde::Serialize;
use takt_engine::audio::list_output_devices;
use takt_engine::engine::TaktEngine;
use takt_engine::midi::{list_midi_devices, MidiEvent};
use tauri::{Emitter, State};

type Reply<T> = mpsc::SyncSender<Result<T, String>>;

enum EngineCmd {
    GetInitialState(Reply<InitialStateDto>),
    SelectMidi(Option<String>, Reply<StatusDto>),
    SelectAudio(Option<String>, Option<u32>, Reply<StatusDto>),
    SelectSound(String, Reply<StatusDto>),
    SetVolume(f32),
    Panic(Reply<StatusDto>),
    TestNote(u8, bool),
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
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct StatusDto {
    audio_device: String,
    sample_rate: u32,
    buffer_size: Option<u32>,
    estimated_latency_ms: f32,
    midi_device: Option<String>,
    active_sound_id: String,
    master_volume: f32,
    is_playing: bool,
    active_voices: usize,
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
    midi_device: Option<String>,
}

fn to_status_dto(engine: &mut TaktEngine) -> StatusDto {
    let st = engine.status();
    StatusDto {
        audio_device: st.audio_device,
        sample_rate: st.sample_rate,
        buffer_size: st.buffer_size,
        estimated_latency_ms: st.estimated_latency_ms,
        midi_device: st.midi_device,
        active_sound_id: st.active_sound_id,
        master_volume: st.master_volume,
        is_playing: st.is_playing,
        active_voices: st.active_voices,
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

fn call_engine<T>(tx: &Sender<EngineCmd>, make_cmd: impl FnOnce(Reply<T>) -> EngineCmd) -> Result<T, String> {
    let (reply_tx, reply_rx) = mpsc::sync_channel(1);
    tx.send(make_cmd(reply_tx))
        .map_err(|_| "engine thread stopped".to_string())?;
    reply_rx
        .recv()
        .map_err(|_| "engine thread dropped reply".to_string())?
}

#[tauri::command]
fn get_initial_state(state: State<'_, AppState>) -> Result<InitialStateDto, String> {
    call_engine(&state.tx, EngineCmd::GetInitialState)
}

#[tauri::command]
fn refresh_audio_devices() -> Vec<AudioDeviceDto> {
    collect_audio_devices()
}

#[tauri::command]
fn select_midi_device(
    state: State<'_, AppState>,
    device_name: Option<String>,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::SelectMidi(device_name, reply))
}

#[tauri::command]
fn select_audio_device(
    state: State<'_, AppState>,
    device_name: Option<String>,
    buffer_size: Option<u32>,
) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| {
        EngineCmd::SelectAudio(device_name, buffer_size, reply)
    })
}

#[tauri::command]
fn select_sound(state: State<'_, AppState>, sound_id: String) -> Result<StatusDto, String> {
    call_engine(&state.tx, |reply| EngineCmd::SelectSound(sound_id, reply))
}

#[tauri::command]
fn set_volume(state: State<'_, AppState>, volume: f32) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::SetVolume(volume))
        .map_err(|_| "engine thread stopped".to_string())
}

#[tauri::command]
fn panic_all_notes_off(state: State<'_, AppState>) -> Result<StatusDto, String> {
    call_engine(&state.tx, EngineCmd::Panic)
}

#[tauri::command]
fn trigger_test_note(state: State<'_, AppState>, note: u8, down: bool) -> Result<(), String> {
    state
        .tx
        .send(EngineCmd::TestNote(note, down))
        .map_err(|_| "engine thread stopped".to_string())
}

pub fn run() {
    let (tx, rx) = mpsc::channel::<EngineCmd>();

    tauri::Builder::default()
        .manage(AppState { tx })
        .setup(move |app| {
            let app_handle = app.handle().clone();
            std::thread::spawn(move || {
                let samples_dir = PathBuf::from("assets/samples");
                let dir_opt = samples_dir.exists().then_some(samples_dir.as_path());
                let mut engine = TaktEngine::new(dir_opt).expect("failed to initialize TaktEngine");

                let mut last_midi_list = collect_midi_names();
                let mut tick: u32 = 0;

                loop {
                    while let Ok(cmd) = rx.try_recv() {
                        match cmd {
                            EngineCmd::GetInitialState(reply) => {
                                let sounds = engine
                                    .sounds()
                                    .into_iter()
                                    .map(|s| SoundDto {
                                        id: s.id,
                                        name: s.name,
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
                                    .map(|_| to_status_dto(&mut engine))
                                    .map_err(|e| e.to_string());
                                let _ = reply.send(res);
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
                            EngineCmd::TestNote(note, down) => {
                                let event = if down {
                                    MidiEvent::NoteOn {
                                        channel: 0,
                                        note,
                                        velocity: 100,
                                    }
                                } else {
                                    MidiEvent::NoteOff { channel: 0, note }
                                };
                                engine.inject_midi_event(event);
                            }
                        }
                    }

                    tick = tick.wrapping_add(1);
                    if tick % 10 == 0 {
                        let current_midi = collect_midi_names();
                        if current_midi != last_midi_list {
                            last_midi_list = current_midi.clone();
                            if let Some(active_name) = engine.status().midi_device {
                                if !current_midi.contains(&active_name) {
                                    let _ = engine.select_midi_input(None);
                                }
                            }
                            let _ = app_handle.emit("takt://midi-devices", current_midi);
                        }
                    }

                    let st = engine.status();
                    let _ = app_handle.emit(
                        "takt://telemetry",
                        TelemetryDto {
                            is_playing: st.is_playing,
                            active_voices: st.active_voices,
                            estimated_latency_ms: st.estimated_latency_ms,
                            midi_device: st.midi_device,
                        },
                    );

                    std::thread::sleep(Duration::from_millis(50));
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_initial_state,
            refresh_audio_devices,
            select_midi_device,
            select_audio_device,
            select_sound,
            set_volume,
            panic_all_notes_off,
            trigger_test_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Takt");
}
