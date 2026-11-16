import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface AudioDeviceDto {
  name: string;
  isDefault: boolean;
  defaultSampleRate: number;
  channels: number;
  supportedBufferSizes: number[];
}

interface SoundDto {
  id: string;
  name: string;
}

interface StatusDto {
  audioDevice: string;
  sampleRate: number;
  bufferSize: number | null;
  estimatedLatencyMs: number;
  midiDevice: string | null;
  activeSoundId: string;
  masterVolume: number;
  isPlaying: boolean;
  activeVoices: number;
}

interface InitialStateDto {
  midiDevices: string[];
  audioDevices: AudioDeviceDto[];
  sounds: SoundDto[];
  status: StatusDto;
}

interface TelemetryDto {
  isPlaying: boolean;
  activeVoices: number;
  estimatedLatencyMs: number;
  midiDevice: string | null;
}

const DEFAULT_BUFFERS = [64, 128, 256, 512, 1024];

interface PianoKeyDef {
  code: string;
  label: string;
  semitone: number;
  isBlack: boolean;
  /** Position in white-key units for black keys */
  whiteIndex: number;
}

const PIANO_KEYS: PianoKeyDef[] = [
  { code: "KeyA", label: "A", semitone: 0, isBlack: false, whiteIndex: 0 },
  { code: "KeyW", label: "W", semitone: 1, isBlack: true, whiteIndex: 0 },
  { code: "KeyS", label: "S", semitone: 2, isBlack: false, whiteIndex: 1 },
  { code: "KeyE", label: "E", semitone: 3, isBlack: true, whiteIndex: 1 },
  { code: "KeyD", label: "D", semitone: 4, isBlack: false, whiteIndex: 2 },
  { code: "KeyF", label: "F", semitone: 5, isBlack: false, whiteIndex: 3 },
  { code: "KeyT", label: "T", semitone: 6, isBlack: true, whiteIndex: 3 },
  { code: "KeyG", label: "G", semitone: 7, isBlack: false, whiteIndex: 4 },
  { code: "KeyY", label: "Y", semitone: 8, isBlack: true, whiteIndex: 4 },
  { code: "KeyH", label: "H", semitone: 9, isBlack: false, whiteIndex: 5 },
  { code: "KeyU", label: "U", semitone: 10, isBlack: true, whiteIndex: 5 },
  { code: "KeyJ", label: "J", semitone: 11, isBlack: false, whiteIndex: 6 },
  { code: "KeyK", label: "K", semitone: 12, isBlack: false, whiteIndex: 7 },
  { code: "KeyO", label: "O", semitone: 13, isBlack: true, whiteIndex: 7 },
  { code: "KeyL", label: "L", semitone: 14, isBlack: false, whiteIndex: 8 },
  { code: "KeyP", label: "P", semitone: 15, isBlack: true, whiteIndex: 8 },
  { code: "Semicolon", label: ";", semitone: 16, isBlack: false, whiteIndex: 9 },
  { code: "Quote", label: "'", semitone: 17, isBlack: false, whiteIndex: 10 },
];

const WHITE_KEYS = PIANO_KEYS.filter((k) => !k.isBlack);
const BLACK_KEYS = PIANO_KEYS.filter((k) => k.isBlack);
const CODE_TO_SEMITONE = new Map<string, number>(
  PIANO_KEYS.map((k) => [k.code, k.semitone])
);

const KEYBOARD_STORAGE_KEY = "takt:computer-keyboard";

