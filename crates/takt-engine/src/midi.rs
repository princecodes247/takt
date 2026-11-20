use midir::{Ignore, MidiInput, MidiInputConnection};

use crate::EngineError;

/// Parsed MIDI event pushed from the MIDI callback into the lock-free audio queue.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MidiEvent {
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    NoteOff {
        channel: u8,
        note: u8,
    },
    SustainPedal {
        channel: u8,
        pressed: bool,
    },
    ModWheel {
        channel: u8,
        value: u8,
    },
    PitchBend {
        channel: u8,
        /// Signed 14-bit pitch bend in `-8192..=8191` (`0` is center).
        value: i16,
    },
    ProgramChange {
        channel: u8,
        program: u8,
    },
    AllNotesOff,
}

/// Metadata describing an available MIDI input port.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MidiDeviceInfo {
    pub name: String,
}

/// Active MIDI input connection; closes automatically when dropped.
pub struct MidiInputHandle {
    _connection: MidiInputConnection<()>,
    pub device_name: String,
}

/// Parses a raw MIDI packet into a `MidiEvent` (supports all 16 channels).
pub fn parse_midi_message(bytes: &[u8]) -> Option<MidiEvent> {
    let status = *bytes.first()?;
    if status >= 0xF0 {
        return None;
    }

    let kind = status & 0xF0;
    let channel = status & 0x0F;

    match kind {
        0x80 => {
            let note = *bytes.get(1)? & 0x7F;
            Some(MidiEvent::NoteOff { channel, note })
        }
        0x90 => {
            let note = *bytes.get(1)? & 0x7F;
            let velocity = *bytes.get(2)? & 0x7F;
            if velocity == 0 {
                Some(MidiEvent::NoteOff { channel, note })
            } else {
                Some(MidiEvent::NoteOn {
                    channel,
                    note,
                    velocity,
                })
            }
        }
        0xB0 => {
            let cc = *bytes.get(1)? & 0x7F;
            let value = *bytes.get(2)? & 0x7F;
            match cc {
                1 => Some(MidiEvent::ModWheel { channel, value }),
                64 => Some(MidiEvent::SustainPedal {
                    channel,
                    pressed: value >= 64,
                }),
                120 | 123 => Some(MidiEvent::AllNotesOff),
                _ => None,
            }
        }
        0xE0 => {
            let lsb = (*bytes.get(1)? & 0x7F) as i16;
            let msb = (*bytes.get(2)? & 0x7F) as i16;
            let value = ((msb << 7) | lsb) - 8192;
            Some(MidiEvent::PitchBend { channel, value })
        }
        0xC0 => {
            let program = *bytes.get(1)? & 0x7F;
            Some(MidiEvent::ProgramChange { channel, program })
        }
        _ => None,
    }
}

/// Lists all currently connected MIDI input devices.
pub fn list_midi_devices() -> Result<Vec<MidiDeviceInfo>, EngineError> {
    let mut midi_in =
        MidiInput::new("takt-midi-enum").map_err(|e| EngineError::DeviceQuery(e.to_string()))?;
    midi_in.ignore(Ignore::None);

    let ports = midi_in.ports();
    let mut devices = Vec::with_capacity(ports.len());
    for port in ports {
        if let Ok(name) = midi_in.port_name(&port) {
            devices.push(MidiDeviceInfo { name });
        }
    }
    Ok(devices)
}

/// Opens a MIDI input port by exact name and invokes `on_event` for each parsed message.
pub fn open_midi_input<F>(device_name: &str, mut on_event: F) -> Result<MidiInputHandle, EngineError>
where
    F: FnMut(MidiEvent) + Send + 'static,
{
    let mut midi_in =
        MidiInput::new("takt-midi-in").map_err(|e| EngineError::DeviceQuery(e.to_string()))?;
    midi_in.ignore(Ignore::All);

    let port = midi_in
        .ports()
        .into_iter()
        .find(|p| midi_in.port_name(p).ok().as_deref() == Some(device_name))
        .ok_or_else(|| EngineError::DeviceNotFound(device_name.to_string()))?;

    let connection = midi_in
        .connect(
            &port,
            "takt-input",
            move |_stamp, message, _| {
                if let Some(event) = parse_midi_message(message) {
                    on_event(event);
                }
            },
            (),
        )
        .map_err(|e| EngineError::StreamError(format!("failed to open MIDI port: {e}")))?;

    Ok(MidiInputHandle {
        _connection: connection,
        device_name: device_name.to_string(),
    })
}

