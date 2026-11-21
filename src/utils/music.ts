import {
  DEFAULT_SOUND_PARAMS,
  MidiDeviceGroup,
  Patch,
  SnapshotLayerState,
  SoundDto,
  SoundParamsDto,
} from "../types";

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

export function midiNoteLabel(note: number): string {
  const oct = Math.floor(note / 12) - 1;
  return `${NOTE_NAMES[note % 12]}${oct}`;
}

export function formatTimeMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, "0")}`;
}

export function formatDb(vol: number): string {
  if (vol <= 0.002) return "-∞";
  const db = 20 * Math.log10(vol / 0.85);
  if (Math.abs(db) < 0.05) return "0 dB";
  return `${db.toFixed(2)} dB`;
}

export const QWERTY_KEYS = [
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

export const CODE_TO_SEMITONE = new Map<string, number>(
  QWERTY_KEYS.map((k) => [k.code, k.semitone])
);
export const SEMITONE_TO_LABEL = new Map<number, string>(
  QWERTY_KEYS.map((k) => [k.semitone, k.label])
);

export interface FullPianoKey {
  note: number;
  isBlack: boolean;
  whiteIndex: number;
  cLabel?: string;
}

const BLACK_PCS = new Set([1, 3, 6, 8, 10]);
export const FULL_PIANO_KEYS: FullPianoKey[] = [];
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

export const WHITE_KEYS = FULL_PIANO_KEYS.filter((k) => !k.isBlack);
export const BLACK_KEYS = FULL_PIANO_KEYS.filter((k) => k.isBlack);

export function noteBoundsPct(note: number): { left: number; right: number } {
  const clamped = Math.max(21, Math.min(108, note));
  const k = FULL_PIANO_KEYS[clamped - 21];
  if (!k) return { left: 0, right: 100 };
  if (!k.isBlack) {
    const left = (k.whiteIndex / WHITE_KEYS.length) * 100;
    const right = ((k.whiteIndex + 1) / WHITE_KEYS.length) * 100;
    return { left, right };
  }
  const left = ((k.whiteIndex + 0.65) / WHITE_KEYS.length) * 100;
  return { left, right: left + 1.32 };
}

export function noteSpanPct(
  minNote: number,
  maxNote: number
): { leftPct: number; widthPct: number } {
  const lo = noteBoundsPct(Math.min(minNote, maxNote));
  const hi = noteBoundsPct(Math.max(minNote, maxNote));
  return {
    leftPct: lo.left,
    widthPct: Math.max(1.2, hi.right - lo.left),
  };
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function interpolateSoundParams(
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

export const TYPE_FACETS = [
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

export function soundMatchesFacet(sound: SoundDto, facet: string): boolean {
  const f = facet.toLowerCase();
  return (
    sound.name.toLowerCase().includes(f) ||
    sound.category.toLowerCase().includes(f) ||
    sound.supportedParams.some((p) => p.toLowerCase().includes(f))
  );
}

export function getSoundLibrary(sound: SoundDto): string {
  if (
    sound.id.startsWith("sk-") ||
    sound.name.toLowerCase().includes("sunday") ||
    sound.name.startsWith("SK ")
  ) {
    return "Sunday Keys";
  }
  return "Takt Library";
}

const SECONDARY_PORT_RE =
  /\b(mackie|hui|daw|editor|ctrl|control|din|thru|remote|sysex)\b/i;

function getMidiDeviceBaseName(portName: string): string {
  const stripped = portName
    .replace(
      /\s+(?:midi|daw|din|editor|mackie|hui|ctrl|control|thru|remote|port\s*[a-z0-9]+|out|in)\b.*$/i,
      ""
    )
    .trim();
  return stripped || portName;
}

export function groupMidiDevices(ports: string[]): MidiDeviceGroup[] {
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

export function makeDefaultPatches(): Patch[] {
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
      layerSoundIds: ["model-d"],
      snapshots: [
        {
          id: "snap-verse",
          name: "Verse (Piano)",
          layers: [
            baseLayer(true, 0.85, 0, { brightness: 0.85, reverbMix: 0.2 }),
          ],
          worshipPadEnabled: false,
          worshipPadKey: 0,
        },
        {
          id: "snap-chorus",
          name: "Chorus (Full)",
          layers: [
            baseLayer(true, 0.95, 0, {
              brightness: 1.0,
              reverbMix: 0.35,
              chorusMix: 0.25,
            }),
          ],
          worshipPadEnabled: true,
          worshipPadKey: 0,
        },
        {
          id: "snap-bridge",
          name: "Bridge (Big)",
          layers: [
            baseLayer(true, 1.05, 0, {
              brightness: 1.0,
              reverbMix: 0.45,
              delayMix: 0.25,
            }),
          ],
          worshipPadEnabled: true,
          worshipPadKey: 0,
        },
      ],
    },
    {
      id: "patch-rhodes",
      name: "Rhodes & Pad",
      layerSoundIds: ["stage-73", "pad"],
      snapshots: [
        {
          id: "snap-rhodes-1",
          name: "Warm Rhodes",
          layers: [
            baseLayer(true, 0.9, 0, { tremoloDepth: 0.35, chorusMix: 0.2 }),
            baseLayer(true, 0.55, 0, { brightness: 0.65, reverbMix: 0.35 }),
          ],
          worshipPadEnabled: false,
          worshipPadKey: 2,
        },
      ],
    },
    {
      id: "patch-piano",
      name: "Acoustic Grand",
      layerSoundIds: ["model-d"],
      snapshots: [
        {
          id: "snap-grand-1",
          name: "Default",
          layers: [baseLayer(true, 0.9, 0)],
          worshipPadEnabled: false,
          worshipPadKey: 0,
        },
      ],
    },
  ];
}

