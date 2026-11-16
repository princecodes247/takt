import { useEffect, useState } from "react";
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

export default function App() {
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceDto[]>([]);
  const [sounds, setSounds] = useState<SoundDto[]>([]);
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

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

