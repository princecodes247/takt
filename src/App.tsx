import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detectChord } from "./chord";

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
  category: string;
  supportedParams: string[];
}

interface StatusDto {
  audioDevice: string;
  sampleRate: number;
  bufferSize: number | null;
  estimatedLatencyMs: number;
  midiDevices: string[];
  desiredMidiDevices: string[];
  activeSoundId: string;
  masterVolume: number;
  isPlaying: boolean;
  activeVoices: number;
  backingTrackName: string | null;
  backingTrackPlaying: boolean;
  backingTrackLoop: boolean;
  backingTrackVolume: number;
  backingTrackPositionMs: number;
  backingTrackDurationMs: number;
  worshipPadEnabled: boolean;
  worshipPadKey: number;
  worshipPadVolume: number;
  soundParams: SoundParamsDto;
}

interface SoundParamsDto {
  brightness: number;
  attackMs: number;
  releaseMs: number;
  reverbMix: number;
  stereoWidth: number;
  hammerHardness: number;
  sampleOffsetMs: number;
  velTrack: number;
  glideMs: number;
  resonance: number;
  chorusMix: number;
  tremoloDepth: number;
  delayMix: number;
  voiceMode: "poly" | "mono" | "legato";
}

const DEFAULT_SOUND_PARAMS: SoundParamsDto = {
  brightness: 1.0,
  attackMs: 0.0,
  releaseMs: 85.0,
  reverbMix: 0.15,
  stereoWidth: 1.0,
  hammerHardness: 0.5,
  sampleOffsetMs: 0.0,
  velTrack: 0.88,
  glideMs: 0.0,
  resonance: 0.0,
  chorusMix: 0.0,
  tremoloDepth: 0.0,
  delayMix: 0.0,
  voiceMode: "poly",
};

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
  midiDevices: string[];
  desiredMidiDevices: string[];
  activeMidiNotes: number[];
  backingTrackPlaying: boolean;
  backingTrackPositionMs: number;
  backingTrackDurationMs: number;
}

