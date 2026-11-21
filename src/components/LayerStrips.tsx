import {
  LAYER_COLORS,
  LayerDto,
  MidiMapping,
  MidiTargetKind,
  Patch,
  SoundParamsDto,
} from "../types";
import { formatDb, midiNoteLabel } from "../utils/music";
import { PowerSvg, SlidersSvg } from "./ui";

export function LayerStrips({
  layers,
  editingLayerIdx,
  activePatch,
  activeSnapshotIdx,
  onOpenSoundPicker,
  onOpenLayerInspector,
  onRemoveLayer,
  onUpdateLayer,
  onSelectSnapshot,
  onDeleteSnapshot,
  onAddSnapshot,
  onSaveCurrentSnapshot,
  midiLearnMode,
  armedTarget,
  midiMappings,
  onArmMidiTarget,
  onClearMidiMapping,
}: {
  layers: LayerDto[];
  editingLayerIdx: number | null;
  activePatch: Patch | undefined;
  activeSnapshotIdx: number;
  onOpenSoundPicker: (target: number | "add") => void;
  onOpenLayerInspector: (idx: number) => void;
  onRemoveLayer: (idx: number) => void;
  onUpdateLayer: (
    idx: number,
    patch: Partial<LayerDto> & { paramsPatch?: Partial<SoundParamsDto> }
  ) => void;
  onSelectSnapshot: (idx: number) => void;
  onDeleteSnapshot: (idx: number) => void;
  onAddSnapshot: () => void;
  onSaveCurrentSnapshot: () => void;
  midiLearnMode: boolean;
  armedTarget: MidiTargetKind | null;
  midiMappings: MidiMapping[];
  onArmMidiTarget: (target: MidiTargetKind) => void;
  onClearMidiMapping: (target: MidiTargetKind) => void;
}) {
  const getMapping = (target: MidiTargetKind) =>
    midiMappings.find((m) => m.target === target);
  return (
    <section className="layers-stage" aria-label="Sound Layers">
      <div className="layers-row">
        {layers.map((layer, idx) => {
          const color = LAYER_COLORS[idx % LAYER_COLORS.length];
          const layerVolPct = Math.round(layer.volume * 100);
          const faderPct = Math.max(
            0,
            Math.min(100, (layer.volume / 1.25) * 100)
          );
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
            onUpdateLayer(idx, { volume: nextVol });
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
                  onClick={() => onOpenSoundPicker(idx)}
                  title={`${layer.soundName} (${layer.category} · ${midiNoteLabel(layer.minNote)}–${midiNoteLabel(layer.maxNote)}) — Click to change sound`}
                >
                  <span className="layer-name">{layer.soundName}</span>
                </button>

                <div className="layer-head-actions">
                  <button
                    type="button"
                    className={`sk-tune-btn ${editingLayerIdx === idx ? "active" : ""}`}
                    onClick={() => onOpenLayerInspector(idx)}
                    title="Layer Controls (Tone, Envelope, Key Range)"
                  >
                    <SlidersSvg />
                  </button>
                  {idx > 0 && (
                    <button
                      type="button"
                      className="sk-remove-btn"
                      onClick={() => onRemoveLayer(idx)}
                      title="Remove Layer"
                    >
                      ×
                    </button>
                  )}
                </div>
              </div>

              <div className="layer-slots">
                <div
                  className={`sk-slot sk-slot-midi ${midiActive ? "lit" : "empty-val"}`}
                >
                  <button
                    type="button"
                    className="sk-slot-pwr"
                    aria-label="Toggle Octave Shift"
                    onClick={() =>
                      onUpdateLayer(idx, { octaveShift: midiActive ? 0 : 1 })
                    }
                  >
                    <PowerSvg />
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
                      onUpdateLayer(idx, { octaveShift: nextOct });
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
                  className={`sk-slot ${audio01Lit ? "lit" : ""} ${!hasAudio01 ? "disabled" : ""} ${midiLearnMode && hasAudio01 ? "midi-learnable" : ""} ${midiLearnMode && armedTarget === `layer:${idx}:chorus` ? "midi-armed" : ""}`}
                  onClickCapture={
                    midiLearnMode && hasAudio01
                      ? (e) => {
                          if ((e.target as HTMLElement).closest(".midi-cc-pill"))
                            return;
                          e.preventDefault();
                          e.stopPropagation();
                          onArmMidiTarget(`layer:${idx}:chorus`);
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="sk-slot-pwr"
                    disabled={!hasAudio01}
                    aria-label="Toggle Chorus"
                    onClick={() =>
                      onUpdateLayer(idx, {
                        paramsPatch: { chorusMix: audio01Lit ? 0.0 : 0.45 },
                      })
                    }
                  >
                    <PowerSvg />
                  </button>
                  <button
                    type="button"
                    className="sk-slot-body"
                    disabled={!hasAudio01}
                    onClick={() =>
                      onUpdateLayer(idx, {
                        paramsPatch: { chorusMix: audio01Lit ? 0.0 : 0.45 },
                      })
                    }
                  >
                    <span className="sk-slot-sub">Audio 01</span>
                    <span className="sk-slot-val">
                      {hasAudio01 ? "Chorus" : "Effect"}
                    </span>
                  </button>
                  {midiLearnMode && getMapping(`layer:${idx}:chorus`) && (
                    <button
                      type="button"
                      className="midi-cc-pill slot"
                      title="Click to unbind MIDI CC"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearMidiMapping(`layer:${idx}:chorus`);
                      }}
                    >
                      CC{getMapping(`layer:${idx}:chorus`)!.cc} ×
                    </button>
                  )}
                </div>

                <div
                  className={`sk-slot ${audio02Lit ? "lit" : ""} ${!audio02Kind ? "disabled" : ""} ${midiLearnMode && audio02Kind ? "midi-learnable" : ""} ${midiLearnMode && armedTarget === `layer:${idx}:audio02` ? "midi-armed" : ""}`}
                  onClickCapture={
                    midiLearnMode && audio02Kind
                      ? (e) => {
                          if ((e.target as HTMLElement).closest(".midi-cc-pill"))
                            return;
                          e.preventDefault();
                          e.stopPropagation();
                          onArmMidiTarget(`layer:${idx}:audio02`);
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="sk-slot-pwr"
                    disabled={!audio02Kind}
                    aria-label={`Toggle ${audio02Kind === "tremolo" ? "Tremolo" : "Delay"}`}
                    onClick={() => {
                      if (audio02Kind === "tremolo") {
                        onUpdateLayer(idx, {
                          paramsPatch: {
                            tremoloDepth: audio02Lit ? 0.0 : 0.45,
                          },
                        });
                      } else if (audio02Kind === "delay") {
                        onUpdateLayer(idx, {
                          paramsPatch: { delayMix: audio02Lit ? 0.0 : 0.28 },
                        });
                      }
                    }}
                  >
                    <PowerSvg />
                  </button>
                  <button
                    type="button"
                    className="sk-slot-body"
                    disabled={!audio02Kind}
                    onClick={() => {
                      if (audio02Kind === "tremolo") {
                        onUpdateLayer(idx, {
                          paramsPatch: {
                            tremoloDepth: audio02Lit ? 0.0 : 0.45,
                          },
                        });
                      } else if (audio02Kind === "delay") {
                        onUpdateLayer(idx, {
                          paramsPatch: { delayMix: audio02Lit ? 0.0 : 0.28 },
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
                  {midiLearnMode && getMapping(`layer:${idx}:audio02`) && (
                    <button
                      type="button"
                      className="midi-cc-pill slot"
                      title="Click to unbind MIDI CC"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearMidiMapping(`layer:${idx}:audio02`);
                      }}
                    >
                      CC{getMapping(`layer:${idx}:audio02`)!.cc} ×
                    </button>
                  )}
                </div>

                <div
                  className={`sk-slot ${audio03Lit ? "lit" : ""} ${!hasAudio03 ? "disabled" : ""} ${midiLearnMode && hasAudio03 ? "midi-learnable" : ""} ${midiLearnMode && armedTarget === `layer:${idx}:reverb` ? "midi-armed" : ""}`}
                  onClickCapture={
                    midiLearnMode && hasAudio03
                      ? (e) => {
                          if ((e.target as HTMLElement).closest(".midi-cc-pill"))
                            return;
                          e.preventDefault();
                          e.stopPropagation();
                          onArmMidiTarget(`layer:${idx}:reverb`);
                        }
                      : undefined
                  }
                >
                  <button
                    type="button"
                    className="sk-slot-pwr"
                    disabled={!hasAudio03}
                    aria-label="Toggle Reverb"
                    onClick={() =>
                      onUpdateLayer(idx, {
                        paramsPatch: { reverbMix: audio03Lit ? 0.0 : 0.3 },
                      })
                    }
                  >
                    <PowerSvg />
                  </button>
                  <button
                    type="button"
                    className="sk-slot-body"
                    disabled={!hasAudio03}
                    onClick={() =>
                      onUpdateLayer(idx, {
                        paramsPatch: { reverbMix: audio03Lit ? 0.0 : 0.3 },
                      })
                    }
                  >
                    <span className="sk-slot-sub">Audio 03</span>
                    <span className="sk-slot-val">
                      {hasAudio03 ? "Reverb" : "Effect"}
                    </span>
                  </button>
                  {midiLearnMode && getMapping(`layer:${idx}:reverb`) && (
                    <button
                      type="button"
                      className="midi-cc-pill slot"
                      title="Click to unbind MIDI CC"
                      onClick={(e) => {
                        e.stopPropagation();
                        onClearMidiMapping(`layer:${idx}:reverb`);
                      }}
                    >
                      CC{getMapping(`layer:${idx}:reverb`)!.cc} ×
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`layer-fader-area ${midiLearnMode ? "midi-learnable" : ""} ${midiLearnMode && armedTarget === `layer:${idx}:volume` ? "midi-armed" : ""}`}
                onPointerDownCapture={
                  midiLearnMode
                    ? (e) => {
                        if ((e.target as HTMLElement).closest(".midi-cc-pill"))
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                        onArmMidiTarget(`layer:${idx}:volume`);
                      }
                    : undefined
                }
                onClickCapture={
                  midiLearnMode
                    ? (e) => {
                        if ((e.target as HTMLElement).closest(".midi-cc-pill"))
                          return;
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    : undefined
                }
              >
                {midiLearnMode && getMapping(`layer:${idx}:volume`) && (
                  <button
                    type="button"
                    className="midi-cc-pill floating"
                    title="Click to unbind MIDI CC"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearMidiMapping(`layer:${idx}:volume`);
                    }}
                  >
                    CC{getMapping(`layer:${idx}:volume`)!.cc} ×
                  </button>
                )}
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
                      onUpdateLayer(idx, { volume: 0.85 });
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
                  onDoubleClick={() => onUpdateLayer(idx, { volume: 0.85 })}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowUp" || e.key === "ArrowRight") {
                      e.preventDefault();
                      onUpdateLayer(idx, {
                        volume: Math.min(1.25, layer.volume + 0.03),
                      });
                    } else if (
                      e.key === "ArrowDown" ||
                      e.key === "ArrowLeft"
                    ) {
                      e.preventDefault();
                      onUpdateLayer(idx, {
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

        {Array.from({ length: Math.max(1, 5 - layers.length) }).map(
          (_, slotOffset) => {
            const slotIdx = layers.length + slotOffset;
            const slotColor = LAYER_COLORS[slotIdx % LAYER_COLORS.length];
            return (
              <button
                key={`add-slot-${slotIdx}`}
                type="button"
                className="add-layer-slot"
                style={{ "--slot-color": slotColor } as React.CSSProperties}
                onClick={() => onOpenSoundPicker("add")}
              >
                <div className="add-ghost-strip" aria-hidden="true">
                  <div className="add-ghost-head">
                    <span className="add-ghost-icon">
                      <SlidersSvg />
                    </span>
                  </div>
                  <div className="add-ghost-slots">
                    {["Midi", "Audio 01", "Audio 02", "Audio 03"].map(
                      (slotLabel) => (
                        <div key={slotLabel} className="add-ghost-slot">
                          <span className="add-ghost-pwr">
                            <PowerSvg />
                          </span>
                          <div className="add-ghost-txt">
                            <span className="add-ghost-sub">{slotLabel}</span>
                            <span className="add-ghost-val">Effect</span>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                  <div className="add-ghost-fader" />
                </div>
                <div className="add-overlay">
                  <span className="add-plus">+</span>
                  <span>Add Sound</span>
                </div>
              </button>
            );
          }
        )}
      </div>

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
                    onClick={() => onSelectSnapshot(idx)}
                  >
                    <span className="snap-name">{snap.name}</span>
                  </button>
                  {activePatch.snapshots.length > 1 && (
                    <button
                      type="button"
                      className="snap-del"
                      onClick={() => onDeleteSnapshot(idx)}
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
              className="snap-action-btn snap-icon-btn"
              onClick={onAddSnapshot}
              aria-label="Add Snapshot"
              title="Add new Snapshot from current state"
            >
              <svg
                viewBox="0 0 24 24"
                width="15"
                height="15"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <button
              type="button"
              className="snap-action-btn snap-icon-btn snap-save-btn"
              onClick={onSaveCurrentSnapshot}
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
  );
}

