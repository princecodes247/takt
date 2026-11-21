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
  return (
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
              onClick={onRefreshMidiDevices}
            >
              Refresh
            </button>
            <label className="checkbox-inline">
              <input
                type="checkbox"
                checked={showAllMidiPorts}
                onChange={(e) => onSetShowAllMidiPorts(e.target.checked)}
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
                  <button
                    key={`offline-${name}`}
                    type="button"
                    className="midi-chip offline"
                    onClick={() => onToggleMidiDevice(name)}
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
            onChange={(val) => onAudioChange(val, status?.bufferSize ?? null)}
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

      <div className="grid-2">
        <div className="field">
          <label>Stream Format</label>
          <div className="info-box">
            {status
              ? `${status.sampleRate} Hz · ${layerCount} active layer${layerCount === 1 ? "" : "s"}`
              : "Loading…"}
          </div>
        </div>

        <div className="field">
          <label>Audio Check</label>
          <button
            type="button"
            className="btn"
            onMouseDown={() => onTriggerAudition(true)}
            onMouseUp={() => onTriggerAudition(false)}
            onMouseLeave={() => onTriggerAudition(false)}
          >
            Test C4 Note
          </button>
        </div>
      </div>
    </section>
  );
}