const WORSHIP_KEYS = [
  "C",
  "C#",
  "D",
  "Eb",
  "E",
  "F",
  "F#",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

function formatTimeMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

const DEFAULT_BUFFERS = [64, 128, 256, 512, 1024];

interface QwertyKeyDef {
  code: string;
  label: string;
  semitone: number;
}

const QWERTY_KEYS: QwertyKeyDef[] = [
  { code: "KeyA", label: "A", semitone: 0 },
  { code: "KeyW", label: "W", semitone: 1 },
  { code: "KeyS", label: "S", semitone: 2 },
  { code: "KeyE", label: "E", semitone: 3 },
  { code: "KeyD", label: "D", semitone: 4 },
  { code: "KeyF", label: "F", semitone: 5 },
  { code: "KeyT", label: "T", semitone: 6 },
  { code: "KeyG", label: "G", semitone: 7 },
  { code: "KeyY", label: "Y", semitone: 8 },
  { code: "KeyH", label: "H", semitone: 9 },
  { code: "KeyU", label: "U", semitone: 10 },
  { code: "KeyJ", label: "J", semitone: 11 },
  { code: "KeyK", label: "K", semitone: 12 },
  { code: "KeyO", label: "O", semitone: 13 },
  { code: "KeyL", label: "L", semitone: 14 },
  { code: "KeyP", label: "P", semitone: 15 },
  { code: "Semicolon", label: ";", semitone: 16 },
  { code: "Quote", label: "'", semitone: 17 },
];

const CODE_TO_SEMITONE = new Map<string, number>(
  QWERTY_KEYS.map((k) => [k.code, k.semitone])
);
const SEMITONE_TO_LABEL = new Map<number, string>(
  QWERTY_KEYS.map((k) => [k.semitone, k.label])
);

interface FullPianoKey {
  note: number;
  isBlack: boolean;
  whiteIndex: number;
  cLabel?: string;
}

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
const FULL_PIANO_KEYS: FullPianoKey[] = [];
{
  let whiteCount = 0;
  for (let note = 21; note <= 108; note++) {
    const pc = note % 12;
    const isBlack = BLACK_PCS.has(pc);
    if (isBlack) {
      FULL_PIANO_KEYS.push({
        note,
        isBlack: true,
        whiteIndex: whiteCount - 1,
      });
    } else {
      const cLabel = pc === 0 ? `C${Math.floor(note / 12) - 1}` : undefined;
      FULL_PIANO_KEYS.push({
        note,
        isBlack: false,
        whiteIndex: whiteCount,
        cLabel,
      });
      whiteCount++;
    }
  }
}

const WHITE_KEYS = FULL_PIANO_KEYS.filter((k) => !k.isBlack);
const BLACK_KEYS = FULL_PIANO_KEYS.filter((k) => k.isBlack);

const KEYBOARD_STORAGE_KEY = "takt:computer-keyboard";
const CHORD_STORAGE_KEY = "takt:chord-detect";

export default function App() {
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceDto[]>([]);
  const [sounds, setSounds] = useState<SoundDto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Model D");
  const [soundSearch, setSoundSearch] = useState<string>("");
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [loadingSoundId, setLoadingSoundId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyboardEnabled, setKeyboardEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(KEYBOARD_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [chordDetectEnabled, setChordDetectEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(CHORD_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [octave, setOctave] = useState<number>(4);
  const [activeKeyboardNotes, setActiveKeyboardNotes] = useState<Set<number>>(
    () => new Set()
  );
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(
    () => new Set()
  );
  const [activeMouseNote, setActiveMouseNote] = useState<number | null>(null);
  const activeKeyNotesRef = useRef<Map<string, number>>(new Map());
  const mousePressedRef = useRef<boolean>(false);
  const activeMouseNoteRef = useRef<number | null>(null);
  const trackInputRef = useRef<HTMLInputElement | null>(null);

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
              midiDevices: event.payload.midiDevices,
              desiredMidiDevices: event.payload.desiredMidiDevices,
              backingTrackPlaying: event.payload.backingTrackPlaying,
              backingTrackPositionMs: event.payload.backingTrackPositionMs,
              backingTrackDurationMs: event.payload.backingTrackDurationMs,
            }
          : prev
      );
      setActiveMidiNotes(new Set(event.payload.activeMidiNotes));
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
    setActiveKeyboardNotes(new Set());
    for (const note of notes) {
      invoke("trigger_test_note", { note, down: false }).catch(() => {});
    }
  }, []);

  const glissandoTo = useCallback((note: number | null) => {
    const prev = activeMouseNoteRef.current;
    if (prev === note) return;
    if (prev !== null) {
      invoke("trigger_test_note", { note: prev, down: false }).catch((err) =>
        setError(String(err))
      );
    }
    activeMouseNoteRef.current = note;
    setActiveMouseNote(note);
    if (note !== null) {
      invoke("trigger_test_note", { note, down: true, velocity: 100 }).catch(
        (err) => setError(String(err))
      );
    }
  }, []);

  useEffect(() => {
    const stopMouseSlide = () => {
      if (!mousePressedRef.current && activeMouseNoteRef.current === null) return;
      mousePressedRef.current = false;
      glissandoTo(null);
    };
    window.addEventListener("pointerup", stopMouseSlide);
    window.addEventListener("pointercancel", stopMouseSlide);
    window.addEventListener("blur", stopMouseSlide);
    return () => {
      window.removeEventListener("pointerup", stopMouseSlide);
      window.removeEventListener("pointercancel", stopMouseSlide);
      window.removeEventListener("blur", stopMouseSlide);
    };
  }, [glissandoTo]);

  const triggerKeyNote = useCallback(
    (code: string, down: boolean) => {
      if (down) {
        if (activeKeyNotesRef.current.has(code)) return;
        const semitone = CODE_TO_SEMITONE.get(code);
        if (semitone === undefined) return;
        const note = (octave + 1) * 12 + semitone;
        if (note < 0 || note > 127) return;
        activeKeyNotesRef.current.set(code, note);
        setActiveKeyboardNotes(new Set(activeKeyNotesRef.current.values()));
        invoke("trigger_test_note", { note, down: true, velocity: 100 }).catch(
          (err) => setError(String(err))
        );
      } else {
        const note = activeKeyNotesRef.current.get(code);
        if (note === undefined) return;
        activeKeyNotesRef.current.delete(code);
        setActiveKeyboardNotes(new Set(activeKeyNotesRef.current.values()));
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

  useEffect(() => {
    try {
      localStorage.setItem(CHORD_STORAGE_KEY, String(chordDetectEnabled));
    } catch {
      // ignore storage errors
    }
  }, [chordDetectEnabled]);

  const soundCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sounds) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return Array.from(counts.entries()).map(([name, count]) => ({
      name,
      count,
    }));
  }, [sounds]);

  const filteredSounds = useMemo(() => {
    const q = soundSearch.trim().toLowerCase();
    if (q) {
      return sounds.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
      );
    }
    if (selectedCategory === "All") return sounds;
    return sounds.filter((s) => s.category === selectedCategory);
  }, [sounds, selectedCategory, soundSearch]);

  const activeSound = useMemo(
    () => sounds.find((s) => s.id === status?.activeSoundId) ?? null,
    [sounds, status?.activeSoundId]
  );

  const supportedParams = useMemo(
    () => new Set(activeSound?.supportedParams ?? []),
    [activeSound]
  );

  const detectedChord = useMemo(() => {
    if (!chordDetectEnabled) return null;
    const allNotes = new Set<number>(activeMidiNotes);
    for (const n of activeKeyboardNotes) allNotes.add(n);
    if (activeMouseNote !== null) allNotes.add(activeMouseNote);
    return detectChord(allNotes);
  }, [chordDetectEnabled, activeMidiNotes, activeKeyboardNotes, activeMouseNote]);

  const handleTrackFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const next = await invoke<StatusDto>("load_backing_track", buf, {
        headers: { "x-track-name": file.name },
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackPlayToggle = async () => {
    if (!status?.backingTrackName) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_backing_track_playing", {
        playing: !status.backingTrackPlaying,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackLoopToggle = async () => {
    if (!status) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_backing_track_loop", {
        looping: !status.backingTrackLoop,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackSeek = async (ms: number) => {
    setStatus((prev) =>
      prev ? { ...prev, backingTrackPositionMs: ms } : prev
    );
    try {
      await invoke("seek_backing_track", { positionMs: ms });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackVolumeChange = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) =>
      prev ? { ...prev, backingTrackVolume: volume } : prev
    );
    try {
      await invoke("set_backing_track_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadToggle = async () => {
    if (!status) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: !status.worshipPadEnabled,
        key: status.worshipPadKey,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadKey = async (key: number) => {
    if (!status) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: true,
        key,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadVolume = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) => (prev ? { ...prev, worshipPadVolume: volume } : prev));
    try {
      await invoke("set_worship_pad_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleSoundParamChange = async (patch: Partial<SoundParamsDto>) => {
    const current = status?.soundParams ?? DEFAULT_SOUND_PARAMS;
    const nextParams: SoundParamsDto = { ...current, ...patch };
    setStatus((prev) => (prev ? { ...prev, soundParams: nextParams } : prev));
    try {
      await invoke("set_sound_params", { params: nextParams });
    } catch (err) {
      setError(String(err));
    }
  };

  const currentAudioDevice = audioDevices.find(
    (d) => d.name === status?.audioDevice
  );
  const bufferChoices =
    currentAudioDevice && currentAudioDevice.supportedBufferSizes.length > 0
      ? currentAudioDevice.supportedBufferSizes
      : DEFAULT_BUFFERS;

  const handleToggleMidiDevice = async (deviceName: string) => {
    setError(null);
    const current = status?.desiredMidiDevices ?? [];
    const nextDevices = current.includes(deviceName)
      ? current.filter((d) => d !== deviceName)
      : [...current, deviceName];
    try {
      const next = await invoke<StatusDto>("set_midi_devices", {
        devices: nextDevices,
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
    if (loadingSoundId !== null) return;
    setError(null);
    setLoadingSoundId(soundId);
    try {
      const next = await invoke<StatusDto>("select_sound", { soundId });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingSoundId(null);
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
    mousePressedRef.current = false;
    glissandoTo(null);
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
          <div className="field-row">
            <label>MIDI Inputs (Multi)</label>
            <span className="midi-count">
              {status?.midiDevices.length ?? 0} active
            </span>
          </div>
          <div className="midi-device-list" role="group" aria-label="MIDI Inputs">
            {midiDevices.length === 0 &&
            (status?.desiredMidiDevices.length ?? 0) === 0 ? (
              <span className="midi-empty">No MIDI devices connected</span>
            ) : (
              <>
                {midiDevices.map((name) => {
                  const enabled =
                    status?.desiredMidiDevices.includes(name) ?? false;
                  const connected =
                    status?.midiDevices.includes(name) ?? false;
                  return (
                    <button
                      key={name}
                      type="button"
                      className={`midi-chip ${connected ? "connected" : enabled ? "enabled" : ""}`}
                      onClick={() => handleToggleMidiDevice(name)}
                      title={
                        connected
                          ? "Active — click to disable"
                          : "Click to enable"
                      }
                    >
                      <span className="midi-chip-dot" aria-hidden="true" />
                      <span>{name}</span>
                    </button>
                  );
                })}
                {(status?.desiredMidiDevices ?? [])
                  .filter((name) => !midiDevices.includes(name))
                  .map((name) => (
                    <button
                      key={`offline-${name}`}
                      type="button"
                      className="midi-chip offline"
                      onClick={() => handleToggleMidiDevice(name)}
                      title="Remembered device is offline (will auto-reconnect when plugged in). Click to forget."
                    >
                      <span className="midi-chip-dot" aria-hidden="true" />
                      <span>{name} (Offline) ×</span>
                    </button>
                  ))}
              </>
            )}
          </div>
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
            {status
              ? `${status.sampleRate} Hz · ${
                  status.soundParams.voiceMode === "mono"
                    ? "Monophonic"
                    : status.soundParams.voiceMode === "legato"
                      ? "Mono Legato"
                      : "32-voice poly"
                }`
              : "Loading…"}
          </div>
        </div>
      </section>

      <section className="sound-section">
        <div className="sound-header">
          <div className="sound-title-row">
            <label>Voices</label>
            {activeSound && (
              <span className="active-sound-pill">
                {activeSound.name} · {activeSound.category}
              </span>
            )}
            {loadingSoundId && (
              <span className="sound-loading-status" aria-live="polite">
                Loading samples…
              </span>
            )}
          </div>
          <input
            type="search"
            className="voice-search"
            placeholder={`Search ${sounds.length} voices…`}
            value={soundSearch}
            onChange={(e) => setSoundSearch(e.target.value)}
            aria-label="Search voices"
          />
        </div>

        <div className="category-tabs" role="tablist" aria-label="Voice Categories">
          <button
            type="button"
            role="tab"
            aria-selected={selectedCategory === "All" && !soundSearch}
            className={`cat-tab ${selectedCategory === "All" && !soundSearch ? "active" : ""}`}
            onClick={() => {
              setSoundSearch("");
              setSelectedCategory("All");
            }}
          >
            All ({sounds.length})
          </button>
          {soundCategories.map((cat) => {
            const active = selectedCategory === cat.name && !soundSearch;
            return (
              <button
                key={cat.name}
                type="button"
                role="tab"
                aria-selected={active}
                className={`cat-tab ${active ? "active" : ""}`}
                onClick={() => {
                  setSoundSearch("");
                  setSelectedCategory(cat.name);
                }}
              >
                {cat.name} ({cat.count})
              </button>
            );
          })}
        </div>

        <div className="sound-grid" role="radiogroup" aria-label="Voices">
          {filteredSounds.map((sound, idx) => {
            const selected = status?.activeSoundId === sound.id;
            const isLoading = loadingSoundId === sound.id;
            return (
              <button
                key={sound.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={loadingSoundId !== null}
                className={`sound-pad ${selected ? "selected" : ""} ${isLoading ? "loading" : ""}`}
                onClick={() => handleSoundSelect(sound.id)}
              >
                <span className="sound-pad-meta">
                  {isLoading
                    ? "LOADING…"
                    : soundSearch
                      ? sound.category
                      : String(idx + 1).padStart(2, "0")}
                </span>
                <span className="sound-pad-title">{sound.name}</span>
              </button>
            );
          })}
        </div>

        <div className="params-strip" aria-label="Voice Shaping">
          <div className="param-mode" role="group" aria-label="Voice Mode">
            <span className="param-mode-label">Mode</span>
            <div className="mode-pills">
              {(["poly", "mono", "legato"] as const).map((mode) => {
                const active =
                  (status?.soundParams.voiceMode ?? "poly") === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    className={`mode-pill ${active ? "active" : ""}`}
                    onClick={() => handleSoundParamChange({ voiceMode: mode })}
                  >
                    {mode === "poly"
                      ? "Poly"
                      : mode === "mono"
                        ? "Mono"
                        : "Legato"}
                  </button>
                );
              })}
            </div>
          </div>

          {supportedParams.has("glide") && (
            <div className="param-item">
              <div className="param-head">
                <span>Glide</span>
                <span>{Math.round(status?.soundParams.glideMs ?? 0)} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={400}
                step={5}
                value={Math.round(status?.soundParams.glideMs ?? 0)}
                onChange={(e) =>
                  handleSoundParamChange({ glideMs: Number(e.target.value) })
                }
              />
            </div>
          )}

          {supportedParams.has("hammer") && (
            <div className="param-item">
              <div className="param-head">
                <span>Hammer</span>
                <span>
                  {Math.round((status?.soundParams.hammerHardness ?? 0.5) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(
                  (status?.soundParams.hammerHardness ?? 0.5) * 100
                )}
                onChange={(e) =>
                  handleSoundParamChange({
                    hammerHardness: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("brightness") && (
            <div className="param-item">
              <div className="param-head">
                <span>Tone</span>
                <span>
                  {Math.round((status?.soundParams.brightness ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((status?.soundParams.brightness ?? 1) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    brightness: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("resonance") && (
            <div className="param-item">
              <div className="param-head">
                <span>Resonance</span>
                <span>
                  {Math.round((status?.soundParams.resonance ?? 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={85}
                value={Math.round((status?.soundParams.resonance ?? 0) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    resonance: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("chorus") && (
            <div className="param-item">
              <div className="param-head">
                <span>Chorus</span>
                <span>
                  {Math.round((status?.soundParams.chorusMix ?? 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((status?.soundParams.chorusMix ?? 0) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    chorusMix: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("tremolo") && (
            <div className="param-item">
              <div className="param-head">
                <span>Tremolo</span>
                <span>
                  {Math.round((status?.soundParams.tremoloDepth ?? 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((status?.soundParams.tremoloDepth ?? 0) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    tremoloDepth: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("delay") && (
            <div className="param-item">
              <div className="param-head">
                <span>Delay</span>
                <span>
                  {Math.round((status?.soundParams.delayMix ?? 0) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={60}
                value={Math.round((status?.soundParams.delayMix ?? 0) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    delayMix: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("attack") && (
            <div className="param-item">
              <div className="param-head">
                <span>Attack</span>
                <span>{Math.round(status?.soundParams.attackMs ?? 0)} ms</span>
              </div>
              <input
                type="range"
                min={0}
                max={300}
                value={Math.round(status?.soundParams.attackMs ?? 0)}
                onChange={(e) =>
                  handleSoundParamChange({ attackMs: Number(e.target.value) })
                }
              />
            </div>
          )}

          {supportedParams.has("release") && (
            <div className="param-item">
              <div className="param-head">
                <span>Release</span>
                <span>{Math.round(status?.soundParams.releaseMs ?? 85)} ms</span>
              </div>
              <input
                type="range"
                min={20}
                max={1200}
                step={5}
                value={Math.round(status?.soundParams.releaseMs ?? 85)}
                onChange={(e) =>
                  handleSoundParamChange({ releaseMs: Number(e.target.value) })
                }
              />
            </div>
          )}

          {supportedParams.has("offset") && (
            <div className="param-item">
              <div className="param-head">
                <span>Offset</span>
                <span>
                  {Math.round(status?.soundParams.sampleOffsetMs ?? 0)} ms
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                value={Math.round(status?.soundParams.sampleOffsetMs ?? 0)}
                onChange={(e) =>
                  handleSoundParamChange({
                    sampleOffsetMs: Number(e.target.value),
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("veltrack") && (
            <div className="param-item">
              <div className="param-head">
                <span>Veltrack</span>
                <span>
                  {Math.round((status?.soundParams.velTrack ?? 0.88) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round((status?.soundParams.velTrack ?? 0.88) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    velTrack: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("reverb") && (
            <div className="param-item">
              <div className="param-head">
                <span>Reverb</span>
                <span>
                  {Math.round((status?.soundParams.reverbMix ?? 0.15) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={70}
                value={Math.round((status?.soundParams.reverbMix ?? 0.15) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    reverbMix: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          {supportedParams.has("width") && (
            <div className="param-item">
              <div className="param-head">
                <span>Width</span>
                <span>
                  {Math.round((status?.soundParams.stereoWidth ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={150}
                value={Math.round((status?.soundParams.stereoWidth ?? 1) * 100)}
                onChange={(e) =>
                  handleSoundParamChange({
                    stereoWidth: Number(e.target.value) / 100,
                  })
                }
              />
            </div>
          )}

          <button
            type="button"
            className="btn-mini"
            onClick={() => handleSoundParamChange(DEFAULT_SOUND_PARAMS)}
          >
            Reset
          </button>
        </div>
      </section>

      <section className="grid-2">
        <div className="module-card">
          <div className="module-header">
            <label>Backing Track</label>
            <div className="module-actions">
              <input
                ref={trackInputRef}
                type="file"
                accept=".wav,.flac,.ogg,audio/wav,audio/flac,audio/ogg"
                style={{ display: "none" }}
                onChange={handleTrackFileSelected}
              />
              <button
                type="button"
                className="btn-mini"
                onClick={() => trackInputRef.current?.click()}
              >
                Load Audio
              </button>
              <button
                type="button"
                className={`btn-mini ${status?.backingTrackLoop ? "active" : ""}`}
                onClick={handleTrackLoopToggle}
                title="Loop Backing Track"
              >
                Loop
              </button>
              <button
                type="button"
                className={`btn-mini ${status?.backingTrackPlaying ? "active" : ""}`}
                onClick={handleTrackPlayToggle}
                disabled={!status?.backingTrackName}
              >
                {status?.backingTrackPlaying ? "Pause" : "Play"}
              </button>
            </div>
          </div>

          <div className="track-meta">
            <span className="track-name" title={status?.backingTrackName ?? ""}>
              {status?.backingTrackName ?? "No track loaded (WAV / FLAC / OGG)"}
            </span>
            <span className="track-time">
              {formatTimeMs(status?.backingTrackPositionMs ?? 0)} /{" "}
              {formatTimeMs(status?.backingTrackDurationMs ?? 0)}
            </span>
          </div>

          <div className="module-sliders">
            <input
              type="range"
              aria-label="Backing Track Seek"
              min={0}
              max={Math.max(1, status?.backingTrackDurationMs ?? 0)}
              value={status?.backingTrackPositionMs ?? 0}
              disabled={!status?.backingTrackName}
              onChange={(e) => handleTrackSeek(Number(e.target.value))}
            />
            <div className="mini-vol">
              <span>Vol</span>
              <input
                type="range"
                aria-label="Backing Track Volume"
                min={0}
                max={125}
                value={Math.round((status?.backingTrackVolume ?? 0.75) * 100)}
                onChange={(e) =>
                  handleTrackVolumeChange(Number(e.target.value))
                }
              />
            </div>
          </div>
        </div>

        <div className="module-card">
          <div className="module-header">
            <label>Worship Pad</label>
            <div className="module-actions">
              <div className="mini-vol">
                <span>Vol</span>
                <input
                  type="range"
                  aria-label="Worship Pad Volume"
                  min={0}
                  max={125}
                  value={Math.round((status?.worshipPadVolume ?? 0.55) * 100)}
                  onChange={(e) =>
                    handleWorshipPadVolume(Number(e.target.value))
                  }
                />
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={status?.worshipPadEnabled ?? false}
                className={`toggle-pill ${status?.worshipPadEnabled ? "on" : ""}`}
                onClick={handleWorshipPadToggle}
              >
                <span className="toggle-dot" aria-hidden="true" />
                <span>{status?.worshipPadEnabled ? "ON" : "OFF"}</span>
              </button>
            </div>
          </div>

          <div className="pad-key-grid" role="group" aria-label="Worship Pad Key">
            {WORSHIP_KEYS.map((label, idx) => {
              const active =
                status?.worshipPadEnabled && status?.worshipPadKey === idx;
              const selected = status?.worshipPadKey === idx;
              return (
                <button
                  key={label}
                  type="button"
                  className={`pad-key-btn ${active ? "active" : selected ? "selected" : ""}`}
                  onClick={() => handleWorshipPadKey(idx)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="keyboard-section">
        <div className="keyboard-header">
          <div className="keyboard-title-group">
            <label>Keyboard</label>
            <span className="keyboard-hint">
              {keyboardEnabled ? "Z / X octave · A–' play" : "Computer keys off"}
            </span>
          </div>

          {chordDetectEnabled && (
            <div
              className={`chord-badge ${detectedChord ? "active" : ""}`}
              aria-live="polite"
            >
              {detectedChord ?? "—"}
            </div>
          )}

          <div className="keyboard-controls">
            <button
              type="button"
              role="switch"
              aria-checked={chordDetectEnabled}
              className={`toggle-pill ${chordDetectEnabled ? "on" : ""}`}
              onClick={() => setChordDetectEnabled((v) => !v)}
              title="Toggle Chord Detection"
            >
              <span className="toggle-dot" aria-hidden="true" />
              <span>CHORD</span>
            </button>

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
              <span>{keyboardEnabled ? "KEYS ON" : "KEYS OFF"}</span>
            </button>
          </div>
        </div>

        <div
          className="mini-piano"
          aria-label="88-Key Piano"
        >
          <div className="white-keys">
            {WHITE_KEYS.map((key) => {
              const pressed =
                activeMidiNotes.has(key.note) ||
                activeKeyboardNotes.has(key.note) ||
                activeMouseNote === key.note;
              const qwertyLabel = keyboardEnabled
                ? SEMITONE_TO_LABEL.get(key.note - (octave + 1) * 12)
                : undefined;
              return (
                <button
                  key={key.note}
                  type="button"
                  tabIndex={-1}
                  className={`piano-key white ${pressed ? "pressed" : ""} ${qwertyLabel ? "mapped" : ""}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    mousePressedRef.current = true;
                    glissandoTo(key.note);
                  }}
                  onPointerEnter={(e) => {
                    if (!mousePressedRef.current || (e.buttons & 1) === 0) return;
                    glissandoTo(key.note);
                  }}
                >
                  {qwertyLabel && <span className="key-cap">{qwertyLabel}</span>}
                  {key.cLabel && <span className="octave-mark">{key.cLabel}</span>}
                </button>
              );
            })}
          </div>
          <div className="black-keys">
            {BLACK_KEYS.map((key) => {
              const pressed =
                activeMidiNotes.has(key.note) ||
                activeKeyboardNotes.has(key.note) ||
                activeMouseNote === key.note;
              const qwertyLabel = keyboardEnabled
                ? SEMITONE_TO_LABEL.get(key.note - (octave + 1) * 12)
                : undefined;
              const leftPct = ((key.whiteIndex + 0.65) / WHITE_KEYS.length) * 100;
              return (
                <button
                  key={key.note}
                  type="button"
                  tabIndex={-1}
                  style={{ left: `${leftPct}%` }}
                  className={`piano-key black ${pressed ? "pressed" : ""} ${qwertyLabel ? "mapped" : ""}`}
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    mousePressedRef.current = true;
                    glissandoTo(key.note);
                  }}
                  onPointerEnter={(e) => {
                    if (!mousePressedRef.current || (e.buttons & 1) === 0) return;
                    e.stopPropagation();
                    glissandoTo(key.note);
                  }}
                >
                  {qwertyLabel && <span className="key-cap">{qwertyLabel}</span>}
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