#[cfg(target_os = "macos")]
mod watcher {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    };
    use std::thread::{self, JoinHandle};

    use core_foundation::runloop::CFRunLoop;
    use coremidi::{Client, Notification};

    use crate::EngineError;

    /// Event-driven macOS CoreMIDI topology watcher (zero polling).
    pub struct MidiDeviceWatcher {
        run_loop: CFRunLoop,
        stopped: Arc<AtomicBool>,
        handle: Option<JoinHandle<()>>,
    }

    impl MidiDeviceWatcher {
        pub fn new<F>(mut on_change: F) -> Result<Self, EngineError>
        where
            F: FnMut() + Send + 'static,
        {
            let stopped = Arc::new(AtomicBool::new(false));
            let stopped_thread = Arc::clone(&stopped);
            let (tx, rx) = mpsc::sync_channel::<Result<CFRunLoop, String>>(1);

            let handle = thread::Builder::new()
                .name("takt-midi-watcher".to_string())
                .spawn(move || {
                    let run_loop = CFRunLoop::get_current();
                    let client = Client::new_with_notifications(
                        "takt-midi-watcher",
                        move |notification: &Notification| match notification {
                            Notification::ObjectAdded(_)
                            | Notification::ObjectRemoved(_)
                            | Notification::SetupChanged
                            | Notification::PropertyChanged(_) => {
                                on_change();
                            }
                            _ => {}
                        },
                    );

                    match client {
                        Ok(_client) => {
                            let _ = tx.send(Ok(run_loop));
                            while !stopped_thread.load(Ordering::Acquire) {
                                CFRunLoop::run_current();
                                // On modern macOS, CoreMIDI may deliver notifications via XPC/dispatch
                                // without attaching a source to this thread's CFRunLoop, causing
                                // run_current() to return immediately. Keep `_client` alive until Drop.
                                if !stopped_thread.load(Ordering::Acquire) {
                                    std::thread::sleep(std::time::Duration::from_millis(250));
                                }
                            }
                        }
                        Err(status) => {
                            let _ = tx.send(Err(format!(
                                "failed to create CoreMIDI notification client (OSStatus {status})"
                            )));
                        }
                    }
                })
                .map_err(|e| EngineError::StreamError(format!("failed to spawn MIDI watcher: {e}")))?;

            let run_loop = rx
                .recv()
                .map_err(|_| EngineError::StreamError("MIDI watcher thread exited early".to_string()))?
                .map_err(EngineError::StreamError)?;

            Ok(Self {
                run_loop,
                stopped,
                handle: Some(handle),
            })
        }
    }

    impl Drop for MidiDeviceWatcher {
        fn drop(&mut self) {
            self.stopped.store(true, Ordering::Release);
            self.run_loop.stop();
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod watcher {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    use std::thread::{self, JoinHandle};
    use std::time::Duration;

    use super::list_midi_devices;
    use crate::EngineError;

    /// Fallback polling MIDI device watcher for non-macOS platforms.
    pub struct MidiDeviceWatcher {
        stopped: Arc<AtomicBool>,
        handle: Option<JoinHandle<()>>,
    }

    impl MidiDeviceWatcher {
        pub fn new<F>(mut on_change: F) -> Result<Self, EngineError>
        where
            F: FnMut() + Send + 'static,
        {
            let stopped = Arc::new(AtomicBool::new(false));
            let stopped_thread = Arc::clone(&stopped);
            let handle = thread::Builder::new()
                .name("takt-midi-watcher".to_string())
                .spawn(move || {
                    let mut last: Vec<String> = list_midi_devices()
                        .unwrap_or_default()
                        .into_iter()
                        .map(|d| d.name)
                        .collect();
                    while !stopped_thread.load(Ordering::Acquire) {
                        thread::sleep(Duration::from_secs(1));
                        if stopped_thread.load(Ordering::Acquire) {
                            break;
                        }
                        let current: Vec<String> = list_midi_devices()
                            .unwrap_or_default()
                            .into_iter()
                            .map(|d| d.name)
                            .collect();
                        if current != last {
                            last = current;
                            on_change();
                        }
                    }
                })
                .map_err(|e| EngineError::StreamError(format!("failed to spawn MIDI watcher: {e}")))?;

            Ok(Self {
                stopped,
                handle: Some(handle),
            })
        }
    }

    impl Drop for MidiDeviceWatcher {
        fn drop(&mut self) {
            self.stopped.store(true, Ordering::Release);
            if let Some(handle) = self.handle.take() {
                let _ = handle.join();
            }
        }
    }
}

pub use watcher::MidiDeviceWatcher;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_note_on_and_zero_velocity_note_off() {
        assert_eq!(
            parse_midi_message(&[0x93, 60, 100]),
            Some(MidiEvent::NoteOn {
                channel: 3,
                note: 60,
                velocity: 100
            })
        );
        assert_eq!(
            parse_midi_message(&[0x93, 60, 0]),
            Some(MidiEvent::NoteOff {
                channel: 3,
                note: 60
            })
        );
        assert_eq!(
            parse_midi_message(&[0x8F, 72, 64]),
            Some(MidiEvent::NoteOff {
                channel: 15,
                note: 72
            })
        );
    }

    #[test]
    fn parses_cc_and_pitch_bend() {
        assert_eq!(
            parse_midi_message(&[0xB0, 64, 127]),
            Some(MidiEvent::SustainPedal {
                channel: 0,
                pressed: true
            })
        );
        assert_eq!(
            parse_midi_message(&[0xB0, 64, 0]),
            Some(MidiEvent::SustainPedal {
                channel: 0,
                pressed: false
            })
        );
        assert_eq!(
            parse_midi_message(&[0xB2, 1, 90]),
            Some(MidiEvent::ModWheel {
                channel: 2,
                value: 90
            })
        );
        assert_eq!(
            parse_midi_message(&[0xE0, 0x00, 0x40]),
            Some(MidiEvent::PitchBend {
                channel: 0,
                value: 0
            })
        );
        assert_eq!(
            parse_midi_message(&[0xE0, 0x7F, 0x7F]),
            Some(MidiEvent::PitchBend {
                channel: 0,
                value: 8191
            })
        );
        assert_eq!(
            parse_midi_message(&[0xE0, 0x00, 0x00]),
            Some(MidiEvent::PitchBend {
                channel: 0,
                value: -8192
            })
        );
    }

    #[test]
    fn midi_device_watcher_starts_and_drops_cleanly() {
        let watcher = MidiDeviceWatcher::new(|| {}).expect("watcher should start");
        drop(watcher);
    }
}

