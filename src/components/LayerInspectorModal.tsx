import { useState } from "react";
import {
  DEFAULT_SOUND_PARAMS,
  LAYER_COLORS,
  LayerDto,
  SoundParamsDto,
} from "../types";
import { formatDb, midiNoteLabel } from "../utils/music";
import { RotaryKnob } from "./ui";

export type InspectorTab =
  | "adsr"
  | "modfilter"
  | "compressor"
  | "equalizer"
  | "effects"
  | "settings";

export function LayerInspectorModal({
  editingLayer,
  editingLayerIdx,
  layerCount,
  onClose,
  onDiscard,
  onConfirm,
  onRemoveLayer,
  onOpenSoundPicker,
  onUpdateLayer,
}: {
  editingLayer: LayerDto;
  editingLayerIdx: number;
  layerCount: number;
  onClose: () => void;
  onDiscard: () => void;
  onConfirm: () => void;
  onRemoveLayer: (idx: number) => void;
  onOpenSoundPicker: (idx: number) => void;
  onUpdateLayer: (
    idx: number,
    patch: Partial<LayerDto> & { paramsPatch?: Partial<SoundParamsDto> }
  ) => void;
}) {
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("compressor");
  const editingParamsSet = new Set(editingLayer.supportedParams);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card sk-inspector"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Voice Effects"
      >
        <div className="sk-insp-header">
          <button
            type="button"
            className="sk-insp-btn"
            disabled={layerCount <= 1}
            onClick={() => {
              onClose();
              onRemoveLayer(editingLayerIdx);
            }}
          >
            <span aria-hidden="true">🗑</span>
            <span>Remove Sound</span>
          </button>

          <div className="sk-insp-title-wrap">
            <span
              className="sb-module-dot"
              style={{
                background: LAYER_COLORS[editingLayerIdx % LAYER_COLORS.length],
              }}
            />
            <span className="sk-insp-title">{editingLayer.soundName}</span>
            <button
              type="button"
              className="sk-insp-edit-btn"
              title="Change Sound"
              onClick={() => {
                onClose();
                onOpenSoundPicker(editingLayerIdx);
              }}
            >
              ✎
            </button>
          </div>

          <button
            type="button"
            className="sk-insp-btn"
            onClick={() =>
              onUpdateLayer(editingLayerIdx, {
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

        <div className="sk-insp-body">
          {inspectorTab === "adsr" && (
            <div className="sk-adsr-view">
              <div className="sk-graph-box">
                {(() => {
                  const p = editingLayer.params;
                  const attX = 16 + Math.min(180, (p.attackMs / 1000) * 180);
                  const decX = attX + Math.min(260, (p.decayMs / 10000) * 260);
                  const susY = 18 + (1 - p.sustainLevel) * 164;
                  const relStart = Math.max(decX + 90, 420);
                  const relX =
                    relStart + Math.min(220, (p.releaseMs / 3000) * 220);
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
                    onUpdateLayer(editingLayerIdx, {
                      paramsPatch: { attackMs: v },
                    })
                  }
                  onReset={() =>
                    onUpdateLayer(editingLayerIdx, {
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
                    onUpdateLayer(editingLayerIdx, {
                      paramsPatch: { decayMs: v },
                    })
                  }
                  onReset={() =>
                    onUpdateLayer(editingLayerIdx, {
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
                    onUpdateLayer(editingLayerIdx, {
                      paramsPatch: { sustainLevel: v / 100 },
                    })
                  }
                  onReset={() =>
                    onUpdateLayer(editingLayerIdx, {
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
                    onUpdateLayer(editingLayerIdx, {
                      paramsPatch: { releaseMs: v },
                    })
                  }
                  onReset={() =>
                    onUpdateLayer(editingLayerIdx, {
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
                      <line
                        x1="20"
                        y1="50"
                        x2="660"
                        y2="50"
                        stroke="rgba(255,255,255,0.06)"
                      />
                      <line
                        x1="20"
                        y1="82"
                        x2="660"
                        y2="82"
                        stroke="rgba(255,255,255,0.1)"
                      />
                      <line
                        x1="20"
                        y1="168"
                        x2="660"
                        y2="168"
                        stroke="rgba(255,255,255,0.08)"
                      />
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
                        onUpdateLayer(editingLayerIdx, {
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
                        onUpdateLayer(editingLayerIdx, {
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
                    onUpdateLayer(editingLayerIdx, {
                      paramsPatch: { resonance: v / 100 },
                    })
                  }
                  onReset={() =>
                    onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compAttackMs: v },
                      })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compReleaseMs: v },
                      })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compRatio: v },
                      })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compThresholdDb: v },
                      })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compMix: Number(e.target.value) / 100 },
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { compOutputDb: Number(e.target.value) },
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
                    <div className="sk-eq-head" style={{ color: band.color }}>
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
                          onUpdateLayer(editingLayerIdx, {
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
                            onUpdateLayer(editingLayerIdx, {
                              paramsPatch: { eqGains: next },
                            });
                          }}
                          onReset={() => {
                            const next = [...editingLayer.params.eqGains];
                            next[band.gainIdx!] = 0;
                            onUpdateLayer(editingLayerIdx, {
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
                            onUpdateLayer(editingLayerIdx, {
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
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { hammerHardness: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                        value={Math.round(editingLayer.params.brightness * 100)}
                        min={0}
                        max={100}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.brightness * 100)} %`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { brightness: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                        value={Math.round(editingLayer.params.velTrack * 100)}
                        min={0}
                        max={100}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.velTrack * 100)} %`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { velTrack: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                        value={Math.round(editingLayer.params.sampleOffsetMs)}
                        min={0}
                        max={40}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.sampleOffsetMs)} ms`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { sampleOffsetMs: v },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { glideMs: v },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { glideMs: DEFAULT_SOUND_PARAMS.glideMs },
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
                        value={Math.round(editingLayer.params.chorusMix * 100)}
                        min={0}
                        max={100}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.chorusMix * 100)} %`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { chorusMix: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { tremoloDepth: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: {
                              tremoloDepth: DEFAULT_SOUND_PARAMS.tremoloDepth,
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
                        value={Math.round(editingLayer.params.delayMix * 100)}
                        min={0}
                        max={60}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.delayMix * 100)} %`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { delayMix: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                        value={Math.round(editingLayer.params.reverbMix * 100)}
                        min={0}
                        max={70}
                        step={1}
                        displayValue={`${Math.round(editingLayer.params.reverbMix * 100)} %`}
                        onChange={(v) =>
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { reverbMix: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                          onUpdateLayer(editingLayerIdx, {
                            paramsPatch: { stereoWidth: v / 100 },
                          })
                        }
                        onReset={() =>
                          onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, {
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
                    <div className="sk-setting-title">MIDI Input Octave</div>
                    <div className="sk-setting-sub">
                      Shift MIDI notes up or down in octaves
                    </div>
                  </div>
                  <div className="sk-stepper">
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateLayer(editingLayerIdx, {
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
                        onUpdateLayer(editingLayerIdx, {
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
                          onUpdateLayer(editingLayerIdx, {
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
                        onUpdateLayer(editingLayerIdx, {
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
                        onUpdateLayer(editingLayerIdx, {
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
                      onUpdateLayer(editingLayerIdx, { volume: v / 100 })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, { volume: 0.85 })
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
                      onUpdateLayer(editingLayerIdx, {
                        paramsPatch: { pan: v / 100 },
                      })
                    }
                    onReset={() =>
                      onUpdateLayer(editingLayerIdx, { paramsPatch: { pan: 0 } })
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="sk-insp-footer">
          <div className="sk-insp-footer-left">
            {(inspectorTab === "compressor" ||
              inspectorTab === "equalizer") && (
              <button
                type="button"
                className={`sk-fx-pwr-btn ${(inspectorTab === "compressor" ? editingLayer.params.compEnabled : editingLayer.params.eqEnabled) ? "on" : ""}`}
                onClick={() =>
                  onUpdateLayer(
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
              onClick={onDiscard}
            >
              Discard Changes
            </button>
            <button
              type="button"
              className="sb-btn-confirm"
              onClick={onConfirm}
            >
              Confirm
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

