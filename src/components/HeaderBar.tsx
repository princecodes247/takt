import { StatusDto } from "../types";
import { RotaryKnob } from "./ui";

export function HeaderBar({
  status,
  volumePct,
  setupOpen,
  onPanic,
  onVolumeChange,
  onToggleSetup,
}: {
  status: StatusDto | null;
  volumePct: number;
  setupOpen: boolean;
  onPanic: () => void;
  onVolumeChange: (pct: number) => void;
  onToggleSetup: () => void;
}) {
  return (
    <header className="rack-header">
      <div className="brand">
        <h1 className="brand-name">TAKT</h1>
        <div className="telemetry-strip">
          <div className="activity-indicator">
            <span className={`led ${status?.isPlaying ? "active" : ""}`} />
            <span>
              {status?.isPlaying ? `PLAYING (${status.activeVoices})` : "IDLE"}
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
          className="btn btn-panic"
          onClick={onPanic}
          aria-label="Panic (All Notes Off)"
          title="Panic · All Notes Off"
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
            <circle cx="12" cy="12" r="9" />
            <line x1="5.6" y1="5.6" x2="18.4" y2="18.4" />
          </svg>
        </button>

        <div
          className="header-master"
          title="Master Volume · Double-click to reset (80%)"
        >
          <span className="master-label">Master</span>
          <RotaryKnob
            label=""
            hideValue
            size={26}
            color="#89a8f0"
            value={volumePct}
            min={0}
            max={125}
            step={1}
            displayValue={`${volumePct}%`}
            onChange={onVolumeChange}
            onReset={() => onVolumeChange(80)}
          />
          <span className="master-pct">{volumePct}%</span>
        </div>

        <button
          type="button"
          className={`btn-setup ${setupOpen ? "active" : ""}`}
          onClick={onToggleSetup}
          aria-expanded={setupOpen}
        >
          <span aria-hidden="true">⚙</span>
          <span>{setupOpen ? "Perform" : "Setup"}</span>
        </button>
      </div>
    </header>
  );
}

