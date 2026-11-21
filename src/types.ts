export interface AudioDeviceDto {
  name: string;
  isDefault: boolean;
  defaultSampleRate: number;
  channels: number;
  supportedBufferSizes: number[];
}

export interface SoundDto {
  id: string;
  name: string;
  category: string;
  supportedParams: string[];
}

export interface SoundParamsDto {
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

export interface LayerDto {
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

export interface StatusDto {
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
  pitchBend?: number;
  modWheel?: number;
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

export interface InitialStateDto {
  midiDevices: string[];
  audioDevices: AudioDeviceDto[];
  sounds: SoundDto[];
  status: StatusDto;
}

export interface TelemetryDto {
  isPlaying: boolean;
  activeVoices: number;
  estimatedLatencyMs: number;
  midiDevices: string[];
  desiredMidiDevices: string[];
  activeMidiNotes: number[];
  sustainActive: boolean;
  pitchBend: number;
  modWheel: number;
  backingTrackPlaying: boolean;
  backingTrackPositionMs: number;
  backingTrackDurationMs: number;
}

export interface SnapshotLayerState {
  enabled: boolean;
  volume: number;
  minNote: number;
  maxNote: number;
  octaveShift: number;
  params: SoundParamsDto;
}

export interface PatchSnapshot {
  id: string;
  name: string;
  layers: SnapshotLayerState[];
  worshipPadEnabled: boolean;
  worshipPadKey: number;
}

export interface Patch {
  id: string;
  name: string;
  layerSoundIds: string[];
  snapshots: PatchSnapshot[];
}

export interface MidiDeviceGroup {
  deviceName: string;
  ports: { name: string; isSecondary: boolean }[];
}

export const DEFAULT_SOUND_PARAMS: SoundParamsDto = {
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

export const WORSHIP_PAD_VOICES = [
  { value: "0", label: "1. Warm" },
  { value: "1", label: "2. Shimmer" },
  { value: "2", label: "3. Organ" },
  { value: "3", label: "4. Deep Sub" },
  { value: "4", label: "5. Airy Choir" },
  { value: "5", label: "6. Bright Analog" },
];

export const WORSHIP_KEYS = [
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

export const OCTAVE_C_NOTES = [24, 36, 48, 60, 72, 84, 96, 108];
export const LAYER_COLORS = [
  "#f59e0b", // 1: Amber
  "#22c55e", // 2: Green
  "#3b82f6", // 3: Blue
  "#a855f7", // 4: Purple
  "#ec4899", // 5: Pink
  "#06b6d4", // 6: Cyan
  "#ef4444", // 7: Coral Red
  "#84cc16", // 8: Lime
  "#6366f1", // 9: Indigo
  "#14b8a6", // 10: Teal
  "#f97316", // 11: Tangerine
  "#eab308", // 12: Gold
];
export const DEFAULT_BUFFERS = [64, 128, 256, 512, 1024];

