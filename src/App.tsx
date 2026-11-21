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
  decayMs: number;
  sustainLevel: number;
  modFilterMinHz: number;
  modFilterMaxHz: number;
  compEnabled: boolean;
  compInputDb: number;
  compAttackMs: number;
  compReleaseMs: number;
  compRatio: number;
  compThresholdDb: number;
  compMix: number;
  compOutputDb: number;
  eqEnabled: boolean;
  eqFreqs: number[];
  eqGains: number[];
  eqQs: number[];
  blockSustain: boolean;
  pan: number;
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
  worshipPadVoice?: number;
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
  decayMs: 10000.0,
  sustainLevel: 1.0,
  modFilterMinHz: 200.0,
  modFilterMaxHz: 20000.0,
  compEnabled: false,
  compInputDb: 0.0,
  compAttackMs: 15.0,
  compReleaseMs: 49.0,
  compRatio: 4.2,
  compThresholdDb: -29.0,
  compMix: 0.85,
  compOutputDb: 3.5,
  eqEnabled: false,
  eqFreqs: [67, 200, 197, 345, 1000, 5417, 1101, 9000],
  eqGains: [0, 0, 0, 0, 0, 0],
  eqQs: [0.28, 0.3, 0.5, 0.36],
  blockSustain: false,
  pan: 0.0,
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

const WORSHIP_PAD_VOICES = [
  { value: "0", label: "1. Warm" },
  { value: "1", label: "2. Shimmer" },
  { value: "2", label: "3. Organ" },
  { value: "3", label: "4. Deep Sub" },
  { value: "4", label: "5. Airy Choir" },
  { value: "5", label: "6. Bright Analog" },
];

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