export default function App() {
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceDto[]>([]);
  const [sounds, setSounds] = useState<SoundDto[]>([]);
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyboardEnabled, setKeyboardEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(KEYBOARD_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [octave, setOctave] = useState<number>(4);
  const [activeKeys, setActiveKeys] = useState<Set<string>>(() => new Set());
  const activeKeyNotesRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    invoke<InitialStateDto>("get_initial_state")
      .then((data) => {
        setMidiDevices(data.midiDevices);
        setAudioDevices(data.audioDevices);
        setSounds(data.sounds);
        setStatus(data.status);
      })
      .catch((err) => setError(String(err)));

    const unlistenTelemetry = listen<TelemetryDto>("takt://telemetry", (event) => {
      setStatus((prev) =>
        prev
          ? {
              ...prev,
              isPlaying: event.payload.isPlaying,
              activeVoices: event.payload.activeVoices,
              estimatedLatencyMs: event.payload.estimatedLatencyMs,
              midiDevice: event.payload.midiDevice,
            }
          : prev
      );
    });

    const unlistenMidi = listen<string[]>("takt://midi-devices", (event) => {
      setMidiDevices(event.payload);
    });

    return () => {
      unlistenTelemetry.then((fn) => fn());
      unlistenMidi.then((fn) => fn());
    };
  }, []);

  const releaseAllKeyboardNotes = useCallback(() => {
    if (activeKeyNotesRef.current.size === 0) return;
    const notes = Array.from(activeKeyNotesRef.current.values());
    activeKeyNotesRef.current.clear();
    setActiveKeys(new Set());
    for (const note of notes) {
      invoke("trigger_test_note", { note, down: false }).catch(() => {});
    }
  }, []);

  const triggerKeyNote = useCallback(
    (code: string, down: boolean) => {
      if (down) {
        if (activeKeyNotesRef.current.has(code)) return;
        const semitone = CODE_TO_SEMITONE.get(code);
        if (semitone === undefined) return;
        const note = (octave + 1) * 12 + semitone;
        if (note < 0 || note > 127) return;
        activeKeyNotesRef.current.set(code, note);
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.add(code);
          return next;
        });
        invoke("trigger_test_note", { note, down: true, velocity: 100 }).catch(
          (err) => setError(String(err))
        );
      } else {
        const note = activeKeyNotesRef.current.get(code);
        if (note === undefined) return;
        activeKeyNotesRef.current.delete(code);
        setActiveKeys((prev) => {
          const next = new Set(prev);
          next.delete(code);
          return next;
        });
        invoke("trigger_test_note", { note, down: false }).catch((err) =>
          setError(String(err))
        );
      }
    },
    [octave]
  );

  useEffect(() => {
    try {
      localStorage.setItem(KEYBOARD_STORAGE_KEY, String(keyboardEnabled));
    } catch {
      // ignore storage errors
    }
    if (!keyboardEnabled) {
      releaseAllKeyboardNotes();
    }
  }, [keyboardEnabled, releaseAllKeyboardNotes]);

  useEffect(() => {
    if (!keyboardEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "KeyZ") {
        e.preventDefault();
        setOctave((o) => Math.max(0, o - 1));
        return;
      }
      if (e.code === "KeyX") {
        e.preventDefault();
        setOctave((o) => Math.min(7, o + 1));
        return;
      }
      if (!CODE_TO_SEMITONE.has(e.code)) return;
      e.preventDefault();
      triggerKeyNote(e.code, true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!activeKeyNotesRef.current.has(e.code)) return;
      e.preventDefault();
      triggerKeyNote(e.code, false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseAllKeyboardNotes);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseAllKeyboardNotes);
    };
  }, [keyboardEnabled, triggerKeyNote, releaseAllKeyboardNotes]);

  const currentAudioDevice = audioDevices.find(
    (d) => d.name === status?.audioDevice
  );
  const bufferChoices =
    currentAudioDevice && currentAudioDevice.supportedBufferSizes.length > 0
      ? currentAudioDevice.supportedBufferSizes
      : DEFAULT_BUFFERS;

  const handleMidiChange = async (value: string) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("select_midi_device", {
        deviceName: value === "" ? null : value,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAudioChange = async (deviceName: string, bufferSize: number | null) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("select_audio_device", {
        deviceName: deviceName === "" ? null : deviceName,
        bufferSize,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSoundSelect = async (soundId: string) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("select_sound", { soundId });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleVolumeChange = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) => (prev ? { ...prev, masterVolume: volume } : prev));
    try {
      await invoke("set_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handlePanic = async () => {
    setError(null);
    releaseAllKeyboardNotes();
    try {
      const next = await invoke<StatusDto>("panic_all_notes_off");
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const triggerAudition = async (down: boolean) => {
    try {
      await invoke("trigger_test_note", { note: 60, down });
    } catch (err) {
      setError(String(err));
    }
  };

  const volumePct = Math.round((status?.masterVolume ?? 0.8) * 100);

  return (
    <main className="rack">
      <header className="rack-header">
        <div className="brand">
          <h1 className="brand-name">Takt</h1>
          <span className="brand-tag">Live Instrument Host</span>
        </div>

        <div className="telemetry-strip" aria-live="polite">
          <div className="activity-indicator">
            <span
              className={`led ${status?.isPlaying ? "active" : ""}`}
              aria-hidden="true"
            />
            <span>
              {status?.isPlaying
                ? `PLAYING (${status.activeVoices})`
                : "IDLE"}
            </span>
          </div>
          <div className="latency-readout">
            {status ? `${status.estimatedLatencyMs.toFixed(1)} ms` : "-- ms"}
          </div>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      <section className="grid-2">
        <div className="field">
          <label htmlFor="midi-select">MIDI Input</label>
          <select
            id="midi-select"
            value={status?.midiDevice ?? ""}
            onChange={(e) => handleMidiChange(e.target.value)}
          >
            <option value="">
              {midiDevices.length === 0
                ? "No MIDI devices connected"
                : "Select MIDI keyboard…"}
            </option>
            {midiDevices.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="audio-select">Audio Output</label>
          <select
            id="audio-select"
            value={status?.audioDevice ?? ""}
            onChange={(e) =>
              handleAudioChange(e.target.value, status?.bufferSize ?? null)
            }
          >
            {audioDevices.map((dev) => (
              <option key={dev.name} value={dev.name}>
                {dev.name} {dev.isDefault ? "(Default)" : ""}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="grid-2">
        <div className="field">
          <label htmlFor="buffer-select">Buffer Size</label>
          <select
            id="buffer-select"
            value={status?.bufferSize ?? ""}
            onChange={(e) => {
              const val = e.target.value === "" ? null : Number(e.target.value);
              handleAudioChange(status?.audioDevice ?? "", val);
            }}
          >
            <option value="">System Default</option>
            {bufferChoices.map((frames) => (
              <option key={frames} value={frames}>
                {frames} samples
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sample-rate-info">Stream Format</label>
          <div
            id="sample-rate-info"
            style={{
              padding: "10px 12px",
              background: "var(--bg-recessed)",
              border: "1px solid var(--border-subtle)",
              borderRadius: "8px",
              fontFamily: "var(--font-mono)",
              fontSize: "0.88rem",
              color: "var(--text-muted)",
            }}
          >
            {status ? `${status.sampleRate} Hz · 32-voice poly` : "Loading…"}
          </div>
        </div>
      </section>

      <section className="sound-section">
        <label>Sound</label>
        <div className="sound-grid" role="radiogroup" aria-label="Built-in Sounds">
          {sounds.map((sound, idx) => {
            const selected = status?.activeSoundId === sound.id;
            return (
              <button
                key={sound.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`sound-pad ${selected ? "selected" : ""}`}
                onClick={() => handleSoundSelect(sound.id)}
              >
                <span className="sound-pad-meta">0{idx + 1}</span>
                <span className="sound-pad-title">{sound.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="keyboard-section">
        <div className="keyboard-header">
          <div className="keyboard-title-group">
            <label>Computer Keyboard</label>
            <span className="keyboard-hint">
              {keyboardEnabled ? "Z / X octave · A–' play" : "Disabled"}
            </span>
          </div>

          <div className="keyboard-controls">
            <div className="octave-stepper" aria-label="Keyboard Octave">
              <button
                type="button"
                className="step-btn"
                onClick={() => setOctave((o) => Math.max(0, o - 1))}
                disabled={octave <= 0}
                title="Octave Down (Z)"
              >
                −
              </button>
              <span className="octave-readout">C{octave}</span>
              <button
                type="button"
                className="step-btn"
                onClick={() => setOctave((o) => Math.min(7, o + 1))}
                disabled={octave >= 7}
                title="Octave Up (X)"
              >
                +
              </button>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={keyboardEnabled}
              className={`toggle-pill ${keyboardEnabled ? "on" : ""}`}
              onClick={() => setKeyboardEnabled((v) => !v)}
            >
              <span className="toggle-dot" aria-hidden="true" />
              <span>{keyboardEnabled ? "ON" : "OFF"}</span>
            </button>
          </div>
        </div>

        <div
          className={`mini-piano ${keyboardEnabled ? "" : "disabled"}`}
          aria-label="Computer Keyboard Layout"
        >
          <div className="white-keys">
            {WHITE_KEYS.map((key) => {
              const pressed = activeKeys.has(key.code);
              return (
                <button
                  key={key.code}
                  type="button"
                  tabIndex={-1}
                  className={`piano-key white ${pressed ? "pressed" : ""}`}
                  onPointerDown={() => triggerKeyNote(key.code, true)}
                  onPointerUp={() => triggerKeyNote(key.code, false)}
                  onPointerLeave={() => triggerKeyNote(key.code, false)}
                  onPointerCancel={() => triggerKeyNote(key.code, false)}
                >
                  <span className="key-cap">{key.label}</span>
                </button>
              );
            })}
          </div>
          <div className="black-keys">
            {BLACK_KEYS.map((key) => {
              const pressed = activeKeys.has(key.code);
              const leftPct = ((key.whiteIndex + 0.65) / WHITE_KEYS.length) * 100;
              return (
                <button
                  key={key.code}
                  type="button"
                  tabIndex={-1}
                  style={{ left: `${leftPct}%` }}
                  className={`piano-key black ${pressed ? "pressed" : ""}`}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    triggerKeyNote(key.code, true);
                  }}
                  onPointerUp={() => triggerKeyNote(key.code, false)}
                  onPointerLeave={() => triggerKeyNote(key.code, false)}
                  onPointerCancel={() => triggerKeyNote(key.code, false)}
                >
                  <span className="key-cap">{key.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <footer className="bottom-bar">
        <div className="volume-control">
          <div className="field-row">
            <label htmlFor="master-volume">Master Volume</label>
            <span className="volume-value">{volumePct}%</span>
          </div>
          <input
            id="master-volume"
            type="range"
            min={0}
            max={125}
            value={volumePct}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
          />
        </div>

        <button
          type="button"
          className="btn"
          onMouseDown={() => triggerAudition(true)}
          onMouseUp={() => triggerAudition(false)}
          onMouseLeave={() => triggerAudition(false)}
          onKeyDown={(e) => {
            if (e.key === " " || e.key === "Enter") {
              e.preventDefault();
              triggerAudition(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === " " || e.key === "Enter") {
              triggerAudition(false);
            }
          }}
        >
          Test C4
        </button>

        <button
          type="button"
          className="btn btn-panic"
          onClick={handlePanic}
        >
          Panic · All Notes Off
        </button>
      </footer>
    </main>
  );
}

