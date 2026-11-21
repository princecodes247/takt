import { LAYER_COLORS, LayerDto, StatusDto } from "../types";
import {
  BLACK_KEYS,
  SEMITONE_TO_LABEL,
  WHITE_KEYS,
  midiNoteLabel,
  noteSpanPct,
} from "../utils/music";

export function KeyboardDeck({
  status,
  layers,
  chordDetectEnabled,
  detectedChord,
  keyboardEnabled,
  octave,
  zonesView,
  activeMidiNotes,
  activeKeyboardNotes,
  activeMouseNote,
  mousePressedRef,
  onToggleSustain,
  onToggleChordDetect,
  onSetOctave,
  onToggleKeyboard,
  onToggleZonesView,
  onOpenZonesView,
  onSetPitchBend,
  onSetModWheel,
  onGlissandoTo,
}: {
  status: StatusDto | null;
  layers: LayerDto[];
  chordDetectEnabled: boolean;
  detectedChord: string | null;
  keyboardEnabled: boolean;
  octave: number;
  zonesView: boolean;
  activeMidiNotes: Set<number>;
  activeKeyboardNotes: Set<number>;
  activeMouseNote: number | null;
  mousePressedRef: React.MutableRefObject<boolean>;
  onToggleSustain: () => void;
  onToggleChordDetect: () => void;
  onSetOctave: (updater: (o: number) => number) => void;
  onToggleKeyboard: () => void;
  onToggleZonesView: () => void;
  onOpenZonesView: () => void;
  onSetPitchBend: (val: number) => void;
  onSetModWheel: (val: number) => void;
  onGlissandoTo: (note: number | null) => void;
}) {
  const pb = status?.pitchBend ?? 0;
  const pbPct = ((pb + 8192) / 16383) * 100;
  const pbActive = Math.abs(pb) > 128;

  const mw = status?.modWheel ?? 0;
  const mwPct = (mw / 127) * 100;
  const mwActive = mw > 2;
  const tickCount = 13;
  const midIdx = Math.floor(tickCount / 2);

  const updatePb = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = 1 - (e.clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, ratio));
    onSetPitchBend(Math.round(clamped * 16383) - 8192);
  };

  const updateMw = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = 1 - (e.clientY - rect.top) / rect.height;
    const clamped = Math.max(0, Math.min(1, ratio));
    onSetModWheel(Math.round(clamped * 127));
  };

  return (
    <footer className="piano-footer">
      <div className="keyboard-header">
        <div className="keyboard-left-group">
          {chordDetectEnabled && (
            <div className="chord-readout-wrap" aria-live="polite">
              <span className={`chord-badge ${detectedChord ? "active" : ""}`}>
                {detectedChord ?? "—"}
              </span>
            </div>
          )}
        </div>

        <div className="keyboard-controls">
          <button
            type="button"
            aria-pressed={Boolean(status?.sustainActive)}
            className={`kb-pill sustain-pill ${status?.sustainActive ? "on" : ""}`}
            title="Toggle Sustain (CC 64) · lights up when sustain pedal is pressed"
            onClick={onToggleSustain}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="7" y="3" width="10" height="18" rx="3" />
              <circle cx="12" cy="15" r="2" />
            </svg>
            <span>Sustain</span>
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={chordDetectEnabled}
            aria-label="Toggle Chord Detection"
            className={`kb-pill kb-icon-only ${chordDetectEnabled ? "on" : ""}`}
            title={
              chordDetectEnabled ? "Chord Detection ON" : "Chord Detection OFF"
            }
            onClick={onToggleChordDetect}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </button>

          <span className="kb-divider" aria-hidden="true" />

          <div className="kb-typing-group">
            <button
              type="button"
              role="switch"
              aria-checked={keyboardEnabled}
              aria-label="Toggle Computer Keyboard"
              className={`kb-group-toggle ${keyboardEnabled ? "on" : ""}`}
              title="Computer keyboard playback (Z/X octave · A–' play)"
              onClick={onToggleKeyboard}
            >
              <svg
                viewBox="0 0 24 24"
                width="13"
                height="13"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="6" width="20" height="12" rx="2" />
                <line x1="6" y1="10" x2="6.01" y2="10" />
                <line x1="10" y1="10" x2="10.01" y2="10" />
                <line x1="14" y1="10" x2="14.01" y2="10" />
                <line x1="18" y1="10" x2="18.01" y2="10" />
                <line x1="8" y1="14" x2="16" y2="14" />
              </svg>
            </button>
            {keyboardEnabled && (
              <>
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => onSetOctave((o) => Math.max(0, o - 1))}
                  disabled={octave <= 0}
                  aria-label="Octave Down"
                  title="Octave Down (Z)"
                >
                  −
                </button>
                <span className="octave-readout">C{octave}</span>
                <button
                  type="button"
                  className="step-btn"
                  onClick={() => onSetOctave((o) => Math.min(7, o + 1))}
                  disabled={octave >= 7}
                  aria-label="Octave Up"
                  title="Octave Up (X)"
                >
                  +
                </button>
              </>
            )}
          </div>

          <button
            type="button"
            className={`kb-pill kb-icon-only ${zonesView ? "on" : ""}`}
            title="Edit Layer Key Ranges"
            aria-label="Edit Layer Key Ranges"
            onClick={onToggleZonesView}
          >
            <svg
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <line x1="3" y1="7" x2="21" y2="7" />
              <line x1="6" y1="12" x2="18" y2="12" />
              <line x1="4" y1="17" x2="16" y2="17" />
            </svg>
          </button>
        </div>
      </div>

      <div className="piano-deck-row">
        <div className="wheels-bay" aria-label="Pitch and Modulation Wheels">
          <div className="midi-wheel-col">
            <div className="midi-wheel-unit pb-only">
              <div
                className={`midi-wheel-well ${pbActive ? "active" : ""}`}
                role="slider"
                tabIndex={0}
                aria-label="Pitch Bend"
                aria-valuemin={-8192}
                aria-valuemax={8191}
                aria-valuenow={pb}
                title="Pitch Bend (springs back to center)"
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updatePb(e);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) updatePb(e);
                }}
                onPointerUp={() => onSetPitchBend(0)}
                onPointerCancel={() => onSetPitchBend(0)}
              >
                <div className="midi-wheel-drum">
                  <div
                    className="midi-wheel-notch"
                    style={{ bottom: `calc(${pbPct}% - 9px)` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="midi-wheel-col">
            <div className="midi-wheel-unit">
              <div
                className={`midi-wheel-well ${mwActive ? "active" : ""}`}
                role="slider"
                tabIndex={0}
                aria-label="Modulation Wheel"
                aria-valuemin={0}
                aria-valuemax={127}
                aria-valuenow={mw}
                title={`Mod Wheel (${mw}) · double-click to reset`}
                onPointerDown={(e) => {
                  if (e.detail >= 2) {
                    onSetModWheel(0);
                    return;
                  }
                  e.currentTarget.setPointerCapture(e.pointerId);
                  updateMw(e);
                }}
                onPointerMove={(e) => {
                  if (e.buttons === 1) updateMw(e);
                }}
                onDoubleClick={() => onSetModWheel(0)}
              >
                <div className="midi-wheel-drum">
                  <div
                    className="midi-wheel-notch"
                    style={{ bottom: `calc(${mwPct}% - 9px)` }}
                    aria-hidden="true"
                  />
                </div>
              </div>
              <div className="wheel-ticks right" aria-hidden="true">
                {Array.from({ length: tickCount }).map((_, i) => {
                  const tickPct =
                    ((tickCount - 1 - i) / (tickCount - 1)) * 100;
                  const isCenter = i === midIdx;
                  const lit = mwActive && tickPct <= mwPct + 1;
                  return (
                    <span
                      key={i}
                      className={`wheel-tick ${isCenter ? "center" : ""} ${lit ? "lit" : ""}`}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="piano-deck-main">
          <div
            className="zone-bars"
            role="button"
            tabIndex={0}
            title="Click to edit layer key ranges"
            onClick={onOpenZonesView}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onOpenZonesView();
            }}
          >
            {layers.map((layer, idx) => {
              const color = LAYER_COLORS[idx % LAYER_COLORS.length];
              const { leftPct, widthPct } = noteSpanPct(
                layer.minNote,
                layer.maxNote
              );
              return (
                <div
                  key={`zone-${idx}`}
                  className="zone-track"
                  title={`${layer.soundName} · ${midiNoteLabel(layer.minNote)}–${midiNoteLabel(layer.maxNote)}`}
                >
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
            <div className="piano-felt-strip" aria-hidden="true" />
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
                const isMiddleC = key.note === 60;
                return (
                  <button
                    key={key.note}
                    type="button"
                    tabIndex={-1}
                    className={`piano-key white ${pressed ? "pressed" : ""} ${midiActive ? "midi-lit" : ""} ${qwertyLabel ? "mapped" : ""} ${isMiddleC ? "middle-c" : ""}`}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      mousePressedRef.current = true;
                      onGlissandoTo(key.note);
                    }}
                    onPointerEnter={(e) => {
                      if (!mousePressedRef.current || (e.buttons & 1) === 0)
                        return;
                      onGlissandoTo(key.note);
                    }}
                  >
                    {qwertyLabel && (
                      <span className="key-cap">{qwertyLabel}</span>
                    )}
                    {isMiddleC && (
                      <span className="middle-c-dot" aria-hidden="true" />
                    )}
                    {key.cLabel && !isMiddleC && !qwertyLabel && (
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
                      onGlissandoTo(key.note);
                    }}
                    onPointerEnter={(e) => {
                      if (!mousePressedRef.current || (e.buttons & 1) === 0)
                        return;
                      e.stopPropagation();
                      onGlissandoTo(key.note);
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
        </div>
      </div>
    </footer>
  );
}

