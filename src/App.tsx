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

interface LayerDto {
  soundId: string;
  soundName: string;
  category: string;
  supportedParams: string[];
  enabled: boolean;
  volume: number;
  minNote: number;
  maxNote: number;
  octaveShift: number;
  params: SoundParamsDto;
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
  sustainActive: boolean;
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
  layers: LayerDto[];
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
  sustainActive: boolean;
  backingTrackPlaying: boolean;
  backingTrackPositionMs: number;
  backingTrackDurationMs: number;
}

const WORSHIP_KEYS = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
];

const OCTAVE_C_NOTES = [24, 36, 48, 60, 72, 84, 96, 108];

const LAYER_COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#a855f7"];

const NOTE_NAMES = [
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

function midiNoteLabel(note: number): string {
  const oct = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${oct}`;
}

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
const PATCHES_STORAGE_KEY = "takt:patches-v1";
const SNAPSHOT_MORPH_MS = 450;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function interpolateSoundParams(
  from: SoundParamsDto,
  to: SoundParamsDto,
  t: number
): SoundParamsDto {
  return {
    brightness: lerp(from.brightness, to.brightness, t),
    attackMs: lerp(from.attackMs, to.attackMs, t),
    releaseMs: lerp(from.releaseMs, to.releaseMs, t),
    reverbMix: lerp(from.reverbMix, to.reverbMix, t),
    stereoWidth: lerp(from.stereoWidth, to.stereoWidth, t),
    hammerHardness: lerp(from.hammerHardness, to.hammerHardness, t),
    sampleOffsetMs: lerp(from.sampleOffsetMs, to.sampleOffsetMs, t),
    velTrack: lerp(from.velTrack, to.velTrack, t),
    glideMs: lerp(from.glideMs, to.glideMs, t),
    resonance: lerp(from.resonance, to.resonance, t),
    chorusMix: lerp(from.chorusMix, to.chorusMix, t),
    tremoloDepth: lerp(from.tremoloDepth, to.tremoloDepth, t),
    delayMix: lerp(from.delayMix, to.delayMix, t),
    voiceMode: to.voiceMode,
  };
}

interface SnapshotLayerState {
  enabled: boolean;
  volume: number;
  minNote: number;
  maxNote: number;
  octaveShift: number;
  params: SoundParamsDto;
}

interface PatchSnapshot {
  id: string;
  name: string;
  layers: SnapshotLayerState[];
  worshipPadEnabled: boolean;
  worshipPadKey: number;
}

interface Patch {
  id: string;
  name: string;
  layerSoundIds: string[];
  snapshots: PatchSnapshot[];
}

function makeDefaultPatches(): Patch[] {
  const baseLayer = (
    enabled = true,
    volume = 0.85,
    octaveShift = 0,
    params: Partial<SoundParamsDto> = {}
  ): SnapshotLayerState => ({
    enabled,
    volume,
    minNote: 21,
    maxNote: 108,
    octaveShift,
    params: { ...DEFAULT_SOUND_PARAMS, ...params },
  });

  return [
    {
      id: "patch-worship",
      name: "Sunday Worship",
      layerSoundIds: ["model-d", "pad", "gs-000-048-strings"],
      snapshots: [
        {
          id: "snap-1",
          name: "Verse (Piano)",
          layers: [
            baseLayer(true, 0.9),
            baseLayer(false, 0.55),
            baseLayer(false, 0.6),
          ],
          worshipPadEnabled: true,
          worshipPadKey: 0,
        },
        {
          id: "snap-2",
          name: "Chorus (Full)",
          layers: [
            baseLayer(true, 0.9, 0, { reverbMix: 0.28 }),
            baseLayer(true, 0.6, 0, { chorusMix: 0.45, reverbMix: 0.35 }),
            baseLayer(true, 0.65, 1, { reverbMix: 0.35 }),
          ],
          worshipPadEnabled: true,
          worshipPadKey: 0,
        },
      ],
    },
    {
      id: "patch-rhodes",
      name: "Rhodes & Pad",
      layerSoundIds: ["jrhodes3d-stereo", "pad"],
      snapshots: [
        {
          id: "snap-1",
          name: "Default",
          layers: [
            baseLayer(true, 0.88, 0, { tremoloDepth: 0.35, chorusMix: 0.25 }),
            baseLayer(true, 0.52),
          ],
          worshipPadEnabled: false,
          worshipPadKey: 0,
        },
      ],
    },
    {
      id: "patch-solo",
      name: "Acoustic Grand",
      layerSoundIds: ["model-d"],
      snapshots: [
        {
          id: "snap-1",
          name: "Default",
          layers: [baseLayer(true, 0.9)],
          worshipPadEnabled: false,
          worshipPadKey: 0,
        },
      ],
    },
  ];
}

const SECONDARY_PORT_RE =
  /\b(mackie|hui|daw|editor|ctrl|control|din|thru|remote|sysex)\b/i;

function getMidiDeviceBaseName(portName: string): string {
  return (
    portName
      .replace(
        /\s+(?:midi|daw|din|editor|mackie|hui|ctrl|control|thru|remote|port\s*[a-z0-9]+|out|in)\b.*$/i,
        ""
      )
      .trim() || portName
  );
}

interface MidiDeviceGroup {
  deviceName: string;
  ports: { name: string; isSecondary: boolean }[];
}

function groupMidiDevices(ports: string[]): MidiDeviceGroup[] {
  const map = new Map<string, { name: string; isSecondary: boolean }[]>();
  for (const name of ports) {
    const base = getMidiDeviceBaseName(name);
    const list = map.get(base) ?? [];
    list.push({ name, isSecondary: SECONDARY_PORT_RE.test(name) });
    map.set(base, list);
  }
  return Array.from(map.entries()).map(([deviceName, groupPorts]) => ({
    deviceName,
    ports: groupPorts,
  }));
}

interface ParamSliderProps {
  label: string;
  displayValue: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (val: number) => void;
  onReset: () => void;
}

function ParamSlider({
  label,
  displayValue,
  value,
  min,
  max,
  step = 1,
  onChange,
  onReset,
}: ParamSliderProps) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="param-item" title="Double-click slider to reset">
      <div className="param-head">
        <span>{label}</span>
        <span>{displayValue}</span>
      </div>
      <input
        type="range"
        className="filled-slider"
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={onReset}
      />
    </div>
  );
}

export default function App() {
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceDto[]>([]);
  const [sounds, setSounds] = useState<SoundDto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("Model D");
  const [soundSearch, setSoundSearch] = useState<string>("");
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [setupOpen, setSetupOpen] = useState<boolean>(false);
  const [zonesView, setZonesView] = useState<boolean>(false);
  const [showAllMidiPorts, setShowAllMidiPorts] = useState<boolean>(false);
  const [leftTab, setLeftTab] = useState<"pad" | "track">("pad");
  // Voice picker modal: null = closed, number = replace layer index, "add" = add new layer
  const [pickerTarget, setPickerTarget] = useState<number | "add" | null>(null);
  // Layer DSP inspector modal: layer index or null
  const [editingLayerIdx, setEditingLayerIdx] = useState<number | null>(null);
  const [patches, setPatches] = useState<Patch[]>(() => {
    try {
      const raw = localStorage.getItem(PATCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return makeDefaultPatches();
  });
  const [activePatchId, setActivePatchId] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(PATCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {
      // ignore
    }
    return "patch-worship";
  });
  const [activeSnapshotIdx, setActiveSnapshotIdx] = useState<number>(0);
  const snapshotAnimRef = useRef<number | null>(null);
  const cancelSnapshotAnim = useCallback(() => {
    if (snapshotAnimRef.current !== null) {
      cancelAnimationFrame(snapshotAnimRef.current);
      snapshotAnimRef.current = null;
    }
  }, []);

  useEffect(() => cancelSnapshotAnim, [cancelSnapshotAnim]);
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
  const zoneDragRef = useRef<{
    layerIdx: number;
    mode: "min" | "max" | "move";
    startX: number;
    origMin: number;
    origMax: number;
    trackWidth: number;
  } | null>(null);

  const layers = status?.layers ?? [];

  const activePatch = useMemo(
    () => patches.find((p) => p.id === activePatchId) ?? patches[0] ?? null,
    [patches, activePatchId]
  );

  useEffect(() => {
    try {
      localStorage.setItem(PATCHES_STORAGE_KEY, JSON.stringify(patches));
    } catch {
      // ignore
    }
  }, [patches]);

  const applySnapshotToEngine = useCallback(
    async (snap: PatchSnapshot, currentLayers: LayerDto[]) => {
      const count = Math.min(snap.layers.length, currentLayers.length);
      for (let i = 0; i < count; i++) {
        const l = snap.layers[i];
        await invoke("update_layer", {
          index: i,
          enabled: l.enabled,
          volume: l.volume,
          minNote: l.minNote,
          maxNote: l.maxNote,
          octaveShift: l.octaveShift,
          params: l.params,
        });
      }
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: snap.worshipPadEnabled,
        key: snap.worshipPadKey,
      });
      setStatus(next);
    },
    []
  );

  const handleLoadPatch = useCallback(
    async (patch: Patch, snapIdx = 0) => {
      if (loadingTarget !== null) return;
      cancelSnapshotAnim();
      setError(null);
      setLoadingTarget(patch.id);
      setActivePatchId(patch.id);
      const targetSnapIdx = Math.min(
        snapIdx,
        Math.max(0, patch.snapshots.length - 1)
      );
      setActiveSnapshotIdx(targetSnapIdx);

      try {
        const soundSet = new Set(sounds.map((s) => s.id));
        const validIds = patch.layerSoundIds.map((id) =>
          soundSet.has(id) ? id : sounds[0]?.id ?? "model-d"
        );
        let latest = status;
        const curLen = latest?.layers.length ?? 1;

        for (let i = curLen - 1; i >= validIds.length; i--) {
          latest = await invoke<StatusDto>("remove_layer", { index: i });
        }
        for (let i = 0; i < validIds.length; i++) {
          if (i < (latest?.layers.length ?? 0)) {
            if (latest?.layers[i].soundId !== validIds[i]) {
              latest = await invoke<StatusDto>("set_layer_sound", {
                index: i,
                soundId: validIds[i],
              });
            }
          } else {
            latest = await invoke<StatusDto>("add_layer", {
              soundId: validIds[i],
            });
          }
        }
        if (latest) {
          setStatus(latest);
          const snap = patch.snapshots[targetSnapIdx];
          if (snap) {
            await applySnapshotToEngine(snap, latest.layers);
          }
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingTarget(null);
      }
    },
    [loadingTarget, sounds, status, applySnapshotToEngine, cancelSnapshotAnim]
  );

  const handleSelectSnapshot = useCallback(
    async (idx: number) => {
      if (!activePatch || !status) return;
      const snap = activePatch.snapshots[idx];
      if (!snap) return;

      cancelSnapshotAnim();
      setActiveSnapshotIdx(idx);

      const startLayers = status.layers;
      const count = Math.min(snap.layers.length, startLayers.length);

      try {
        const nextPadStatus = await invoke<StatusDto>("set_worship_pad", {
          enabled: snap.worshipPadEnabled,
          key: snap.worshipPadKey,
        });
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                worshipPadEnabled: nextPadStatus.worshipPadEnabled,
                worshipPadKey: nextPadStatus.worshipPadKey,
              }
            : nextPadStatus
        );
      } catch (err) {
        setError(String(err));
      }

      if (count === 0) return;

      const startTime = performance.now();
      const step = (now: number) => {
        const rawT = Math.min(1, (now - startTime) / SNAPSHOT_MORPH_MS);
        const eased = easeInOutCubic(rawT);
        const done = rawT >= 1;

        const morphedLayers: LayerDto[] = startLayers.map((from, i) => {
          if (i >= count) return from;
          const to = snap.layers[i];
          const fromVol = from.enabled ? from.volume : 0;
          const toVol = to.enabled ? to.volume : 0;
          const enabled = done ? to.enabled : from.enabled || to.enabled;
          const volume = done ? to.volume : lerp(fromVol, toVol, eased);
          const params = done
            ? to.params
            : interpolateSoundParams(from.params, to.params, eased);

          void invoke("update_layer", {
            index: i,
            enabled,
            volume,
            minNote: to.minNote,
            maxNote: to.maxNote,
            octaveShift: to.octaveShift,
            params,
          }).catch(() => {});

          return {
            ...from,
            enabled,
            volume,
            minNote: to.minNote,
            maxNote: to.maxNote,
            octaveShift: to.octaveShift,
            params,
          };
        });

        setStatus((prev) => (prev ? { ...prev, layers: morphedLayers } : prev));

        if (!done) {
          snapshotAnimRef.current = requestAnimationFrame(step);
        } else {
          snapshotAnimRef.current = null;
        }
      };

      snapshotAnimRef.current = requestAnimationFrame(step);
    },
    [activePatch, status, cancelSnapshotAnim]
  );

  const handleSaveCurrentSnapshot = () => {
    if (!activePatch || !status) return;
    const snapLayers: SnapshotLayerState[] = status.layers.map((l) => ({
      enabled: l.enabled,
      volume: l.volume,
      minNote: l.minNote,
      maxNote: l.maxNote,
      octaveShift: l.octaveShift,
      params: { ...l.params },
    }));
    const layerSoundIds = status.layers.map((l) => l.soundId);

    setPatches((prev) =>
      prev.map((p) => {
        if (p.id !== activePatch.id) return p;
        const nextSnaps = p.snapshots.map((s, i) =>
          i === activeSnapshotIdx
            ? {
                ...s,
                layers: snapLayers,
                worshipPadEnabled: status.worshipPadEnabled,
                worshipPadKey: status.worshipPadKey,
              }
            : s
        );
        return { ...p, layerSoundIds, snapshots: nextSnaps };
      })
    );
  };

  const handleAddSnapshot = () => {
    if (!activePatch || !status) return;
    const nextNum = activePatch.snapshots.length + 1;
    const newSnap: PatchSnapshot = {
      id: `snap-${Date.now()}`,
      name: `Snapshot ${nextNum}`,
      layers: status.layers.map((l) => ({
        enabled: l.enabled,
        volume: l.volume,
        minNote: l.minNote,
        maxNote: l.maxNote,
        octaveShift: l.octaveShift,
        params: { ...l.params },
      })),
      worshipPadEnabled: status.worshipPadEnabled,
      worshipPadKey: status.worshipPadKey,
    };
    const nextIdx = activePatch.snapshots.length;
    setPatches((prev) =>
      prev.map((p) =>
        p.id === activePatch.id
          ? {
              ...p,
              layerSoundIds: status.layers.map((l) => l.soundId),
              snapshots: [...p.snapshots, newSnap],
            }
          : p
      )
    );
    setActiveSnapshotIdx(nextIdx);
  };

  const handleDeleteSnapshot = (idx: number) => {
    if (!activePatch || activePatch.snapshots.length <= 1) return;
    const nextSnaps = activePatch.snapshots.filter((_, i) => i !== idx);
    setPatches((prev) =>
      prev.map((p) =>
        p.id === activePatch.id ? { ...p, snapshots: nextSnaps } : p
      )
    );
    const nextIdx = Math.min(activeSnapshotIdx, nextSnaps.length - 1);
    setActiveSnapshotIdx(nextIdx);
  };

  const handleCreatePatch = () => {
    if (!status) return;
    const name = window.prompt(
      "New Patch Name:",
      `Patch ${patches.length + 1}`
    );
    if (!name || !name.trim()) return;
    const newPatch: Patch = {
      id: `patch-${Date.now()}`,
      name: name.trim(),
      layerSoundIds: status.layers.map((l) => l.soundId),
      snapshots: [
        {
          id: `snap-${Date.now()}`,
          name: "Default",
          layers: status.layers.map((l) => ({
            enabled: l.enabled,
            volume: l.volume,
            minNote: l.minNote,
            maxNote: l.maxNote,
            octaveShift: l.octaveShift,
            params: { ...l.params },
          })),
          worshipPadEnabled: status.worshipPadEnabled,
          worshipPadKey: status.worshipPadKey,
        },
      ],
    };
    setPatches((prev) => [...prev, newPatch]);
    setActivePatchId(newPatch.id);
    setActiveSnapshotIdx(0);
  };

  const handleDeletePatch = (patchId: string) => {
    if (patches.length <= 1) return;
    const next = patches.filter((p) => p.id !== patchId);
    setPatches(next);
    if (activePatchId === patchId && next[0]) {
      handleLoadPatch(next[0], 0);
    }
  };

  const handleAssignSound = useCallback(
    async (target: number | "add", soundId: string) => {
      if (loadingTarget !== null) return;
      setError(null);
      setLoadingTarget(soundId);
      try {
        const next =
          target === "add"
            ? await invoke<StatusDto>("add_layer", { soundId })
            : await invoke<StatusDto>("set_layer_sound", {
                index: target,
                soundId,
              });
        setStatus(next);
        setPickerTarget(null);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingTarget(null);
      }
    },
    [loadingTarget]
  );

  const handleRemoveLayer = async (index: number) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("remove_layer", { index });
      setStatus(next);
      if (editingLayerIdx === index) setEditingLayerIdx(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleUpdateLayer = useCallback(
    async (
      index: number,
      patch: Partial<LayerDto> & { paramsPatch?: Partial<SoundParamsDto> }
    ) => {
      cancelSnapshotAnim();
      const layer = status?.layers[index];
      if (!layer) return;
      const nextLayer: LayerDto = {
        ...layer,
        ...patch,
        params: patch.paramsPatch
          ? { ...layer.params, ...patch.paramsPatch }
          : patch.params ?? layer.params,
      };
      setStatus((prev) => {
        if (!prev) return prev;
        const nextLayers = prev.layers.map((l, i) =>
          i === index ? nextLayer : l
        );
        return { ...prev, layers: nextLayers };
      });
      try {
        await invoke("update_layer", {
          index,
          enabled: nextLayer.enabled,
          volume: nextLayer.volume,
          minNote: nextLayer.minNote,
          maxNote: nextLayer.maxNote,
          octaveShift: nextLayer.octaveShift,
          params: nextLayer.params,
        });
      } catch (err) {
        setError(String(err));
      }
    },
    [status?.layers, cancelSnapshotAnim]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = zoneDragRef.current;
      if (!drag || drag.trackWidth <= 0) return;
      const deltaNotes = Math.round(
        ((e.clientX - drag.startX) / drag.trackWidth) * 87
      );
      if (drag.mode === "min") {
        const nextMin = Math.max(
          21,
          Math.min(drag.origMax, drag.origMin + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, { minNote: nextMin });
      } else if (drag.mode === "max") {
        const nextMax = Math.min(
          108,
          Math.max(drag.origMin, drag.origMax + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, { maxNote: nextMax });
      } else {
        const span = drag.origMax - drag.origMin;
        const nextMin = Math.max(
          21,
          Math.min(108 - span, drag.origMin + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, {
          minNote: nextMin,
          maxNote: nextMin + span,
        });
      }
    };
    const onUp = () => {
      zoneDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [handleUpdateLayer]);

  useEffect(() => {
    invoke<InitialStateDto>("get_initial_state")
      .then((data) => {
        setMidiDevices(data.midiDevices);
        setAudioDevices(data.audioDevices);
        setSounds(data.sounds);
        setStatus(data.status);
      })
      .catch((err) => setError(String(err)));

    const unlistenTelemetry = listen<TelemetryDto>(
      "takt://telemetry",
      (event) => {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                isPlaying: event.payload.isPlaying,
                activeVoices: event.payload.activeVoices,
                estimatedLatencyMs: event.payload.estimatedLatencyMs,
                midiDevices: event.payload.midiDevices,
                desiredMidiDevices: event.payload.desiredMidiDevices,
                sustainActive: event.payload.sustainActive,
                backingTrackPlaying: event.payload.backingTrackPlaying,
                backingTrackPositionMs: event.payload.backingTrackPositionMs,
                backingTrackDurationMs: event.payload.backingTrackDurationMs,
              }
            : prev
        );
        setActiveMidiNotes(new Set(event.payload.activeMidiNotes));
      }
    );

    const unlistenMidi = listen<string[]>("takt://midi-devices", (event) => {
      setMidiDevices(event.payload);
    });

    return () => {
      unlistenTelemetry.then((fn) => fn());
      unlistenMidi.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlistenPc = listen<number>("takt://program-change", (event) => {
      const targetPatch = patches[event.payload];
      if (targetPatch) {
        handleLoadPatch(targetPatch, 0);
      }
    });
    return () => {
      unlistenPc.then((fn) => fn());
    };
  }, [patches, handleLoadPatch]);

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
      if (!mousePressedRef.current && activeMouseNoteRef.current === null)
        return;
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
      // ignore
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
      // ignore
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

  const groupedMidi = useMemo(() => groupMidiDevices(midiDevices), [midiDevices]);

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

  const handleAudioChange = async (
    deviceName: string,
    bufferSize: number | null
  ) => {
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
  const trackDuration = Math.max(1, status?.backingTrackDurationMs ?? 0);
  const trackPos = status?.backingTrackPositionMs ?? 0;
  const trackSeekPct = (trackPos / trackDuration) * 100;
  const trackVolPct = Math.round((status?.backingTrackVolume ?? 0.75) * 100);
  const padVolPct = Math.round((status?.worshipPadVolume ?? 0.55) * 100);

  const editingLayer =
    editingLayerIdx !== null ? layers[editingLayerIdx] ?? null : null;
  const editingParamsSet = new Set(editingLayer?.supportedParams ?? []);

  return (
    <main className="rack">
      {/* Top Bar */}
      <header className="rack-header">
        <div className="brand">
          <h1 className="brand-name">Takt</h1>
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
            <div className="midi-badge">
              MIDI {status?.midiDevices.length ?? 0}
            </div>
          </div>
        </div>

        <div className="header-right">
          <button
            type="button"
            className="btn btn-panic btn-sm"
            onClick={handlePanic}
          >
            Panic
          </button>

          <div className="header-master" title="Double-click to reset (80%)">
            <span className="master-label">Master</span>
            <input
              type="range"
              className="filled-slider master-slider"
              style={
                { "--fill": `${(volumePct / 125) * 100}%` } as React.CSSProperties
              }
              aria-label="Master Volume"
              min={0}
              max={125}
              value={volumePct}
              onChange={(e) => handleVolumeChange(Number(e.target.value))}
              onDoubleClick={() => handleVolumeChange(80)}
            />
            <span className="master-pct">{volumePct}%</span>
          </div>

          <div className="view-switch" role="group" aria-label="Stage View">
            <button
              type="button"
              className={`view-btn ${!setupOpen && !zonesView ? "active" : ""}`}
              onClick={() => {
                setSetupOpen(false);
                setZonesView(false);
              }}
            >
              Stage
            </button>
            <button
              type="button"
              className={`view-btn ${!setupOpen && zonesView ? "active" : ""}`}
              onClick={() => {
                setSetupOpen(false);
                setZonesView(true);
              }}
            >
              Ranges
            </button>
          </div>

          <button
            type="button"
            className={`btn-setup ${setupOpen ? "active" : ""}`}
            onClick={() => setSetupOpen((v) => !v)}
            aria-expanded={setupOpen}
          >
            <span aria-hidden="true">⚙</span>
            <span>{setupOpen ? "Perform" : "Setup"}</span>
          </button>
        </div>
      </header>

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {setupOpen ? (
        <section className="setup-panel" aria-label="Hardware & Audio Setup">
          <div className="setup-section">
            <div className="field-row">
              <label>MIDI Inputs</label>
              <div className="setup-midi-actions">
                <span className="midi-count">
                  {status?.midiDevices.length ?? 0} active
                </span>
                <label className="checkbox-inline">
                  <input
                    type="checkbox"
                    checked={showAllMidiPorts}
                    onChange={(e) => setShowAllMidiPorts(e.target.checked)}
                  />
                  <span>Show all ports</span>
                </label>
              </div>
            </div>

            <div className="midi-groups">
              {groupedMidi.length === 0 &&
              (status?.desiredMidiDevices.length ?? 0) === 0 ? (
                <span className="midi-empty">No MIDI devices connected</span>
              ) : (
                <>
                  {groupedMidi.map((group) => {
                    const primaryPort =
                      group.ports.find((p) => !p.isSecondary) ?? group.ports[0];
                    const visiblePorts = showAllMidiPorts
                      ? group.ports
                      : group.ports.filter(
                          (p) =>
                            p.name === primaryPort.name ||
                            (status?.desiredMidiDevices.includes(p.name) ??
                              false)
                        );
                    return (
                      <div key={group.deviceName} className="midi-group-row">
                        <span className="midi-group-name">
                          {group.deviceName}
                        </span>
                        <div className="midi-group-ports">
                          {visiblePorts.map((port) => {
                            const enabled =
                              status?.desiredMidiDevices.includes(port.name) ??
                              false;
                            const connected =
                              status?.midiDevices.includes(port.name) ?? false;
                            return (
                              <button
                                key={port.name}
                                type="button"
                                className={`midi-chip ${connected ? "connected" : enabled ? "enabled" : ""}`}
                                onClick={() => handleToggleMidiDevice(port.name)}
                              >
                                <span
                                  className="midi-chip-dot"
                                  aria-hidden="true"
                                />
                                <span>{port.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
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

          <div className="grid-2">
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

            <div className="field">
              <label htmlFor="buffer-select">Buffer Size</label>
              <select
                id="buffer-select"
                value={status?.bufferSize ?? ""}
                onChange={(e) => {
                  const val =
                    e.target.value === "" ? null : Number(e.target.value);
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
          </div>

          <div className="grid-2">
            <div className="field">
              <label>Stream Format</label>
              <div className="info-box">
                {status
                  ? `${status.sampleRate} Hz · ${layers.length} active layer${layers.length === 1 ? "" : "s"}`
                  : "Loading…"}
              </div>
            </div>

            <div className="field">
              <label>Audio Check</label>
              <button
                type="button"
                className="btn"
                onMouseDown={() => triggerAudition(true)}
                onMouseUp={() => triggerAudition(false)}
                onMouseLeave={() => triggerAudition(false)}
              >
                Test C4 Note
              </button>
            </div>
          </div>
        </section>
      ) : zonesView ? (
        <section className="zones-editor" aria-label="Layer Ranges & Alignments">
          <div className="zones-toolbar">
            <div className="sound-title-row">
              <label>Layer Ranges & Alignments</label>
              <span className="keyboard-hint">
                Drag handles to set range · Drag bar to shift · Double-click bar for Full 88
              </span>
            </div>
            <div className="zones-actions">
              <button
                type="button"
                className="btn-mini"
                onClick={() => {
                  layers.forEach((_, i) =>
                    handleUpdateLayer(i, { minNote: 21, maxNote: 108 })
                  );
                }}
              >
                All Full 88
              </button>
              {layers.length >= 2 && (
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => {
                    handleUpdateLayer(0, { minNote: 21, maxNote: 59 });
                    for (let i = 1; i < layers.length; i++) {
                      handleUpdateLayer(i, { minNote: 60, maxNote: 108 });
                    }
                  }}
                >
                  Split @ C4
                </button>
              )}
              <button
                type="button"
                className="btn-mini active"
                onClick={() => setPickerTarget("add")}
              >
                + Add Layer
              </button>
            </div>
          </div>

          <div className="zones-rows">
            {[...layers.map((_, i) => i), layers.length].map((slotIdx) => {
              const layer = layers[slotIdx];
              const color = LAYER_COLORS[slotIdx % LAYER_COLORS.length];
              if (!layer) {
                return (
                  <div key={`empty-${slotIdx}`} className="zone-editor-row empty">
                    <div className="zone-gutter">
                      <span
                        className="zone-gutter-dot"
                        style={{ background: color, opacity: 0.35 }}
                      />
                      <span className="zone-gutter-idx">L{slotIdx + 1}</span>
                    </div>
                    <button
                      type="button"
                      className="zone-empty-track"
                      onClick={() => setPickerTarget("add")}
                    >
                      Empty Sound Layer {slotIdx + 1} — Click to Add Sound
                    </button>
                  </div>
                );
              }

              const leftPct = ((layer.minNote - 21) / 87) * 100;
              const widthPct = Math.max(
                4,
                ((layer.maxNote - layer.minNote) / 87) * 100
              );

              return (
                <div key={`ze-${slotIdx}`} className="zone-editor-row">
                  <div className="zone-gutter">
                    <button
                      type="button"
                      className={`zone-mute-btn ${layer.enabled ? "on" : ""}`}
                      style={{ "--layer-color": color } as React.CSSProperties}
                      onClick={() =>
                        handleUpdateLayer(slotIdx, { enabled: !layer.enabled })
                      }
                      title={layer.enabled ? "Mute layer" : "Enable layer"}
                    >
                      L{slotIdx + 1}
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setEditingLayerIdx(slotIdx)}
                      title="Layer Controls"
                    >
                      ≡
                    </button>
                  </div>

                  <div className="zone-lane">
                    {/* Vertical Octave Gridlines aligned to 88-key piano */}
                    {OCTAVE_C_NOTES.map((cNote) => (
                      <div
                        key={cNote}
                        className="zone-gridline"
                        style={{ left: `${((cNote - 21) / 87) * 100}%` }}
                      />
                    ))}

                    <div
                      className={`zone-bar ${layer.enabled ? "" : "muted"}`}
                      style={{
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        background: color,
                      }}
                      onPointerDown={(e) => {
                        const parent = e.currentTarget.parentElement;
                        if (!parent) return;
                        e.preventDefault();
                        zoneDragRef.current = {
                          layerIdx: slotIdx,
                          mode: "move",
                          startX: e.clientX,
                          origMin: layer.minNote,
                          origMax: layer.maxNote,
                          trackWidth: parent.getBoundingClientRect().width,
                        };
                      }}
                      onDoubleClick={() =>
                        handleUpdateLayer(slotIdx, { minNote: 21, maxNote: 108 })
                      }
                    >
                      <button
                        type="button"
                        className="zone-handle left"
                        aria-label={`Low key ${midiNoteLabel(layer.minNote)}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const lane =
                            e.currentTarget.parentElement?.parentElement;
                          if (!lane) return;
                          zoneDragRef.current = {
                            layerIdx: slotIdx,
                            mode: "min",
                            startX: e.clientX,
                            origMin: layer.minNote,
                            origMax: layer.maxNote,
                            trackWidth: lane.getBoundingClientRect().width,
                          };
                        }}
                      />

                      <span className="zone-note-pill">
                        {midiNoteLabel(layer.minNote)}
                      </span>
                      <span className="zone-bar-name">{layer.soundName}</span>
                      <span className="zone-note-pill">
                        {midiNoteLabel(layer.maxNote)}
                      </span>

                      <button
                        type="button"
                        className="zone-handle right"
                        aria-label={`High key ${midiNoteLabel(layer.maxNote)}`}
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          const lane =
                            e.currentTarget.parentElement?.parentElement;
                          if (!lane) return;
                          zoneDragRef.current = {
                            layerIdx: slotIdx,
                            mode: "max",
                            startX: e.clientX,
                            origMin: layer.minNote,
                            origMax: layer.maxNote,
                            trackWidth: lane.getBoundingClientRect().width,
                          };
                        }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <div className="stage-layout">
          {/* Left Sidebar: Setlist Favorites + Tonic Pad / Backing Track */}
          <aside className="stage-sidebar">
            <section className="sidebar-card favorites-card">
              <div className="sidebar-card-head">
                <label>Patches</label>
                <button
                  type="button"
                  className="btn-mini active"
                  onClick={handleCreatePatch}
                  title="Save current layers as a new Patch"
                >
                  + New
                </button>
              </div>
              <div className="favorites-list">
                {patches.map((patch, idx) => {
                  const selected = patch.id === activePatch?.id;
                  const isLoading = loadingTarget === patch.id;
                  return (
                    <div
                      key={patch.id}
                      className={`patch-row-wrap ${selected ? "selected" : ""} ${isLoading ? "loading" : ""}`}
                    >
                      <button
                        type="button"
                        disabled={loadingTarget !== null}
                        className="patch-row-btn"
                        onClick={() => handleLoadPatch(patch, 0)}
                      >
                        <span className="fav-num">
                          {String(idx + 1).padStart(2, "0")}
                        </span>
                        <span className="fav-name">{patch.name}</span>
                        <span className="patch-meta">
                          {patch.layerSoundIds.length}L · {patch.snapshots.length}S
                        </span>
                      </button>
                      {patches.length > 1 && (
                        <button
                          type="button"
                          className="patch-del-btn"
                          onClick={() => handleDeletePatch(patch.id)}
                          title="Delete Patch"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="patch-nav-row">
                <button
                  type="button"
                  className="btn-mini"
                  disabled={patches.length <= 1 || loadingTarget !== null}
                  onClick={() => {
                    const cur = patches.findIndex(
                      (p) => p.id === activePatch?.id
                    );
                    const prev =
                      (cur - 1 + patches.length) % patches.length;
                    handleLoadPatch(patches[prev], 0);
                  }}
                >
                  Prev
                </button>
                <button
                  type="button"
                  className="btn-mini"
                  disabled={patches.length <= 1 || loadingTarget !== null}
                  onClick={() => {
                    const cur = patches.findIndex(
                      (p) => p.id === activePatch?.id
                    );
                    const next = (cur + 1) % patches.length;
                    handleLoadPatch(patches[next], 0);
                  }}
                >
                  Next
                </button>
              </div>
            </section>

            <section className="sidebar-card pad-track-card">
              <div className="sub-tabs" role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftTab === "pad"}
                  className={`sub-tab ${leftTab === "pad" ? "active" : ""}`}
                  onClick={() => setLeftTab("pad")}
                >
                  <span
                    className={`mini-dot ${status?.worshipPadEnabled ? "on" : ""}`}
                  />
                  Worship Pad
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={leftTab === "track"}
                  className={`sub-tab ${leftTab === "track" ? "active" : ""}`}
                  onClick={() => setLeftTab("track")}
                >
                  <span
                    className={`mini-dot ${status?.backingTrackPlaying ? "on" : ""}`}
                  />
                  Backing Track
                </button>
              </div>

              {leftTab === "pad" ? (
                <div className="pad-module">
                  <div className="pad-top-row">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={status?.worshipPadEnabled ?? false}
                      className={`toggle-pill ${status?.worshipPadEnabled ? "on" : ""}`}
                      onClick={handleWorshipPadToggle}
                    >
                      <span className="toggle-dot" aria-hidden="true" />
                      <span>{status?.worshipPadEnabled ? "PAD ON" : "PAD OFF"}</span>
                    </button>
                    <span className="vol-readout">{padVolPct}%</span>
                  </div>

                  <div className="pad-body">
                    <div
                      className="pad-key-grid-4x3"
                      role="group"
                      aria-label="Worship Pad Key"
                    >
                      {WORSHIP_KEYS.map((label, idx) => {
                        const active =
                          status?.worshipPadEnabled &&
                          status?.worshipPadKey === idx;
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
                    <div className="v-fader-wrap">
                      <input
                        type="range"
                        className="v-fader"
                        style={
                          {
                            "--fill": `${(padVolPct / 125) * 100}%`,
                            "--fader-color": "#93c5fd",
                          } as React.CSSProperties
                        }
                        aria-label="Worship Pad Volume"
                        min={0}
                        max={125}
                        value={padVolPct}
                        onChange={(e) =>
                          handleWorshipPadVolume(Number(e.target.value))
                        }
                        onDoubleClick={() => handleWorshipPadVolume(55)}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="track-module">
                  <div className="track-controls-row">
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
                      Load
                    </button>
                    <button
                      type="button"
                      className={`btn-mini ${status?.backingTrackLoop ? "active" : ""}`}
                      onClick={handleTrackLoopToggle}
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

                  <div className="track-meta">
                    <span
                      className="track-name"
                      title={status?.backingTrackName ?? ""}
                    >
                      {status?.backingTrackName ?? "No track loaded"}
                    </span>
                    <span className="track-time">
                      {formatTimeMs(trackPos)} /{" "}
                      {formatTimeMs(status?.backingTrackDurationMs ?? 0)}
                    </span>
                  </div>

                  <input
                    type="range"
                    className="seek-bar"
                    style={
                      { "--fill": `${trackSeekPct}%` } as React.CSSProperties
                    }
                    aria-label="Backing Track Progress"
                    min={0}
                    max={trackDuration}
                    value={trackPos}
                    disabled={!status?.backingTrackName}
                    onChange={(e) => handleTrackSeek(Number(e.target.value))}
                  />

                  <ParamSlider
                    label="Track Vol"
                    displayValue={`${trackVolPct}%`}
                    value={trackVolPct}
                    min={0}
                    max={125}
                    onChange={handleTrackVolumeChange}
                    onReset={() => handleTrackVolumeChange(75)}
                  />
                </div>
              )}
            </section>
          </aside>

          {/* Main Stage: Layered Sound Channel Strips + Snapshots Bar */}
          <section className="layers-stage" aria-label="Sound Layers">
            <div className="layers-row">
              {layers.map((layer, idx) => {
                const color = LAYER_COLORS[idx % LAYER_COLORS.length];
                const layerVolPct = Math.round(layer.volume * 100);
                const paramSet = new Set(layer.supportedParams);
                return (
                  <div
                    key={`${idx}-${layer.soundId}`}
                    className={`layer-strip ${layer.enabled ? "" : "muted"}`}
                    style={{ "--layer-color": color } as React.CSSProperties}
                  >
                    <div className="layer-accent-bar" />

                    <div className="layer-head">
                      <button
                        type="button"
                        className="layer-name-btn"
                        onClick={() => setPickerTarget(idx)}
                        title="Click to change sound for this layer"
                      >
                        <span className="layer-name">{layer.soundName}</span>
                        <span className="layer-cat">
                          {layer.category} · {midiNoteLabel(layer.minNote)}–
                          {midiNoteLabel(layer.maxNote)}
                        </span>
                      </button>

                      <div className="layer-head-actions">
                        <button
                          type="button"
                          className={`icon-btn ${editingLayerIdx === idx ? "active" : ""}`}
                          onClick={() =>
                            setEditingLayerIdx((cur) =>
                              cur === idx ? null : idx
                            )
                          }
                          title="Layer Controls (Tone, Envelope, Key Range)"
                        >
                          ≡
                        </button>
                        {idx > 0 && (
                          <button
                            type="button"
                            className="icon-btn danger"
                            onClick={() => handleRemoveLayer(idx)}
                            title="Remove Layer"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick Sunday-Keys-style modifier slots */}
                    <div className="layer-slots">
                      <button
                        type="button"
                        className={`slot-btn ${layer.octaveShift !== 0 ? "lit" : ""}`}
                        onClick={() => {
                          const nextOct =
                            layer.octaveShift === 0
                              ? 1
                              : layer.octaveShift === 1
                                ? -1
                                : 0;
                          handleUpdateLayer(idx, { octaveShift: nextOct });
                        }}
                      >
                        <span className="slot-sub">MIDI</span>
                        <span className="slot-val">
                          {layer.octaveShift === 0
                            ? "Octave 0"
                            : layer.octaveShift > 0
                              ? `Octave +${layer.octaveShift}`
                              : `Octave ${layer.octaveShift}`}
                        </span>
                      </button>

                      {paramSet.has("chorus") && (
                        <button
                          type="button"
                          className={`slot-btn ${layer.params.chorusMix > 0.02 ? "lit" : ""}`}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                chorusMix:
                                  layer.params.chorusMix > 0.02 ? 0.0 : 0.45,
                              },
                            })
                          }
                        >
                          <span className="slot-sub">FX 01</span>
                          <span className="slot-val">Chorus</span>
                        </button>
                      )}

                      {paramSet.has("tremolo") && (
                        <button
                          type="button"
                          className={`slot-btn ${layer.params.tremoloDepth > 0.02 ? "lit" : ""}`}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                tremoloDepth:
                                  layer.params.tremoloDepth > 0.02 ? 0.0 : 0.45,
                              },
                            })
                          }
                        >
                          <span className="slot-sub">FX 02</span>
                          <span className="slot-val">Tremolo</span>
                        </button>
                      )}

                      {paramSet.has("delay") && (
                        <button
                          type="button"
                          className={`slot-btn ${layer.params.delayMix > 0.02 ? "lit" : ""}`}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                delayMix:
                                  layer.params.delayMix > 0.02 ? 0.0 : 0.28,
                              },
                            })
                          }
                        >
                          <span className="slot-sub">FX 03</span>
                          <span className="slot-val">Delay</span>
                        </button>
                      )}

                      {paramSet.has("reverb") && (
                        <button
                          type="button"
                          className={`slot-btn ${layer.params.reverbMix > 0.02 ? "lit" : ""}`}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                reverbMix:
                                  layer.params.reverbMix > 0.02 ? 0.0 : 0.3,
                              },
                            })
                          }
                        >
                          <span className="slot-sub">FX 04</span>
                          <span className="slot-val">Reverb</span>
                        </button>
                      )}
                    </div>

                    {/* Vertical Fader + Enable/Mute Power */}
                    <div className="layer-fader-area">
                      <div className="v-fader-wrap tall">
                        <input
                          type="range"
                          className="v-fader"
                          style={
                            {
                              "--fill": `${(layerVolPct / 125) * 100}%`,
                              "--fader-color": color,
                            } as React.CSSProperties
                          }
                          aria-label={`${layer.soundName} Volume`}
                          min={0}
                          max={125}
                          value={layerVolPct}
                          onChange={(e) =>
                            handleUpdateLayer(idx, {
                              volume: Number(e.target.value) / 100,
                            })
                          }
                          onDoubleClick={() =>
                            handleUpdateLayer(idx, { volume: 0.85 })
                          }
                        />
                      </div>
                      <div className="layer-bottom-row">
                        <button
                          type="button"
                          className={`power-btn ${layer.enabled ? "on" : ""}`}
                          onClick={() =>
                            handleUpdateLayer(idx, { enabled: !layer.enabled })
                          }
                          title={layer.enabled ? "Mute layer" : "Enable layer"}
                        >
                          {layer.enabled ? "ON" : "MUTED"}
                        </button>
                        <span className="layer-vol-pct">{layerVolPct}%</span>
                      </div>
                    </div>
                  </div>
                );
              })}

              <button
                type="button"
                className="add-layer-slot"
                onClick={() => setPickerTarget("add")}
              >
                <span className="add-plus">+</span>
                <span>Add Sound</span>
              </button>
            </div>

            {/* Snapshots Bar inside current Patch */}
            {activePatch && (
              <div className="snapshots-bar" aria-label="Patch Snapshots">
                <div className="snapshots-list">
                  {activePatch.snapshots.map((snap, idx) => {
                    const active = idx === activeSnapshotIdx;
                    return (
                      <div
                        key={snap.id}
                        className={`snap-chip ${active ? "active" : ""}`}
                      >
                        <button
                          type="button"
                          className="snap-btn"
                          onClick={() => handleSelectSnapshot(idx)}
                        >
                          <span className="snap-name">{snap.name}</span>
                        </button>
                        {activePatch.snapshots.length > 1 && (
                          <button
                            type="button"
                            className="snap-del"
                            onClick={() => handleDeleteSnapshot(idx)}
                            title="Delete Snapshot"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="snapshots-actions">
                  <button
                    type="button"
                    className="btn-mini"
                    onClick={handleAddSnapshot}
                    title="Add new Snapshot from current state"
                  >
                    + Snap
                  </button>
                  <button
                    type="button"
                    className="btn-mini active"
                    onClick={handleSaveCurrentSnapshot}
                    title="Save current layer levels/effects into active Snapshot"
                  >
                    Save Snap
                  </button>
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {/* Bottom: Colored Layer Zone Bars + Compact 88-Key Piano */}
      {!setupOpen && (
        <footer className="piano-footer">
          <div className="keyboard-header">
            <div className="keyboard-title-group">
              <label>Keyboard</label>
              <span className="keyboard-hint">
                {keyboardEnabled ? "Z/X octave · A–' play" : "Keys off"}
              </span>
            </div>

            {chordDetectEnabled && (
              <div className="chord-readout-wrap" aria-live="polite">
                <span className="chord-label">CHORD</span>
                <div className={`chord-badge ${detectedChord ? "active" : ""}`}>
                  {detectedChord ?? "—"}
                </div>
              </div>
            )}

            <div className="keyboard-controls">
              <button
                type="button"
                aria-pressed={Boolean(status?.sustainActive)}
                className={`toggle-pill sustain-pill ${status?.sustainActive ? "on" : ""}`}
                title="Toggle Sustain (CC 64) · also lights up when sustain pedal is stepped on"
                onClick={() => {
                  const next = !status?.sustainActive;
                  setStatus((prev) =>
                    prev ? { ...prev, sustainActive: next } : prev
                  );
                  void invoke("set_sustain", { pressed: next });
                }}
              >
                <span className="toggle-dot" aria-hidden="true" />
                <span>SUSTAIN</span>
              </button>

              <button
                type="button"
                role="switch"
                aria-checked={chordDetectEnabled}
                className={`toggle-pill ${chordDetectEnabled ? "on" : ""}`}
                onClick={() => setChordDetectEnabled((v) => !v)}
              >
                <span className="toggle-dot" aria-hidden="true" />
                <span>CHORD</span>
              </button>

              <div className="octave-stepper">
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => setOctave((o) => Math.max(0, o - 1))}
                  disabled={octave <= 0}
                >
                  −
                </button>
                <span className="octave-readout">C{octave}</span>
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => setOctave((o) => Math.min(7, o + 1))}
                  disabled={octave >= 7}
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

          {/* Colored Layer Key-Range Bars (Sunday Keys style) */}
          <div className="zone-bars" aria-hidden="true">
            {layers.map((layer, idx) => {
              const color = LAYER_COLORS[idx % LAYER_COLORS.length];
              const leftPct = ((layer.minNote - 21) / 87) * 100;
              const widthPct = Math.max(
                1.5,
                ((layer.maxNote - layer.minNote) / 87) * 100
              );
              return (
                <div key={`zone-${idx}`} className="zone-track">
                  <div
                    className={`zone-fill ${layer.enabled ? "" : "muted"}`}
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      background: color,
                    }}
                  />
                </div>
              );
            })}
          </div>

          <div className="mini-piano" aria-label="88-Key Piano">
            <div className="white-keys">
              {WHITE_KEYS.map((key) => {
                const midiActive = activeMidiNotes.has(key.note);
                const localActive =
                  activeKeyboardNotes.has(key.note) ||
                  activeMouseNote === key.note;
                const pressed = midiActive || localActive;
                const qwertyLabel = keyboardEnabled
                  ? SEMITONE_TO_LABEL.get(key.note - (octave + 1) * 12)
                  : undefined;
                return (
                  <button
                    key={key.note}
                    type="button"
                    tabIndex={-1}
                    className={`piano-key white ${pressed ? "pressed" : ""} ${midiActive ? "midi-lit" : ""} ${qwertyLabel ? "mapped" : ""}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      mousePressedRef.current = true;
                      glissandoTo(key.note);
                    }}
                    onPointerEnter={(e) => {
                      if (!mousePressedRef.current || (e.buttons & 1) === 0)
                        return;
                      glissandoTo(key.note);
                    }}
                  >
                    {qwertyLabel && (
                      <span className="key-cap">{qwertyLabel}</span>
                    )}
                    {key.cLabel && (
                      <span className="octave-mark">{key.cLabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="black-keys">
              {BLACK_KEYS.map((key) => {
                const midiActive = activeMidiNotes.has(key.note);
                const localActive =
                  activeKeyboardNotes.has(key.note) ||
                  activeMouseNote === key.note;
                const pressed = midiActive || localActive;
                const qwertyLabel = keyboardEnabled
                  ? SEMITONE_TO_LABEL.get(key.note - (octave + 1) * 12)
                  : undefined;
                const leftPct =
                  ((key.whiteIndex + 0.65) / WHITE_KEYS.length) * 100;
                return (
                  <button
                    key={key.note}
                    type="button"
                    tabIndex={-1}
                    style={{ left: `${leftPct}%` }}
                    className={`piano-key black ${pressed ? "pressed" : ""} ${midiActive ? "midi-lit" : ""} ${qwertyLabel ? "mapped" : ""}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      mousePressedRef.current = true;
                      glissandoTo(key.note);
                    }}
                    onPointerEnter={(e) => {
                      if (!mousePressedRef.current || (e.buttons & 1) === 0)
                        return;
                      e.stopPropagation();
                      glissandoTo(key.note);
                    }}
                  >
                    {qwertyLabel && (
                      <span className="key-cap">{qwertyLabel}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </footer>
      )}

      {/* Voice Picker Modal */}
      {pickerTarget !== null && (
        <div
          className="modal-backdrop"
          onClick={() => setPickerTarget(null)}
        >
          <div
            className="modal-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Choose Voice"
          >
            <div className="modal-head">
              <div className="sound-title-row">
                <label>
                  {pickerTarget === "add"
                    ? "Add Sound Layer"
                    : `Select Voice for Layer ${pickerTarget + 1}`}
                </label>
                {loadingTarget && (
                  <span className="sound-loading-status">Loading samples…</span>
                )}
              </div>
              <div className="modal-head-right">
                <input
                  type="search"
                  className="voice-search"
                  placeholder={`Search ${sounds.length} voices…`}
                  value={soundSearch}
                  onChange={(e) => setSoundSearch(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => setPickerTarget(null)}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="category-tabs" role="tablist">
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

            <div className="modal-sound-grid">
              {filteredSounds.map((sound, idx) => {
                const isLoading = loadingTarget === sound.id;
                return (
                  <div
                    key={sound.id}
                    className={`sound-pad-wrap ${isLoading ? "loading" : ""}`}
                  >
                    <button
                      type="button"
                      disabled={loadingTarget !== null}
                      className="sound-pad-btn"
                      onClick={() => handleAssignSound(pickerTarget, sound.id)}
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
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Layer Controls Inspector Modal */}
      {editingLayer && editingLayerIdx !== null && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingLayerIdx(null)}
        >
          <div
            className="modal-card inspector-card"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Layer Controls"
          >
            <div className="modal-head">
              <div className="sound-title-row">
                <label>{editingLayer.soundName}</label>
                <span className="active-sound-pill">
                  Layer {editingLayerIdx + 1} · {editingLayer.category}
                </span>
              </div>
              <div className="modal-head-right">
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() =>
                    handleUpdateLayer(editingLayerIdx, {
                      minNote: 21,
                      maxNote: 108,
                      octaveShift: 0,
                      params: DEFAULT_SOUND_PARAMS,
                    })
                  }
                >
                  Reset Layer
                </button>
                <button
                  type="button"
                  className="btn-mini"
                  onClick={() => setEditingLayerIdx(null)}
                >
                  Done
                </button>
              </div>
            </div>

            <div className="controls-groups">
              <div className="control-group mode-group">
                <div className="group-title">Mode & Range</div>
                <div className="mode-pills">
                  {(["poly", "mono", "legato"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      className={`mode-pill ${editingLayer.params.voiceMode === mode ? "active" : ""}`}
                      onClick={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { voiceMode: mode },
                        })
                      }
                    >
                      {mode === "poly"
                        ? "Poly"
                        : mode === "mono"
                          ? "Mono"
                          : "Legato"}
                    </button>
                  ))}
                </div>
                <ParamSlider
                  label="Low Key"
                  displayValue={midiNoteLabel(editingLayer.minNote)}
                  value={editingLayer.minNote}
                  min={21}
                  max={editingLayer.maxNote}
                  onChange={(v) =>
                    handleUpdateLayer(editingLayerIdx, { minNote: v })
                  }
                  onReset={() =>
                    handleUpdateLayer(editingLayerIdx, { minNote: 21 })
                  }
                />
                <ParamSlider
                  label="High Key"
                  displayValue={midiNoteLabel(editingLayer.maxNote)}
                  value={editingLayer.maxNote}
                  min={editingLayer.minNote}
                  max={108}
                  onChange={(v) =>
                    handleUpdateLayer(editingLayerIdx, { maxNote: v })
                  }
                  onReset={() =>
                    handleUpdateLayer(editingLayerIdx, { maxNote: 108 })
                  }
                />
              </div>

              <div className="control-group">
                <div className="group-title">Tone</div>
                <div className="group-sliders">
                  {editingParamsSet.has("hammer") && (
                    <ParamSlider
                      label="Hammer"
                      displayValue={`${Math.round(editingLayer.params.hammerHardness * 100)}%`}
                      value={Math.round(
                        editingLayer.params.hammerHardness * 100
                      )}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { hammerHardness: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            hammerHardness: DEFAULT_SOUND_PARAMS.hammerHardness,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("brightness") && (
                    <ParamSlider
                      label="Tone"
                      displayValue={`${Math.round(editingLayer.params.brightness * 100)}%`}
                      value={Math.round(editingLayer.params.brightness * 100)}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { brightness: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            brightness: DEFAULT_SOUND_PARAMS.brightness,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("resonance") && (
                    <ParamSlider
                      label="Resonance"
                      displayValue={`${Math.round(editingLayer.params.resonance * 100)}%`}
                      value={Math.round(editingLayer.params.resonance * 100)}
                      min={0}
                      max={85}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { resonance: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            resonance: DEFAULT_SOUND_PARAMS.resonance,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("veltrack") && (
                    <ParamSlider
                      label="Veltrack"
                      displayValue={`${Math.round(editingLayer.params.velTrack * 100)}%`}
                      value={Math.round(editingLayer.params.velTrack * 100)}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { velTrack: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            velTrack: DEFAULT_SOUND_PARAMS.velTrack,
                          },
                        })
                      }
                    />
                  )}
                </div>
              </div>

              <div className="control-group">
                <div className="group-title">Effects & Envelope</div>
                <div className="group-sliders">
                  {editingParamsSet.has("chorus") && (
                    <ParamSlider
                      label="Chorus"
                      displayValue={`${Math.round(editingLayer.params.chorusMix * 100)}%`}
                      value={Math.round(editingLayer.params.chorusMix * 100)}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { chorusMix: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            chorusMix: DEFAULT_SOUND_PARAMS.chorusMix,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("tremolo") && (
                    <ParamSlider
                      label="Tremolo"
                      displayValue={`${Math.round(editingLayer.params.tremoloDepth * 100)}%`}
                      value={Math.round(editingLayer.params.tremoloDepth * 100)}
                      min={0}
                      max={100}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { tremoloDepth: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            tremoloDepth: DEFAULT_SOUND_PARAMS.tremoloDepth,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("delay") && (
                    <ParamSlider
                      label="Delay"
                      displayValue={`${Math.round(editingLayer.params.delayMix * 100)}%`}
                      value={Math.round(editingLayer.params.delayMix * 100)}
                      min={0}
                      max={60}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { delayMix: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            delayMix: DEFAULT_SOUND_PARAMS.delayMix,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("reverb") && (
                    <ParamSlider
                      label="Reverb"
                      displayValue={`${Math.round(editingLayer.params.reverbMix * 100)}%`}
                      value={Math.round(editingLayer.params.reverbMix * 100)}
                      min={0}
                      max={70}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { reverbMix: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            reverbMix: DEFAULT_SOUND_PARAMS.reverbMix,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("width") && (
                    <ParamSlider
                      label="Width"
                      displayValue={`${Math.round(editingLayer.params.stereoWidth * 100)}%`}
                      value={Math.round(editingLayer.params.stereoWidth * 100)}
                      min={0}
                      max={150}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { stereoWidth: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            stereoWidth: DEFAULT_SOUND_PARAMS.stereoWidth,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("glide") && (
                    <ParamSlider
                      label="Glide"
                      displayValue={`${Math.round(editingLayer.params.glideMs)} ms`}
                      value={Math.round(editingLayer.params.glideMs)}
                      min={0}
                      max={400}
                      step={5}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { glideMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { glideMs: DEFAULT_SOUND_PARAMS.glideMs },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("attack") && (
                    <ParamSlider
                      label="Attack"
                      displayValue={`${Math.round(editingLayer.params.attackMs)} ms`}
                      value={Math.round(editingLayer.params.attackMs)}
                      min={0}
                      max={300}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { attackMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            attackMs: DEFAULT_SOUND_PARAMS.attackMs,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("release") && (
                    <ParamSlider
                      label="Release"
                      displayValue={`${Math.round(editingLayer.params.releaseMs)} ms`}
                      value={Math.round(editingLayer.params.releaseMs)}
                      min={20}
                      max={1200}
                      step={5}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { releaseMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            releaseMs: DEFAULT_SOUND_PARAMS.releaseMs,
                          },
                        })
                      }
                    />
                  )}
                  {editingParamsSet.has("offset") && (
                    <ParamSlider
                      label="Offset"
                      displayValue={`${Math.round(editingLayer.params.sampleOffsetMs)} ms`}
                      value={Math.round(editingLayer.params.sampleOffsetMs)}
                      min={0}
                      max={40}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { sampleOffsetMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            sampleOffsetMs: DEFAULT_SOUND_PARAMS.sampleOffsetMs,
                          },
                        })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