const LAYER_COLORS = ["#f59e0b", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

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
    decayMs: lerp(from.decayMs, to.decayMs, t),
    sustainLevel: lerp(from.sustainLevel, to.sustainLevel, t),
    modFilterMinHz: lerp(from.modFilterMinHz, to.modFilterMinHz, t),
    modFilterMaxHz: lerp(from.modFilterMaxHz, to.modFilterMaxHz, t),
    compEnabled: to.compEnabled,
    compInputDb: lerp(from.compInputDb, to.compInputDb, t),
    compAttackMs: lerp(from.compAttackMs, to.compAttackMs, t),
    compReleaseMs: lerp(from.compReleaseMs, to.compReleaseMs, t),
    compRatio: lerp(from.compRatio, to.compRatio, t),
    compThresholdDb: lerp(from.compThresholdDb, to.compThresholdDb, t),
    compMix: lerp(from.compMix, to.compMix, t),
    compOutputDb: lerp(from.compOutputDb, to.compOutputDb, t),
    eqEnabled: to.eqEnabled,
    eqFreqs: to.eqFreqs.map((v, i) => lerp(from.eqFreqs[i] ?? v, v, t)),
    eqGains: to.eqGains.map((v, i) => lerp(from.eqGains[i] ?? v, v, t)),
    eqQs: to.eqQs.map((v, i) => lerp(from.eqQs[i] ?? v, v, t)),
    blockSustain: to.blockSustain,
    pan: lerp(from.pan, to.pan, t),
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

function formatDb(vol: number): string {
  if (vol <= 0.002) return "-∞";
  const db = 20 * Math.log10(vol / 0.85);
  if (Math.abs(db) < 0.05) return "0 dB";
  return `${db.toFixed(2)} dB`;
}

function RotaryKnob({
  label,
  value,
  min,
  max,
  step = 1,
  displayValue,
  color = "#93b4f5",
  size = 54,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue: string;
  color?: string;
  size?: number;
  onChange: (val: number) => void;
  onReset?: () => void;
}) {
  const dragRef = useRef<{ startY: number; startVal: number } | null>(null);
  const norm = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  const startAngle = -135;
  const endAngle = 135;
  const angle = startAngle + norm * (endAngle - startAngle);
  const r = 20;
  const cx = 26;
  const cy = 26;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const arcPath = (fromDeg: number, toDeg: number) => {
    const p1 = polar(fromDeg);
    const p2 = polar(toDeg);
    const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
    return `M ${p1.x} ${p1.y} A ${r} ${r} 0 ${large} 1 ${p2.x} ${p2.y}`;
  };

  const ptrInner = {
    x: cx + 7 * Math.cos(((angle - 90) * Math.PI) / 180),
    y: cy + 7 * Math.sin(((angle - 90) * Math.PI) / 180),
  };
  const ptrOuter = {
    x: cx + 14 * Math.cos(((angle - 90) * Math.PI) / 180),
    y: cy + 14 * Math.sin(((angle - 90) * Math.PI) / 180),
  };

  return (
    <div className="sk-knob-wrap">
      {label && <span className="sk-knob-label">{label}</span>}
      <div
        className="sk-knob-dial"
        style={{ width: size, height: size }}
        role="slider"
        tabIndex={0}
        aria-label={label || displayValue}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          dragRef.current = { startY: e.clientY, startVal: value };
        }}
        onPointerMove={(e) => {
          if (!dragRef.current || e.buttons !== 1) return;
          const dy = dragRef.current.startY - e.clientY;
          const raw = dragRef.current.startVal + (dy / 130) * (max - min);
          const stepped = Math.round(raw / step) * step;
          onChange(Math.max(min, Math.min(max, Number(stepped.toFixed(4)))));
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onDoubleClick={onReset}
      >
        <svg viewBox="0 0 52 52" width={size} height={size}>
          <path
            d={arcPath(startAngle, endAngle)}
            fill="none"
            stroke="#0e1017"
            strokeWidth="3.5"
            strokeLinecap="round"
          />
          {norm > 0.005 && (
            <path
              d={arcPath(startAngle, angle)}
              fill="none"
              stroke={color}
              strokeWidth="3.5"
              strokeLinecap="round"
            />
          )}
          <circle cx={cx} cy={cy} r="15.5" fill="#2e3340" stroke="#474e61" strokeWidth="1" />
          <line
            x1={ptrInner.x}
            y1={ptrInner.y}
            x2={ptrOuter.x}
            y2={ptrOuter.y}
            stroke={color}
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      </div>
      <span className="sk-knob-val">{displayValue}</span>
    </div>
  );
}

interface CustomSelectOption {
  value: string;
  label: string;
}

function CustomSelect({
  id,
  ariaLabel,
  value,
  options,
  onChange,
  className = "",
  menuUp = false,
}: {
  id?: string;
  ariaLabel?: string;
  value: string;
  options: CustomSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  menuUp?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentLabel =
    options.find((o) => o.value === value)?.label ?? value;

  return (
    <div
      ref={wrapRef}
      className={`custom-select ${open ? "open" : ""} ${menuUp ? "menu-up" : ""} ${className}`}
    >
      <button
        id={id}
        type="button"
        className="custom-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="custom-select-value">{currentLabel}</span>
        <svg
          className="custom-select-chevron"
          viewBox="0 0 24 24"
          width="14"
          height="14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="custom-select-menu" role="listbox" aria-label={ariaLabel}>
          {options.map((opt) => {
            const active = opt.value === value;
            return (
              <button
                key={opt.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`custom-select-option ${active ? "active" : ""}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span className="custom-select-check" aria-hidden="true">
                  {active ? "✓" : ""}
                </span>
                <span>{opt.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const TYPE_FACETS = [
  "Acoustic Piano",
  "Electric Piano",
  "Digital Piano",
  "Piano",
  "Pad",
  "Bell",
  "Organ",
  "Synth",
  "Bass",
  "Strings",
  "Brass",
  "Guitar",
  "Lead",
  "Choir",
  "Keys",
];

function soundMatchesFacet(sound: SoundDto, facet: string): boolean {
  const f = facet.toLowerCase();
  return (
    sound.name.toLowerCase().includes(f) ||
    sound.category.toLowerCase().includes(f) ||
    sound.supportedParams.some((p) => p.toLowerCase().includes(f))
  );
}

function getSoundLibrary(sound: SoundDto): string {
  if (
    sound.id.startsWith("sk-") ||
    sound.name.toLowerCase().includes("sunday") ||
    sound.name.startsWith("SK ")
  ) {
    return "Sunday Keys";
  }
  return "Takt Library";
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
  const [soundLibrary, setSoundLibrary] = useState<string>("All");
  const [soundType, setSoundType] = useState<string>("All");
  const [soundSortBy, setSoundSortBy] = useState<"name" | "category">("name");
  const [soundSortAsc, setSoundSortAsc] = useState<boolean>(true);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPickerSelectedId(null);
  }, [pickerTarget]);
  // Layer DSP inspector modal: layer index or null
  const [editingLayerIdx, setEditingLayerIdx] = useState<number | null>(null);
  const [inspectorTab, setInspectorTab] = useState<
    "adsr" | "modfilter" | "compressor" | "equalizer" | "effects" | "settings"
  >("compressor");
  const inspectorSnapshotRef = useRef<{
    index: number;
    layer: LayerDto;
  } | null>(null);

  const openLayerInspector = useCallback(
    (idx: number) => {
      setEditingLayerIdx((cur) => {
        if (cur === idx) return null;
        const target = status?.layers[idx];
        if (target) {
          inspectorSnapshotRef.current = {
            index: idx,
            layer: JSON.parse(JSON.stringify(target)),
          };
        }
        return idx;
      });
    },
    [status?.layers]
  );
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
          }).catch(() => { });

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

  const discardInspectorChanges = useCallback(() => {
    const snap = inspectorSnapshotRef.current;
    if (snap) {
      void handleUpdateLayer(snap.index, {
        enabled: snap.layer.enabled,
        volume: snap.layer.volume,
        minNote: snap.layer.minNote,
        maxNote: snap.layer.maxNote,
        octaveShift: snap.layer.octaveShift,
        params: snap.layer.params,
      });
    }
    inspectorSnapshotRef.current = null;
    setEditingLayerIdx(null);
  }, [handleUpdateLayer]);

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
      invoke("trigger_test_note", { note, down: false }).catch(() => { });
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
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sounds]);

  const soundLibraries = useMemo(() => {
    const set = new Set<string>();
    for (const s of sounds) set.add(getSoundLibrary(s));
    return Array.from(set).sort();
  }, [sounds]);

  const availableTypes = useMemo(
    () => TYPE_FACETS.filter((f) => sounds.some((s) => soundMatchesFacet(s, f))),
    [sounds]
  );

  const filteredSounds = useMemo(() => {
    const q = soundSearch.trim().toLowerCase();
    const list = sounds.filter((s) => {
      if (soundLibrary !== "All" && getSoundLibrary(s) !== soundLibrary) {
        return false;
      }
      if (selectedCategory !== "All" && s.category !== selectedCategory) {
        return false;
      }
      if (soundType !== "All" && !soundMatchesFacet(s, soundType)) {
        return false;
      }
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      const cmp =
        soundSortBy === "category"
          ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name);
      return soundSortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [
    sounds,
    soundLibrary,
    selectedCategory,
    soundType,
    soundSearch,
    soundSortBy,
    soundSortAsc,
  ]);

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

  const handleRefreshMidiDevices = useCallback(async () => {
    try {
      const devices = await invoke<string[]>("refresh_midi_devices");
      setMidiDevices(devices);
    } catch (err) {
      setError(String(err));
    }
  }, []);

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
            onClick={() =>
              setSetupOpen((v) => {
                if (!v) void handleRefreshMidiDevices();
                return !v;
              })
            }
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
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => void handleRefreshMidiDevices()}
                >
                  Refresh
                </button>
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
              <CustomSelect
                id="audio-select"
                ariaLabel="Audio Output"
                value={status?.audioDevice ?? ""}
                options={audioDevices.map((dev) => ({
                  value: dev.name,
                  label: `${dev.name}${dev.isDefault ? " (Default)" : ""}`,
                }))}
                onChange={(val) =>
                  handleAudioChange(val, status?.bufferSize ?? null)
                }
              />
            </div>

            <div className="field">
              <label htmlFor="buffer-select">Buffer Size</label>
              <CustomSelect
                id="buffer-select"
                ariaLabel="Buffer Size"
                value={
                  status?.bufferSize !== null && status?.bufferSize !== undefined
                    ? String(status.bufferSize)
                    : ""
                }
                options={[
                  { value: "", label: "System Default" },
                  ...bufferChoices.map((frames) => ({
                    value: String(frames),
                    label: `${frames} samples`,
                  })),
                ]}
                onChange={(val) => {
                  const nextBuf = val === "" ? null : Number(val);
                  handleAudioChange(status?.audioDevice ?? "", nextBuf);
                }}
              />
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
                <span className="sidebar-title">Patches</span>
                <button
                  type="button"
                  className="sidebar-new-btn"
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
                  className="patch-nav-btn"
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
                  ‹ Prev
                </button>
                <button
                  type="button"
                  className="patch-nav-btn"
                  disabled={patches.length <= 1 || loadingTarget !== null}
                  onClick={() => {
                    const cur = patches.findIndex(
                      (p) => p.id === activePatch?.id
                    );
                    const next = (cur + 1) % patches.length;
                    handleLoadPatch(patches[next], 0);
                  }}
                >
                  Next ›
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
                  Pad
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
                  Track
                </button>
              </div>

              {leftTab === "pad" ? (
                <div className="pad-body">
                  <div className="pad-main">
                    <div className="pad-voice-bar">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={status?.worshipPadEnabled ?? false}
                        aria-label={
                          status?.worshipPadEnabled
                            ? "Turn Worship Pad Off"
                            : "Turn Worship Pad On"
                        }
                        title={
                          status?.worshipPadEnabled ? "Pad ON" : "Pad OFF"
                        }
                        className={`pad-split-pwr ${status?.worshipPadEnabled ? "on" : ""}`}
                        onClick={handleWorshipPadToggle}
                      >
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                        >
                          <path d="M12 3v9" />
                          <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                        </svg>
                      </button>
                      <CustomSelect
                        ariaLabel="Worship Pad Voice"
                        className="pad-voice-select"
                        menuUp
                        value={String(status?.worshipPadVoice ?? 0)}
                        options={WORSHIP_PAD_VOICES}
                        onChange={(val) => {
                          const voice = Number(val);
                          setStatus((prev) =>
                            prev ? { ...prev, worshipPadVoice: voice } : prev
                          );
                          void invoke("set_worship_pad_voice", { voice });
                        }}
                      />
                    </div>

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
                  </div>

                  <div className="sidebar-fader-col">
                    <div
                      className="sk-fader compact"
                      style={{ "--layer-color": "#89a8f0" } as React.CSSProperties}
                      role="slider"
                      tabIndex={0}
                      aria-label="Worship Pad Volume"
                      aria-valuemin={0}
                      aria-valuemax={125}
                      aria-valuenow={padVolPct}
                      onPointerDown={(e) => {
                        if (e.detail >= 2) {
                          handleWorshipPadVolume(55);
                          return;
                        }
                        e.currentTarget.setPointerCapture(e.pointerId);
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = 1 - (e.clientY - rect.top) / rect.height;
                        handleWorshipPadVolume(
                          Math.round(Math.max(0, Math.min(1, ratio)) * 125)
                        );
                      }}
                      onPointerMove={(e) => {
                        if (e.buttons !== 1) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const ratio = 1 - (e.clientY - rect.top) / rect.height;
                        handleWorshipPadVolume(
                          Math.round(Math.max(0, Math.min(1, ratio)) * 125)
                        );
                      }}
                      onDoubleClick={() => handleWorshipPadVolume(55)}
                    >
                      <div className="sk-fader-groove" aria-hidden="true">
                        <div
                          className="sk-fader-glow"
                          style={{ height: `${(padVolPct / 125) * 100}%` }}
                        />
                      </div>
                      <div
                        className="sk-fader-thumb"
                        style={{
                          bottom: `calc(${(padVolPct / 125) * 100}% - 10px)`,
                        }}
                        aria-hidden="true"
                      >
                        <span className="sk-fader-led" />
                      </div>
                    </div>
                    <span className="sidebar-fader-val">{padVolPct}%</span>
                  </div>
                </div>
              ) : (
                <div className="track-module">
                  <input
                    ref={trackInputRef}
                    type="file"
                    accept=".wav,.flac,.ogg,audio/wav,audio/flac,audio/ogg"
                    style={{ display: "none" }}
                    onChange={handleTrackFileSelected}
                  />
                  <div className="track-body">
                    <div className="track-main">
                      <div className="track-info-card">
                        <div className="track-info-text">
                          <span
                            className="track-name"
                            title={status?.backingTrackName ?? ""}
                          >
                            {status?.backingTrackName ?? "No track loaded"}
                          </span>
                          <span className="track-time">
                            {formatTimeMs(trackPos)} /{" "}
                            {formatTimeMs(
                              status?.backingTrackDurationMs ?? 0
                            )}
                          </span>
                        </div>
                        <button
                          type="button"
                          className="track-load-btn"
                          onClick={() => trackInputRef.current?.click()}
                          title="Load Backing Track (.wav, .flac, .ogg)"
                        >
                          Load
                        </button>
                      </div>

                      <input
                        type="range"
                        className="sk-seek-bar"
                        style={
                          { "--fill": `${trackSeekPct}%` } as React.CSSProperties
                        }
                        aria-label="Backing Track Progress"
                        min={0}
                        max={trackDuration}
                        value={trackPos}
                        disabled={!status?.backingTrackName}
                        onChange={(e) =>
                          handleTrackSeek(Number(e.target.value))
                        }
                      />

                      <div className="track-transport-row">
                        <button
                          type="button"
                          className={`track-btn play ${status?.backingTrackPlaying ? "active" : ""}`}
                          onClick={handleTrackPlayToggle}
                          disabled={!status?.backingTrackName}
                        >
                          {status?.backingTrackPlaying ? "⏸ Pause" : "▶ Play"}
                        </button>
                        <button
                          type="button"
                          className={`track-btn track-loop-btn ${status?.backingTrackLoop ? "active" : ""}`}
                          onClick={handleTrackLoopToggle}
                          aria-label="Toggle Loop"
                          aria-pressed={Boolean(status?.backingTrackLoop)}
                          title={
                            status?.backingTrackLoop ? "Loop ON" : "Loop OFF"
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="15"
                            height="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.1"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="17 1 21 5 17 9" />
                            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                            <polyline points="7 23 3 19 7 15" />
                            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="sidebar-fader-col">
                      <div
                        className="sk-fader compact"
                        style={{ "--layer-color": "#89a8f0" } as React.CSSProperties}
                        role="slider"
                        tabIndex={0}
                        aria-label="Backing Track Volume"
                        aria-valuemin={0}
                        aria-valuemax={125}
                        aria-valuenow={trackVolPct}
                        onPointerDown={(e) => {
                          if (e.detail >= 2) {
                            handleTrackVolumeChange(75);
                            return;
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio =
                            1 - (e.clientY - rect.top) / rect.height;
                          handleTrackVolumeChange(
                            Math.round(Math.max(0, Math.min(1, ratio)) * 125)
                          );
                        }}
                        onPointerMove={(e) => {
                          if (e.buttons !== 1) return;
                          const rect = e.currentTarget.getBoundingClientRect();
                          const ratio =
                            1 - (e.clientY - rect.top) / rect.height;
                          handleTrackVolumeChange(
                            Math.round(Math.max(0, Math.min(1, ratio)) * 125)
                          );
                        }}
                        onDoubleClick={() => handleTrackVolumeChange(75)}
                      >
                        <div className="sk-fader-groove" aria-hidden="true">
                          <div
                            className="sk-fader-glow"
                            style={{ height: `${(trackVolPct / 125) * 100}%` }}
                          />
                        </div>
                        <div
                          className="sk-fader-thumb"
                          style={{
                            bottom: `calc(${(trackVolPct / 125) * 100}% - 10px)`,
                          }}
                          aria-hidden="true"
                        >
                          <span className="sk-fader-led" />
                        </div>
                      </div>
                      <span className="sidebar-fader-val">{trackVolPct}%</span>
                    </div>
                  </div>
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
                const faderPct = Math.max(0, Math.min(100, (layer.volume / 1.25) * 100));
                const paramSet = new Set(layer.supportedParams);

                const midiActive = layer.octaveShift !== 0;
                const midiLabel =
                  layer.octaveShift === 1
                    ? "Octave Up"
                    : layer.octaveShift === -1
                      ? "Octave Down"
                      : layer.octaveShift > 0
                        ? `Octave +${layer.octaveShift}`
                        : layer.octaveShift < 0
                          ? `Octave ${layer.octaveShift}`
                          : "Select Effect";

                const hasAudio01 = paramSet.has("chorus");
                const audio01Lit = hasAudio01 && layer.params.chorusMix > 0.02;

                const hasTremolo = paramSet.has("tremolo");
                const hasDelay = paramSet.has("delay");
                const audio02Kind = hasTremolo
                  ? "tremolo"
                  : hasDelay
                    ? "delay"
                    : null;
                const audio02Lit =
                  audio02Kind === "tremolo"
                    ? layer.params.tremoloDepth > 0.02
                    : audio02Kind === "delay"
                      ? layer.params.delayMix > 0.02
                      : false;

                const hasAudio03 = paramSet.has("reverb");
                const audio03Lit = hasAudio03 && layer.params.reverbMix > 0.02;

                const updateFaderFromPointer = (
                  e: React.PointerEvent<HTMLDivElement>
                ) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const ratio = 1 - (e.clientY - rect.top) / rect.height;
                  const clamped = Math.max(0, Math.min(1, ratio));
                  let nextVol = Math.round(clamped * 125) / 100;
                  if (Math.abs(nextVol - 0.85) <= 0.025) {
                    nextVol = 0.85;
                  }
                  handleUpdateLayer(idx, {
                    volume: nextVol,
                  });
                };

                return (
                  <div
                    key={`${idx}-${layer.soundId}`}
                    className={`layer-strip ${layer.enabled ? "" : "muted"}`}
                    style={{ "--layer-color": color } as React.CSSProperties}
                  >
                    <div className="layer-head">
                      <button
                        type="button"
                        className="layer-name-btn"
                        onClick={() => setPickerTarget(idx)}
                        title={`${layer.soundName} (${layer.category} · ${midiNoteLabel(layer.minNote)}–${midiNoteLabel(layer.maxNote)}) — Click to change sound`}
                      >
                        <span className="layer-name">{layer.soundName}</span>
                      </button>

                      <div className="layer-head-actions">
                        <button
                          type="button"
                          className={`sk-tune-btn ${editingLayerIdx === idx ? "active" : ""}`}
                          onClick={() => openLayerInspector(idx)}
                          title="Layer Controls (Tone, Envelope, Key Range)"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="15"
                            height="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          >
                            <line x1="4" y1="6" x2="20" y2="6" />
                            <circle cx="9" cy="6" r="2" fill="currentColor" />
                            <line x1="4" y1="12" x2="20" y2="12" />
                            <circle cx="15" cy="12" r="2" fill="currentColor" />
                            <line x1="4" y1="18" x2="20" y2="18" />
                            <circle cx="10" cy="18" r="2" fill="currentColor" />
                          </svg>
                        </button>
                        {idx > 0 && (
                          <button
                            type="button"
                            className="sk-remove-btn"
                            onClick={() => handleRemoveLayer(idx)}
                            title="Remove Layer"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Sunday-Keys 1:1 Midi + Audio 01-03 split-power slots */}
                    <div className="layer-slots">
                      <div
                        className={`sk-slot sk-slot-midi ${midiActive ? "lit" : "empty-val"}`}
                      >
                        <button
                          type="button"
                          className="sk-slot-pwr"
                          aria-label="Toggle Octave Shift"
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              octaveShift: midiActive ? 0 : 1,
                            })
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          >
                            <path d="M12 3v9" />
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sk-slot-body"
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
                          <span className="sk-slot-sub">Midi</span>
                          <span className="sk-slot-val-row">
                            <span className="sk-slot-val">{midiLabel}</span>
                            {!midiActive && (
                              <span className="sk-slot-chevron" aria-hidden="true">
                                ›
                              </span>
                            )}
                          </span>
                        </button>
                      </div>

                      <div
                        className={`sk-slot ${audio01Lit ? "lit" : ""} ${!hasAudio01 ? "disabled" : ""}`}
                      >
                        <button
                          type="button"
                          className="sk-slot-pwr"
                          disabled={!hasAudio01}
                          aria-label="Toggle Chorus"
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                chorusMix: audio01Lit ? 0.0 : 0.45,
                              },
                            })
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          >
                            <path d="M12 3v9" />
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sk-slot-body"
                          disabled={!hasAudio01}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                chorusMix: audio01Lit ? 0.0 : 0.45,
                              },
                            })
                          }
                        >
                          <span className="sk-slot-sub">Audio 01</span>
                          <span className="sk-slot-val">
                            {hasAudio01 ? "Chorus" : "Effect"}
                          </span>
                        </button>
                      </div>

                      <div
                        className={`sk-slot ${audio02Lit ? "lit" : ""} ${!audio02Kind ? "disabled" : ""}`}
                      >
                        <button
                          type="button"
                          className="sk-slot-pwr"
                          disabled={!audio02Kind}
                          aria-label={`Toggle ${audio02Kind === "tremolo" ? "Tremolo" : "Delay"}`}
                          onClick={() => {
                            if (audio02Kind === "tremolo") {
                              handleUpdateLayer(idx, {
                                paramsPatch: {
                                  tremoloDepth: audio02Lit ? 0.0 : 0.45,
                                },
                              });
                            } else if (audio02Kind === "delay") {
                              handleUpdateLayer(idx, {
                                paramsPatch: {
                                  delayMix: audio02Lit ? 0.0 : 0.28,
                                },
                              });
                            }
                          }}
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          >
                            <path d="M12 3v9" />
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sk-slot-body"
                          disabled={!audio02Kind}
                          onClick={() => {
                            if (audio02Kind === "tremolo") {
                              handleUpdateLayer(idx, {
                                paramsPatch: {
                                  tremoloDepth: audio02Lit ? 0.0 : 0.45,
                                },
                              });
                            } else if (audio02Kind === "delay") {
                              handleUpdateLayer(idx, {
                                paramsPatch: {
                                  delayMix: audio02Lit ? 0.0 : 0.28,
                                },
                              });
                            }
                          }}
                        >
                          <span className="sk-slot-sub">Audio 02</span>
                          <span className="sk-slot-val">
                            {audio02Kind === "tremolo"
                              ? "Tremolo"
                              : audio02Kind === "delay"
                                ? "Delay"
                                : "Effect"}
                          </span>
                        </button>
                      </div>

                      <div
                        className={`sk-slot ${audio03Lit ? "lit" : ""} ${!hasAudio03 ? "disabled" : ""}`}
                      >
                        <button
                          type="button"
                          className="sk-slot-pwr"
                          disabled={!hasAudio03}
                          aria-label="Toggle Reverb"
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                reverbMix: audio03Lit ? 0.0 : 0.3,
                              },
                            })
                          }
                        >
                          <svg
                            viewBox="0 0 24 24"
                            width="14"
                            height="14"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                          >
                            <path d="M12 3v9" />
                            <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sk-slot-body"
                          disabled={!hasAudio03}
                          onClick={() =>
                            handleUpdateLayer(idx, {
                              paramsPatch: {
                                reverbMix: audio03Lit ? 0.0 : 0.3,
                              },
                            })
                          }
                        >
                          <span className="sk-slot-sub">Audio 03</span>
                          <span className="sk-slot-val">
                            {hasAudio03 ? "Reverb" : "Effect"}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Sunday-Keys 1:1 Vertical Fader with ticks, glowing track, 3D cap & dB readout */}
                    <div className="layer-fader-area">
                      <div
                        className="sk-fader"
                        role="slider"
                        tabIndex={0}
                        aria-label={`${layer.soundName} Volume`}
                        aria-valuemin={0}
                        aria-valuemax={125}
                        aria-valuenow={layerVolPct}
                        onPointerDown={(e) => {
                          if (e.detail >= 2) {
                            handleUpdateLayer(idx, { volume: 0.85 });
                            return;
                          }
                          e.currentTarget.setPointerCapture(e.pointerId);
                          const rect = e.currentTarget.getBoundingClientRect();
                          const clickPct =
                            (1 - (e.clientY - rect.top) / rect.height) * 100;
                          if (Math.abs(clickPct - faderPct) > 4.5) {
                            updateFaderFromPointer(e);
                          }
                        }}
                        onPointerMove={(e) => {
                          if (e.buttons === 1) updateFaderFromPointer(e);
                        }}
                        onDoubleClick={() =>
                          handleUpdateLayer(idx, { volume: 0.85 })
                        }
                        onKeyDown={(e) => {
                          if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                            e.preventDefault();
                            handleUpdateLayer(idx, {
                              volume: Math.min(1.25, layer.volume + 0.03),
                            });
                          } else if (
                            e.key === "ArrowDown" ||
                            e.key === "ArrowLeft"
                          ) {
                            e.preventDefault();
                            handleUpdateLayer(idx, {
                              volume: Math.max(0, layer.volume - 0.03),
                            });
                          }
                        }}
                      >
                        <div className="sk-fader-ticks left" aria-hidden="true">
                          <span style={{ bottom: "94%" }} />
                          <span className="zero-tick" style={{ bottom: "68%" }} />
                          <span style={{ bottom: "52%" }} />
                          <span style={{ bottom: "36%" }} />
                          <span style={{ bottom: "20%" }} />
                          <span style={{ bottom: "4%" }} />
                        </div>
                        <div className="sk-fader-ticks right" aria-hidden="true">
                          <span style={{ bottom: "94%" }} />
                          <span className="zero-tick" style={{ bottom: "68%" }} />
                          <span style={{ bottom: "52%" }} />
                          <span style={{ bottom: "36%" }} />
                          <span style={{ bottom: "20%" }} />
                          <span style={{ bottom: "4%" }} />
                        </div>
                        <div className="sk-fader-groove" aria-hidden="true">
                          <div
                            className="sk-fader-glow"
                            style={{ height: `${faderPct}%` }}
                          />
                        </div>
                        <div
                          className="sk-fader-thumb"
                          style={{ bottom: `calc(${faderPct}% - 11px)` }}
                          aria-hidden="true"
                        >
                          <span className="sk-fader-led" />
                        </div>
                        {Math.abs(layer.volume - 0.85) >= 0.005 && (
                          <span
                            className="sk-fader-db"
                            style={{ bottom: `calc(${faderPct}% - 7px)` }}
                          >
                            {formatDb(layer.volume)}
                          </span>
                        )}
                        <span className="sk-fader-inf" aria-hidden="true">
                          -∞
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {Array.from({
                length: Math.max(1, 5 - layers.length),
              }).map((_, slotOffset) => {
                const slotIdx = layers.length + slotOffset;
                const slotColor = LAYER_COLORS[slotIdx % LAYER_COLORS.length];
                return (
                  <button
                    key={`add-slot-${slotIdx}`}
                    type="button"
                    className="add-layer-slot"
                    style={{ "--slot-color": slotColor } as React.CSSProperties}
                    onClick={() => setPickerTarget("add")}
                  >
                    <div className="add-ghost-strip" aria-hidden="true">
                      <div className="add-ghost-head">
                        <span className="add-ghost-icon">
                          <svg
                            viewBox="0 0 24 24"
                            width="15"
                            height="15"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                          >
                            <line x1="4" y1="6" x2="20" y2="6" />
                            <circle cx="9" cy="6" r="2" fill="currentColor" />
                            <line x1="4" y1="12" x2="20" y2="12" />
                            <circle cx="15" cy="12" r="2" fill="currentColor" />
                            <line x1="4" y1="18" x2="20" y2="18" />
                            <circle cx="10" cy="18" r="2" fill="currentColor" />
                          </svg>
                        </span>
                      </div>
                      <div className="add-ghost-slots">
                        {["Midi", "Audio 01", "Audio 02", "Audio 03"].map(
                          (slotLabel) => (
                            <div key={slotLabel} className="add-ghost-slot">
                              <span className="add-ghost-pwr">
                                <svg
                                  viewBox="0 0 24 24"
                                  width="14"
                                  height="14"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.2"
                                  strokeLinecap="round"
                                >
                                  <path d="M12 3v9" />
                                  <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
                                </svg>
                              </span>
                              <div className="add-ghost-txt">
                                <span className="add-ghost-sub">
                                  {slotLabel}
                                </span>
                                <span className="add-ghost-val">Effect</span>
                              </div>
                            </div>
                          )
                        )}
                      </div>
                      <div className="add-ghost-fader" />
                    </div>
                    <div className="add-overlay">
                      <span className="add-plus">
                        <span>+</span>
                      </span>
                      <span>Add Sound</span>
                    </div>
                  </button>
                );
              })}
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
                    className="snap-action-btn"
                    onClick={handleAddSnapshot}
                    title="Add new Snapshot from current state"
                  >
                    + Snap
                  </button>
                  <button
                    type="button"
                    className="snap-action-btn snap-save-btn"
                    onClick={handleSaveCurrentSnapshot}
                    aria-label="Save Snapshot"
                    title="Save current layer levels/effects into active Snapshot"
                  >
                    <svg
                      viewBox="0 0 24 24"
                      width="15"
                      height="15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                      <polyline points="17 21 17 13 7 13 7 21" />
                      <polyline points="7 3 7 8 15 8" />
                    </svg>
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

      {/* Sound Browser Modal (Sunday Keys 1:1) */}
      {pickerTarget !== null && (
        <div
          className="modal-backdrop"
          onClick={() => setPickerTarget(null)}
        >
          <div
            className="modal-card sound-browser-modal"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Sound Select"
          >
            {/* Top Bar: Library | Colored Module Title | Search */}
            <div className="sb-header">
              <div className="sb-library-wrap">
                <span className="sb-label">Library</span>
                <CustomSelect
                  ariaLabel="Library"
                  className="sb-dropdown"
                  value={soundLibrary}
                  options={[
                    { value: "All", label: "All Sounds" },
                    ...soundLibraries.map((lib) => ({ value: lib, label: lib })),
                  ]}
                  onChange={setSoundLibrary}
                />
              </div>

              <div className="sb-title-center">
                <span
                  className="sb-module-dot"
                  style={{
                    background:
                      LAYER_COLORS[
                      (pickerTarget === "add"
                        ? layers.length
                        : pickerTarget) % LAYER_COLORS.length
                      ],
                  }}
                />
                <span className="sb-title-text">
                  {pickerTarget === "add"
                    ? `Add Sound to Module ${layers.length + 1}`
                    : `Select Sound for Module ${pickerTarget + 1}`}
                </span>
              </div>

              <div className="sb-search-wrap">
                <svg
                  className="sb-search-icon"
                  viewBox="0 0 24 24"
                  width="15"
                  height="15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input
                  type="search"
                  className="sb-search-input"
                  placeholder="Search"
                  value={soundSearch}
                  onChange={(e) => setSoundSearch(e.target.value)}
                  autoFocus
                />
              </div>
            </div>

            {/* 3-Column Browser Body */}
            <div className="sb-columns">
              {/* Column 1: Category */}
              <div className="sb-col">
                <div className="sb-col-title">Category</div>
                <div className="sb-col-list" role="listbox" aria-label="Category">
                  <button
                    type="button"
                    className={`sb-item ${selectedCategory === "All" ? "active" : ""}`}
                    onClick={() => setSelectedCategory("All")}
                  >
                    All
                  </button>
                  {soundCategories.map((cat) => (
                    <button
                      key={cat.name}
                      type="button"
                      className={`sb-item ${selectedCategory === cat.name ? "active" : ""}`}
                      onClick={() => setSelectedCategory(cat.name)}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 2: Type */}
              <div className="sb-col">
                <div className="sb-col-title">Type</div>
                <div className="sb-col-list" role="listbox" aria-label="Type">
                  <button
                    type="button"
                    className={`sb-item ${soundType === "All" ? "active" : ""}`}
                    onClick={() => setSoundType("All")}
                  >
                    All
                  </button>
                  {availableTypes.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`sb-item ${soundType === t ? "active" : ""}`}
                      onClick={() => setSoundType(t)}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              {/* Column 3: Results List */}
              <div className="sb-col sb-results-col">
                <div className="sb-results-head">
                  <span className="sb-label">Order by</span>
                  <CustomSelect
                    ariaLabel="Order by"
                    className="sb-dropdown sb-order-select"
                    value={soundSortBy}
                    options={[
                      { value: "name", label: "Name" },
                      { value: "category", label: "Category" },
                    ]}
                    onChange={(val) =>
                      setSoundSortBy(val as "name" | "category")
                    }
                  />
                  <button
                    type="button"
                    className="sb-sort-dir-btn"
                    onClick={() => setSoundSortAsc((v) => !v)}
                    title={soundSortAsc ? "Ascending" : "Descending"}
                  >
                    {soundSortAsc ? "↓≡" : "↑≡"}
                  </button>
                </div>

                <div className="sb-results-list" role="listbox" aria-label="Sounds">
                  {filteredSounds.map((sound) => {
                    const selected = pickerSelectedId === sound.id;
                    const dotCount = Math.min(
                      6,
                      Math.max(2, Math.ceil(sound.supportedParams.length / 2))
                    );
                    return (
                      <button
                        key={sound.id}
                        type="button"
                        className={`sb-result-row ${selected ? "active" : ""}`}
                        onClick={() => setPickerSelectedId(sound.id)}
                        onDoubleClick={() =>
                          handleAssignSound(pickerTarget, sound.id)
                        }
                      >
                        <span className="sb-result-name">{sound.name}</span>
                        <span className="sb-result-dots" aria-hidden="true">
                          {Array.from({ length: 6 }).map((_, d) => (
                            <span
                              key={d}
                              className={`sb-dot ${d < dotCount ? "lit" : ""}`}
                            />
                          ))}
                        </span>
                      </button>
                    );
                  })}
                  {filteredSounds.length === 0 && (
                    <div className="sb-empty">No sounds match filters</div>
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Action Footer */}
            <div className="sb-footer">
              <button
                type="button"
                className="sb-btn-cancel"
                onClick={() => setPickerTarget(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="sb-btn-confirm"
                disabled={!pickerSelectedId || loadingTarget !== null}
                onClick={() => {
                  if (pickerSelectedId) {
                    void handleAssignSound(pickerTarget, pickerSelectedId);
                  }
                }}
              >
                {loadingTarget
                  ? "Loading…"
                  : pickerTarget === "add"
                    ? "Add Sound"
                    : "Select Sound"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Voice Effects & Settings Modal (Sunday Keys 1:1) */}
      {editingLayer && editingLayerIdx !== null && (
        <div
          className="modal-backdrop"
          onClick={() => setEditingLayerIdx(null)}
        >
          <div
            className="modal-card sk-inspector"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Voice Effects"
          >
            {/* Top Header: Remove Sound | Colored Badge + Voice Name + Edit | Reset */}
            <div className="sk-insp-header">
              <button
                type="button"
                className="sk-insp-btn"
                disabled={layers.length <= 1}
                onClick={() => {
                  const target = editingLayerIdx;
                  setEditingLayerIdx(null);
                  void handleRemoveLayer(target);
                }}
              >
                <span aria-hidden="true">🗑</span>
                <span>Remove Sound</span>
              </button>

              <div className="sk-insp-title-wrap">
                <span
                  className="sb-module-dot"
                  style={{
                    background:
                      LAYER_COLORS[editingLayerIdx % LAYER_COLORS.length],
                  }}
                />
                <span className="sk-insp-title">{editingLayer.soundName}</span>
                <button
                  type="button"
                  className="sk-insp-edit-btn"
                  title="Change Sound"
                  onClick={() => {
                    const target = editingLayerIdx;
                    setEditingLayerIdx(null);
                    setPickerTarget(target);
                  }}
                >
                  ✎
                </button>
              </div>

              <button
                type="button"
                className="sk-insp-btn"
                onClick={() =>
                  handleUpdateLayer(editingLayerIdx, {
                    minNote: 21,
                    maxNote: 108,
                    octaveShift: 0,
                    params: DEFAULT_SOUND_PARAMS,
                  })
                }
              >
                <span aria-hidden="true">↺</span>
                <span>Reset Defaults</span>
              </button>
            </div>

            {/* Segmented Tab Bar */}
            <div className="sk-insp-tabs" role="tablist">
              {(
                [
                  ["adsr", "ADSR"],
                  ["modfilter", "Mod Filter"],
                  ["compressor", "FX A: Compressor"],
                  ["equalizer", "FX B: Equalizer"],
                  ["effects", "FX C: Effects & Tone"],
                  ["settings", "Settings"],
                ] as const
              ).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={inspectorTab === key}
                  className={`sk-insp-tab ${inspectorTab === key ? "active" : ""}`}
                  onClick={() => setInspectorTab(key)}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="sk-insp-body">
              {inspectorTab === "adsr" && (
                <div className="sk-adsr-view">
                  <div className="sk-graph-box">
                    {(() => {
                      const p = editingLayer.params;
                      const attX = 16 + Math.min(180, (p.attackMs / 1000) * 180);
                      const decX =
                        attX + Math.min(260, (p.decayMs / 10000) * 260);
                      const susY = 18 + (1 - p.sustainLevel) * 164;
                      const relStart = Math.max(decX + 90, 420);
                      const relX =
                        relStart +
                        Math.min(220, (p.releaseMs / 3000) * 220);
                      const d = `M 16 182 L ${attX} 18 L ${decX} ${susY} L ${relStart} ${susY} L ${relX} 182`;
                      const area = `${d} L 16 182 Z`;
                      return (
                        <svg viewBox="0 0 680 200" className="sk-graph-svg">
                          <path d={area} fill="rgba(165, 192, 245, 0.14)" />
                          <path
                            d={d}
                            fill="none"
                            stroke="#b8d0fa"
                            strokeWidth="2.4"
                            strokeLinejoin="round"
                          />
                          <circle cx={attX} cy={18} r="4.5" fill="#d9e7ff" />
                          <circle cx={decX} cy={susY} r="4.5" fill="#d9e7ff" />
                          <circle cx={relX} cy={182} r="4.5" fill="#d9e7ff" />
                        </svg>
                      );
                    })()}
                  </div>
                  <div className="sk-adsr-knobs">
                    <RotaryKnob
                      label="Attack"
                      value={editingLayer.params.attackMs}
                      min={0}
                      max={1000}
                      step={1}
                      displayValue={`${editingLayer.params.attackMs.toFixed(1)} ms`}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { attackMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { attackMs: DEFAULT_SOUND_PARAMS.attackMs },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Decay"
                      value={editingLayer.params.decayMs}
                      min={10}
                      max={10000}
                      step={10}
                      displayValue={`${Math.round(editingLayer.params.decayMs).toLocaleString()} ms`}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { decayMs: v },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { decayMs: DEFAULT_SOUND_PARAMS.decayMs },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Sustain"
                      value={Math.round(editingLayer.params.sustainLevel * 100)}
                      min={0}
                      max={100}
                      step={1}
                      displayValue={`${Math.round(editingLayer.params.sustainLevel * 100)} %`}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { sustainLevel: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: {
                            sustainLevel: DEFAULT_SOUND_PARAMS.sustainLevel,
                          },
                        })
                      }
                    />
                    <RotaryKnob
                      label="Release"
                      value={editingLayer.params.releaseMs}
                      min={20}
                      max={3000}
                      step={5}
                      displayValue={`${editingLayer.params.releaseMs.toFixed(1)} ms`}
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
                  </div>
                </div>
              )}

              {inspectorTab === "modfilter" && (
                <div className="sk-modfilter-view">
                  <div className="sk-graph-box">
                    {(() => {
                      const p = editingLayer.params;
                      const toX = (hz: number) =>
                        24 +
                        ((Math.log10(Math.max(20, hz)) - Math.log10(20)) /
                          (Math.log10(20000) - Math.log10(20))) *
                        620;
                      const minX = toX(p.modFilterMinHz);
                      const maxX = toX(p.modFilterMaxHz);
                      const resY = 82 - p.resonance * 48;
                      return (
                        <svg viewBox="0 0 680 200" className="sk-graph-svg">
                          <line x1="20" y1="50" x2="660" y2="50" stroke="rgba(255,255,255,0.06)" />
                          <line x1="20" y1="82" x2="660" y2="82" stroke="rgba(255,255,255,0.1)" />
                          <line x1="20" y1="168" x2="660" y2="168" stroke="rgba(255,255,255,0.08)" />
                          <path
                            d={`M 20 82 L ${Math.max(24, minX - 24)} 82 Q ${minX - 6} ${resY} ${minX} 168`}
                            fill="none"
                            stroke="#4f75e8"
                            strokeWidth="2.8"
                          />
                          <path
                            d={`M 20 82 L ${Math.max(24, maxX - 24)} 82 Q ${maxX - 6} ${resY} ${maxX} 168`}
                            fill="none"
                            stroke="#cbdcf9"
                            strokeWidth="2.8"
                          />
                        </svg>
                      );
                    })()}
                  </div>

                  <div className="sk-modfilter-controls">
                    <div className="sk-mod-range-box">
                      <div className="sk-mod-range-vals">
                        <span style={{ color: "#60a5fa" }}>
                          {Math.round(editingLayer.params.modFilterMinHz)} Hz
                        </span>
                        <span>
                          {Math.round(editingLayer.params.modFilterMaxHz)} Hz
                        </span>
                      </div>
                      <div className="sk-mod-sliders">
                        <span className="sk-muted-lbl">Min</span>
                        <input
                          type="range"
                          min={20}
                          max={20000}
                          step={10}
                          value={editingLayer.params.modFilterMinHz}
                          onChange={(e) =>
                            handleUpdateLayer(editingLayerIdx, {
                              paramsPatch: {
                                modFilterMinHz: Math.min(
                                  Number(e.target.value),
                                  editingLayer.params.modFilterMaxHz
                                ),
                              },
                            })
                          }
                        />
                        <input
                          type="range"
                          min={20}
                          max={20000}
                          step={10}
                          value={editingLayer.params.modFilterMaxHz}
                          onChange={(e) =>
                            handleUpdateLayer(editingLayerIdx, {
                              paramsPatch: {
                                modFilterMaxHz: Math.max(
                                  Number(e.target.value),
                                  editingLayer.params.modFilterMinHz
                                ),
                              },
                            })
                          }
                        />
                        <span className="sk-muted-lbl">Max</span>
                      </div>
                    </div>

                    <RotaryKnob
                      label="Resonance"
                      value={Math.round(editingLayer.params.resonance * 100)}
                      min={0}
                      max={85}
                      step={1}
                      displayValue={`${Math.round(editingLayer.params.resonance * 12)} dB`}
                      onChange={(v) =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { resonance: v / 100 },
                        })
                      }
                      onReset={() =>
                        handleUpdateLayer(editingLayerIdx, {
                          paramsPatch: { resonance: 0 },
                        })
                      }
                    />

                    <div className="sk-info-note">
                      <span className="sk-info-icon" aria-hidden="true">
                        i
                      </span>
                      <span>
                        Set up the min/max value and control the low pass filter
                        with the modulation wheel
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {inspectorTab === "compressor" && (
                <div className="sk-comp-grid">
                  <div className="sk-comp-col">
                    <div className="sk-comp-col-title">Input</div>
                    <div className="sk-comp-fader-wrap">
                      <span className="sk-muted-lbl">Gain</span>
                      <input
                        type="range"
                        className="v-fader"
                        style={
                          {
                            "--fill": `${((editingLayer.params.compInputDb + 12) / 24) * 100}%`,
                            "--fader-color": "#93b4f5",
                          } as React.CSSProperties
                        }
                        min={-12}
                        max={12}
                        step={0.5}
                        value={editingLayer.params.compInputDb}
                        onChange={(e) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compInputDb: Number(e.target.value) },
                          })
                        }
                      />
                      <span className="sk-knob-val">
                        {editingLayer.params.compInputDb} dB
                      </span>
                    </div>
                  </div>

                  <div className="sk-comp-col">
                    <div className="sk-comp-col-title">Envelope</div>
                    <div className="sk-comp-knobs">
                      <RotaryKnob
                        label="Attack"
                        value={editingLayer.params.compAttackMs}
                        min={1}
                        max={100}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.compAttackMs)} ms`}
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compAttackMs: v },
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compAttackMs: 15 },
                          })
                        }
                      />
                      <RotaryKnob
                        label="Release"
                        value={editingLayer.params.compReleaseMs}
                        min={10}
                        max={500}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.compReleaseMs)} ms`}
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compReleaseMs: v },
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compReleaseMs: 49 },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="sk-comp-col">
                    <div className="sk-comp-col-title">Loudness</div>
                    <div className="sk-comp-knobs">
                      <RotaryKnob
                        label="Ratio"
                        value={editingLayer.params.compRatio}
                        min={1}
                        max={20}
                        step={0.1}
                        displayValue={`${editingLayer.params.compRatio.toFixed(1)}:1`}
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compRatio: v },
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compRatio: 4.2 },
                          })
                        }
                      />
                      <RotaryKnob
                        label="Threshold"
                        value={editingLayer.params.compThresholdDb}
                        min={-60}
                        max={0}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.compThresholdDb)} dB`}
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compThresholdDb: v },
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { compThresholdDb: -29 },
                          })
                        }
                      />
                    </div>
                  </div>

                  <div className="sk-comp-col">
                    <div className="sk-comp-col-title">Mix</div>
                    <div className="sk-comp-fader-wrap">
                      <span className="sk-muted-lbl">Dry / Wet</span>
                      <input
                        type="range"
                        className="v-fader"
                        style={
                          {
                            "--fill": `${editingLayer.params.compMix * 100}%`,
                            "--fader-color": "#93b4f5",
                          } as React.CSSProperties
                        }
                        min={0}
                        max={100}
                        step={1}
                        value={Math.round(editingLayer.params.compMix * 100)}
                        onChange={(e) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: {
                              compMix: Number(e.target.value) / 100,
                            },
                          })
                        }
                      />
                      <span className="sk-knob-val">
                        {Math.round(editingLayer.params.compMix * 100)} %
                      </span>
                    </div>
                  </div>

                  <div className="sk-comp-col">
                    <div className="sk-comp-col-title">Output</div>
                    <div className="sk-comp-fader-wrap">
                      <span className="sk-muted-lbl">Gain</span>
                      <input
                        type="range"
                        className="v-fader"
                        style={
                          {
                            "--fill": `${((editingLayer.params.compOutputDb + 12) / 24) * 100}%`,
                            "--fader-color": "#93b4f5",
                          } as React.CSSProperties
                        }
                        min={-12}
                        max={12}
                        step={0.5}
                        value={editingLayer.params.compOutputDb}
                        onChange={(e) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: {
                              compOutputDb: Number(e.target.value),
                            },
                          })
                        }
                      />
                      <span className="sk-knob-val">
                        {editingLayer.params.compOutputDb} dB
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {inspectorTab === "equalizer" && (
                <div className="sk-eq-grid">
                  {[
                    { idx: 0, color: "#f472b6", icon: "⟋", gainIdx: null, qIdx: null },
                    { idx: 1, color: "#c084fc", icon: "⊐", gainIdx: 0, qIdx: null },
                    { idx: 2, color: "#818cf8", icon: "✦", gainIdx: 1, qIdx: 0 },
                    { idx: 3, color: "#38bdf8", icon: "✦", gainIdx: 2, qIdx: 1 },
                    { idx: 4, color: "#4ade80", icon: "✦", gainIdx: 3, qIdx: 2 },
                    { idx: 5, color: "#a3e635", icon: "✦", gainIdx: 4, qIdx: 3 },
                    { idx: 6, color: "#fb923c", icon: "⊏", gainIdx: 5, qIdx: null },
                    { idx: 7, color: "#f87171", icon: "⟍", gainIdx: null, qIdx: null },
                  ].map((band) => {
                    const freq = editingLayer.params.eqFreqs[band.idx] ?? 1000;
                    const gain =
                      band.gainIdx !== null
                        ? (editingLayer.params.eqGains[band.gainIdx] ?? 0)
                        : null;
                    const bw =
                      band.qIdx !== null
                        ? (editingLayer.params.eqQs[band.qIdx] ?? 0.5)
                        : null;
                    return (
                      <div key={band.idx} className="sk-eq-col">
                        <div
                          className="sk-eq-head"
                          style={{ color: band.color }}
                        >
                          {band.icon}
                        </div>
                        <div className="sk-eq-knobs">
                          <RotaryKnob
                            label="Frequency"
                            color={band.color}
                            size={44}
                            value={freq}
                            min={20}
                            max={20000}
                            step={10}
                            displayValue={`${Math.round(freq).toLocaleString()} Hz`}
                            onChange={(v) => {
                              const next = [...editingLayer.params.eqFreqs];
                              next[band.idx] = v;
                              handleUpdateLayer(editingLayerIdx, {
                                paramsPatch: { eqFreqs: next },
                              });
                            }}
                          />
                          {gain !== null && band.gainIdx !== null && (
                            <RotaryKnob
                              label="Gain"
                              color={band.color}
                              size={44}
                              value={gain}
                              min={-18}
                              max={18}
                              step={0.5}
                              displayValue={`${gain} dB`}
                              onChange={(v) => {
                                const next = [...editingLayer.params.eqGains];
                                next[band.gainIdx!] = v;
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { eqGains: next },
                                });
                              }}
                              onReset={() => {
                                const next = [...editingLayer.params.eqGains];
                                next[band.gainIdx!] = 0;
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { eqGains: next },
                                });
                              }}
                            />
                          )}
                          {bw !== null && band.qIdx !== null && (
                            <RotaryKnob
                              label="Bandwidth"
                              color={band.color}
                              size={44}
                              value={bw}
                              min={0.1}
                              max={2.0}
                              step={0.02}
                              displayValue={bw.toFixed(2)}
                              onChange={(v) => {
                                const next = [...editingLayer.params.eqQs];
                                next[band.qIdx!] = v;
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { eqQs: next },
                                });
                              }}
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {inspectorTab === "effects" && (
                <div className="sk-effects-grid">
                  {(editingParamsSet.has("hammer") ||
                    editingParamsSet.has("brightness") ||
                    editingParamsSet.has("veltrack") ||
                    editingParamsSet.has("offset") ||
                    editingParamsSet.has("glide")) && (
                      <div className="sk-comp-col">
                        <div className="sk-comp-col-title">Tone & Touch</div>
                        <div className="sk-fx-knobs-wrap">
                          {editingParamsSet.has("hammer") && (
                            <RotaryKnob
                              label="Hammer"
                              value={Math.round(
                                editingLayer.params.hammerHardness * 100
                              )}
                              min={0}
                              max={100}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.hammerHardness * 100)} %`}
                              onChange={(v) =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { hammerHardness: v / 100 },
                                })
                              }
                              onReset={() =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: {
                                    hammerHardness:
                                      DEFAULT_SOUND_PARAMS.hammerHardness,
                                  },
                                })
                              }
                            />
                          )}
                          {editingParamsSet.has("brightness") && (
                            <RotaryKnob
                              label="Tone"
                              value={Math.round(
                                editingLayer.params.brightness * 100
                              )}
                              min={0}
                              max={100}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.brightness * 100)} %`}
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
                          {editingParamsSet.has("veltrack") && (
                            <RotaryKnob
                              label="Veltrack"
                              value={Math.round(
                                editingLayer.params.velTrack * 100
                              )}
                              min={0}
                              max={100}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.velTrack * 100)} %`}
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
                          {editingParamsSet.has("offset") && (
                            <RotaryKnob
                              label="Offset"
                              value={Math.round(
                                editingLayer.params.sampleOffsetMs
                              )}
                              min={0}
                              max={40}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.sampleOffsetMs)} ms`}
                              onChange={(v) =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { sampleOffsetMs: v },
                                })
                              }
                              onReset={() =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: {
                                    sampleOffsetMs:
                                      DEFAULT_SOUND_PARAMS.sampleOffsetMs,
                                  },
                                })
                              }
                            />
                          )}
                          {editingParamsSet.has("glide") && (
                            <RotaryKnob
                              label="Glide"
                              value={Math.round(editingLayer.params.glideMs)}
                              min={0}
                              max={400}
                              step={5}
                              displayValue={`${Math.round(editingLayer.params.glideMs)} ms`}
                              onChange={(v) =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { glideMs: v },
                                })
                              }
                              onReset={() =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: {
                                    glideMs: DEFAULT_SOUND_PARAMS.glideMs,
                                  },
                                })
                              }
                            />
                          )}
                        </div>
                      </div>
                    )}

                  {(editingParamsSet.has("chorus") ||
                    editingParamsSet.has("tremolo")) && (
                      <div className="sk-comp-col">
                        <div className="sk-comp-col-title">Modulation</div>
                        <div className="sk-fx-knobs-wrap">
                          {editingParamsSet.has("chorus") && (
                            <RotaryKnob
                              label="Chorus"
                              value={Math.round(
                                editingLayer.params.chorusMix * 100
                              )}
                              min={0}
                              max={100}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.chorusMix * 100)} %`}
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
                            <RotaryKnob
                              label="Tremolo"
                              value={Math.round(
                                editingLayer.params.tremoloDepth * 100
                              )}
                              min={0}
                              max={100}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.tremoloDepth * 100)} %`}
                              onChange={(v) =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: { tremoloDepth: v / 100 },
                                })
                              }
                              onReset={() =>
                                handleUpdateLayer(editingLayerIdx, {
                                  paramsPatch: {
                                    tremoloDepth:
                                      DEFAULT_SOUND_PARAMS.tremoloDepth,
                                  },
                                })
                              }
                            />
                          )}
                        </div>
                      </div>
                    )}

                  {(editingParamsSet.has("delay") ||
                    editingParamsSet.has("reverb") ||
                    editingParamsSet.has("width")) && (
                      <div className="sk-comp-col">
                        <div className="sk-comp-col-title">Space & Stereo</div>
                        <div className="sk-fx-knobs-wrap">
                          {editingParamsSet.has("delay") && (
                            <RotaryKnob
                              label="Delay"
                              value={Math.round(
                                editingLayer.params.delayMix * 100
                              )}
                              min={0}
                              max={60}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.delayMix * 100)} %`}
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
                            <RotaryKnob
                              label="Reverb"
                              value={Math.round(
                                editingLayer.params.reverbMix * 100
                              )}
                              min={0}
                              max={70}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.reverbMix * 100)} %`}
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
                            <RotaryKnob
                              label="Width"
                              value={Math.round(
                                editingLayer.params.stereoWidth * 100
                              )}
                              min={0}
                              max={150}
                              step={1}
                              displayValue={`${Math.round(editingLayer.params.stereoWidth * 100)} %`}
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
                        </div>
                      </div>
                    )}
                </div>
              )}

              {inspectorTab === "settings" && (
                <div className="sk-settings-grid">
                  <div className="sk-settings-left">
                    <div className="sk-setting-card">
                      <div>
                        <div className="sk-setting-title">Block Sustain</div>
                        <div className="sk-setting-sub">
                          Make the Sound ignore the Sustain Pedal
                        </div>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={editingLayer.params.blockSustain}
                        className={`sk-switch ${editingLayer.params.blockSustain ? "on" : ""}`}
                        onClick={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: {
                              blockSustain: !editingLayer.params.blockSustain,
                            },
                          })
                        }
                      >
                        <span className="sk-switch-thumb" />
                      </button>
                    </div>

                    <div className="sk-setting-card">
                      <div>
                        <div className="sk-setting-title">
                          MIDI Input Octave
                        </div>
                        <div className="sk-setting-sub">
                          Shift MIDI notes up or down in octaves
                        </div>
                      </div>
                      <div className="sk-stepper">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateLayer(editingLayerIdx, {
                              octaveShift: Math.max(
                                -3,
                                editingLayer.octaveShift - 1
                              ),
                            })
                          }
                        >
                          −
                        </button>
                        <span>{editingLayer.octaveShift}</span>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateLayer(editingLayerIdx, {
                              octaveShift: Math.min(
                                3,
                                editingLayer.octaveShift + 1
                              ),
                            })
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="sk-setting-card">
                      <div>
                        <div className="sk-setting-title">Voice Mode</div>
                        <div className="sk-setting-sub">
                          Polyphonic, Monophonic, or Legato triggering
                        </div>
                      </div>
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
                    </div>

                    <div className="sk-setting-card">
                      <div>
                        <div className="sk-setting-title">Key Range</div>
                        <div className="sk-setting-sub">
                          {midiNoteLabel(editingLayer.minNote)} –{" "}
                          {midiNoteLabel(editingLayer.maxNote)}
                        </div>
                      </div>
                      <div className="sk-range-pair">
                        <input
                          type="range"
                          min={21}
                          max={editingLayer.maxNote}
                          value={editingLayer.minNote}
                          onChange={(e) =>
                            handleUpdateLayer(editingLayerIdx, {
                              minNote: Number(e.target.value),
                            })
                          }
                        />
                        <input
                          type="range"
                          min={editingLayer.minNote}
                          max={108}
                          value={editingLayer.maxNote}
                          onChange={(e) =>
                            handleUpdateLayer(editingLayerIdx, {
                              maxNote: Number(e.target.value),
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="sk-settings-right">
                    <div className="sk-setting-side-card">
                      <div className="sk-setting-title">Sampler Vol</div>
                      <RotaryKnob
                        label=""
                        value={Math.round(editingLayer.volume * 100)}
                        min={0}
                        max={125}
                        step={1}
                        displayValue={formatDb(editingLayer.volume)}
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            volume: v / 100,
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, { volume: 0.85 })
                        }
                      />
                    </div>

                    <div className="sk-setting-side-card">
                      <div className="sk-setting-title">Audio Output</div>
                      <RotaryKnob
                        label="Pan"
                        value={Math.round(editingLayer.params.pan * 100)}
                        min={-100}
                        max={100}
                        step={1}
                        displayValue={
                          Math.abs(editingLayer.params.pan) < 0.02
                            ? "0"
                            : editingLayer.params.pan < 0
                              ? `L${Math.round(-editingLayer.params.pan * 50)}`
                              : `R${Math.round(editingLayer.params.pan * 50)}`
                        }
                        onChange={(v) =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { pan: v / 100 },
                          })
                        }
                        onReset={() =>
                          handleUpdateLayer(editingLayerIdx, {
                            paramsPatch: { pan: 0 },
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Bottom Footer */}
            <div className="sk-insp-footer">
              <div className="sk-insp-footer-left">
                {(inspectorTab === "compressor" ||
                  inspectorTab === "equalizer") && (
                    <button
                      type="button"
                      className={`sk-fx-pwr-btn ${(inspectorTab === "compressor" ? editingLayer.params.compEnabled : editingLayer.params.eqEnabled) ? "on" : ""}`}
                      onClick={() =>
                        handleUpdateLayer(
                          editingLayerIdx,
                          inspectorTab === "compressor"
                            ? {
                              paramsPatch: {
                                compEnabled: !editingLayer.params.compEnabled,
                              },
                            }
                            : {
                              paramsPatch: {
                                eqEnabled: !editingLayer.params.eqEnabled,
                              },
                            }
                        )
                      }
                    >
                      <span className="sk-fx-pwr-icon">⏻</span>
                      <span>
                        {(
                          inspectorTab === "compressor"
                            ? editingLayer.params.compEnabled
                            : editingLayer.params.eqEnabled
                        )
                          ? "Effect ON"
                          : "Effect OFF"}
                      </span>
                    </button>
                  )}
              </div>
              <div className="sk-insp-footer-right">
                <button
                  type="button"
                  className="sb-btn-cancel"
                  onClick={discardInspectorChanges}
                >
                  Discard Changes
                </button>
                <button
                  type="button"
                  className="sb-btn-confirm"
                  onClick={() => {
                    inspectorSnapshotRef.current = null;
                    setEditingLayerIdx(null);
                  }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
