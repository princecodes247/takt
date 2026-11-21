import {
  LAYER_COLORS,
  LayerDto,
  OCTAVE_C_NOTES,
  SoundParamsDto,
} from "../types";
import { midiNoteLabel } from "../utils/music";
import { SlidersSvg } from "./ui";

export interface ZoneDragState {
  layerIdx: number;
  mode: "min" | "max" | "move";
  startX: number;
  origMin: number;
  origMax: number;
  trackWidth: number;
}

export function RangesView({
  layers,
  zoneDragRef,
  onUpdateLayer,
  onOpenSoundPicker,
  onOpenLayerInspector,
}: {
  layers: LayerDto[];
  zoneDragRef: React.MutableRefObject<ZoneDragState | null>;
  onUpdateLayer: (
    idx: number,
    patch: Partial<LayerDto> & { paramsPatch?: Partial<SoundParamsDto> }
  ) => void;
  onOpenSoundPicker: (target: number | "add") => void;
  onOpenLayerInspector: (idx: number) => void;
}) {
  return (
    <section className="zones-editor" aria-label="Layer Ranges & Alignments">
      <div className="zones-toolbar">
        <div className="zones-title-group">
          <span className="zones-title">Layer Ranges</span>
          <span className="zones-hint">
            Drag handles to set range · Drag bar to shift · Double-click for
            Full 88
          </span>
        </div>
        <div className="zones-actions">
          <button
            type="button"
            className="zones-btn"
            onClick={() => {
              layers.forEach((_, i) =>
                onUpdateLayer(i, { minNote: 21, maxNote: 108 })
              );
            }}
          >
            All Full 88
          </button>
          {layers.length >= 2 && (
            <button
              type="button"
              className="zones-btn"
              onClick={() => {
                onUpdateLayer(0, { minNote: 21, maxNote: 59 });
                for (let i = 1; i < layers.length; i++) {
                  onUpdateLayer(i, { minNote: 60, maxNote: 108 });
                }
              }}
            >
              Split @ C4
            </button>
          )}
          <button
            type="button"
            className="zones-btn primary"
            onClick={() => onOpenSoundPicker("add")}
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
                <div
                  className="zone-gutter empty"
                  style={{ "--layer-color": color } as React.CSSProperties}
                >
                  <span className="zone-color-bar" />
                  <span className="zone-gutter-idx">L{slotIdx + 1}</span>
                </div>
                <button
                  type="button"
                  className="zone-empty-track"
                  onClick={() => onOpenSoundPicker("add")}
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
              <div
                className={`zone-gutter ${layer.enabled ? "" : "muted"}`}
                style={{ "--layer-color": color } as React.CSSProperties}
              >
                <button
                  type="button"
                  className={`zone-mute-btn ${layer.enabled ? "on" : ""}`}
                  onClick={() =>
                    onUpdateLayer(slotIdx, { enabled: !layer.enabled })
                  }
                  title={layer.enabled ? "Mute layer" : "Enable layer"}
                >
                  <span className="zone-color-bar" />
                  <span>L{slotIdx + 1}</span>
                </button>
                <button
                  type="button"
                  className="zone-tune-btn"
                  onClick={() => onOpenLayerInspector(slotIdx)}
                  title="Layer Controls"
                >
                  <SlidersSvg />
                </button>
              </div>

              <div className="zone-lane">
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
                    onUpdateLayer(slotIdx, { minNote: 21, maxNote: 108 })
                  }
                >
                  <button
                    type="button"
                    className="zone-handle left"
                    aria-label={`Low key ${midiNoteLabel(layer.minNote)}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      const lane = e.currentTarget.parentElement?.parentElement;
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
                      const lane = e.currentTarget.parentElement?.parentElement;
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
  );
}

