import { AudioDeviceDto, MidiDeviceGroup, StatusDto } from "../types";
import { CustomSelect } from "./ui";

export function SetupPanel({
  status,
  midiDevices,
  groupedMidi,
  showAllMidiPorts,
  audioDevices,
  bufferChoices,
  layerCount,
  onSetShowAllMidiPorts,
  onRefreshMidiDevices,
  onToggleMidiDevice,
  onAudioChange,
  onTriggerAudition,
}: {
  status: StatusDto | null;
  midiDevices: string[];
  groupedMidi: MidiDeviceGroup[];
  showAllMidiPorts: boolean;
  audioDevices: AudioDeviceDto[];
  bufferChoices: number[];
  layerCount: number;
  onSetShowAllMidiPorts: (show: boolean) => void;
  onRefreshMidiDevices: () => void;
  onToggleMidiDevice: (deviceName: string) => void;
  onAudioChange: (deviceName: string, bufferSize: number | null) => void;
  onTriggerAudition: (down: boolean) => void;
}) {
  const activeMidiCount = status?.midiDevices.length ?? 0;

  return (
    <section className="setup-panel" aria-label="Hardware & Audio Setup">
      <div className="setup-shell">
        <div className="setup-card">
          <div className="setup-card-head">
            <div className="setup-card-title-group">
              <h2 className="setup-card-title">MIDI Inputs</h2>
              <span
                className={`setup-status-pill ${activeMidiCount > 0 ? "active" : ""}`}
              >
                {activeMidiCount} active
              </span>
            </div>
            <div className="setup-midi-actions">
              <button
                type="button"
                role="switch"
                aria-checked={showAllMidiPorts}
                className={`setup-toggle-pill ${showAllMidiPorts ? "active" : ""}`}
                onClick={() => onSetShowAllMidiPorts(!showAllMidiPorts)}
              >
                <span className="setup-toggle-dot" aria-hidden="true" />
                <span>Show all ports</span>
              </button>
              <button
                type="button"
                className="setup-action-btn"
                onClick={onRefreshMidiDevices}
              >
                Refresh
              </button>
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
                          (status?.desiredMidiDevices.includes(p.name) ?? false)
                      );
                  return (
                    <div key={group.deviceName} className="midi-group-row">
                      <span className="midi-group-name">{group.deviceName}</span>
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
                              onClick={() => onToggleMidiDevice(port.name)}
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
                    <div key={`offline-${name}`} className="midi-group-row">
                      <span className="midi-group-name midi-offline-label">
                        Offline device
                      </span>
                      <div className="midi-group-ports">
                        <button
                          type="button"
                          className="midi-chip offline"
                          onClick={() => onToggleMidiDevice(name)}
                          title="Remembered device is offline (will auto-reconnect when plugged in). Click to forget."
                        >
                          <span className="midi-chip-dot" aria-hidden="true" />
                          <span>{name} (Offline) ×</span>
                        </button>
                      </div>
                    </div>
                  ))}
              </>
            )}
          </div>
        </div>

        <div className="setup-card">
          <div className="setup-card-head">
            <h2 className="setup-card-title">Audio Output</h2>
            <span className="setup-status-pill">
              {status
                ? `${status.sampleRate} Hz · ${layerCount} active layer${layerCount === 1 ? "" : "s"}`
                : "Loading…"}
            </span>
          </div>

          <div className="grid-2">
            <div className="field">
              <label htmlFor="audio-select">Output Device</label>
              <CustomSelect
                id="audio-select"
                ariaLabel="Audio Output"
                value={status?.audioDevice ?? ""}
                options={audioDevices.map((dev) => ({
                  value: dev.name,
                  label: `${dev.name}${dev.isDefault ? " (Default)" : ""}`,
                }))}
                onChange={(val) =>
                  onAudioChange(val, status?.bufferSize ?? null)
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
                  onAudioChange(status?.audioDevice ?? "", nextBuf);
                }}
              />
            </div>
          </div>

          <div className="setup-audio-footer">
            <span className="setup-hint">
              Hold to audition a C4 sine/synth test tone through the selected
              output.
            </span>
            <button
              type="button"
              className="setup-test-btn"
              onMouseDown={() => onTriggerAudition(true)}
              onMouseUp={() => onTriggerAudition(false)}
              onMouseLeave={() => onTriggerAudition(false)}
            >
              Test C4 Note
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

