import { useRef } from "react";
import {
  Patch,
  StatusDto,
  WORSHIP_KEYS,
  WORSHIP_PAD_VOICES,
} from "../types";
import { formatTimeMs } from "../utils/music";
import { CompactFader, CustomSelect, PowerSvg } from "./ui";

export function LeftSidebar({
  patches,
  activePatch,
  loadingTarget,
  leftTab,
  status,
  padVolPct,
  trackPos,
  trackDuration,
  trackSeekPct,
  trackVolPct,
  onSetLeftTab,
  onCreatePatch,
  onLoadPatch,
  onDeletePatch,
  onWorshipPadToggle,
  onWorshipPadKey,
  onWorshipPadVolume,
  onWorshipPadVoice,
  onTrackFileSelected,
  onTrackPlayToggle,
  onTrackLoopToggle,
  onTrackSeek,
  onTrackVolumeChange,
}: {
  patches: Patch[];
  activePatch: Patch | undefined;
  loadingTarget: string | null;
  leftTab: "pad" | "track";
  status: StatusDto | null;
  padVolPct: number;
  trackPos: number;
  trackDuration: number;
  trackSeekPct: number;
  trackVolPct: number;
  onSetLeftTab: (tab: "pad" | "track") => void;
  onCreatePatch: () => void;
  onLoadPatch: (patch: Patch, snapIdx?: number) => void;
  onDeletePatch: (patchId: string) => void;
  onWorshipPadToggle: () => void;
  onWorshipPadKey: (key: number) => void;
  onWorshipPadVolume: (pct: number) => void;
  onWorshipPadVoice: (voice: number) => void;
  onTrackFileSelected: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onTrackPlayToggle: () => void;
  onTrackLoopToggle: () => void;
  onTrackSeek: (ms: number) => void;
  onTrackVolumeChange: (pct: number) => void;
}) {
  const trackInputRef = useRef<HTMLInputElement | null>(null);

  return (
    <aside className="stage-sidebar">
      <section className="sidebar-card favorites-card">
        <div className="sidebar-card-head">
          <span className="sidebar-title">Patches</span>
          <button
            type="button"
            className="sidebar-new-btn"
            onClick={onCreatePatch}
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
                  onClick={() => onLoadPatch(patch, 0)}
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
                    onClick={() => onDeletePatch(patch.id)}
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
              const cur = patches.findIndex((p) => p.id === activePatch?.id);
              const prev = (cur - 1 + patches.length) % patches.length;
              onLoadPatch(patches[prev], 0);
            }}
          >
            ‹ Prev
          </button>
          <button
            type="button"
            className="patch-nav-btn"
            disabled={patches.length <= 1 || loadingTarget !== null}
            onClick={() => {
              const cur = patches.findIndex((p) => p.id === activePatch?.id);
              const next = (cur + 1) % patches.length;
              onLoadPatch(patches[next], 0);
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
            onClick={() => onSetLeftTab("pad")}
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
            onClick={() => onSetLeftTab("track")}
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
                  title={status?.worshipPadEnabled ? "Pad ON" : "Pad OFF"}
                  className={`pad-split-pwr ${status?.worshipPadEnabled ? "on" : ""}`}
                  onClick={onWorshipPadToggle}
                >
                  <PowerSvg />
                </button>
                <CustomSelect
                  ariaLabel="Worship Pad Voice"
                  className="pad-voice-select"
                  menuUp
                  value={String(status?.worshipPadVoice ?? 0)}
                  options={WORSHIP_PAD_VOICES}
                  onChange={(val) => onWorshipPadVoice(Number(val))}
                />
              </div>

              <div
                className="pad-key-grid-4x3"
                role="group"
                aria-label="Worship Pad Key"
              >
                {WORSHIP_KEYS.map((label, idx) => {
                  const active =
                    status?.worshipPadEnabled && status?.worshipPadKey === idx;
                  const selected = status?.worshipPadKey === idx;
                  return (
                    <button
                      key={label}
                      type="button"
                      className={`pad-key-btn ${active ? "active" : selected ? "selected" : ""}`}
                      onClick={() => onWorshipPadKey(idx)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <CompactFader
              ariaLabel="Worship Pad Volume"
              pct={padVolPct}
              resetPct={55}
              onChangePct={onWorshipPadVolume}
            />
          </div>
        ) : (
          <div className="track-module">
            <input
              ref={trackInputRef}
              type="file"
              accept=".wav,.flac,.ogg,audio/wav,audio/flac,audio/ogg"
              style={{ display: "none" }}
              onChange={onTrackFileSelected}
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
                      {formatTimeMs(status?.backingTrackDurationMs ?? 0)}
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
                  style={{ "--fill": `${trackSeekPct}%` } as React.CSSProperties}
                  aria-label="Backing Track Progress"
                  min={0}
                  max={trackDuration}
                  value={trackPos}
                  disabled={!status?.backingTrackName}
                  onChange={(e) => onTrackSeek(Number(e.target.value))}
                />

                <div className="track-transport-row">
                  <button
                    type="button"
                    className={`track-btn play ${status?.backingTrackPlaying ? "active" : ""}`}
                    onClick={onTrackPlayToggle}
                    disabled={!status?.backingTrackName}
                  >
                    {status?.backingTrackPlaying ? "⏸ Pause" : "▶ Play"}
                  </button>
                  <button
                    type="button"
                    className={`track-btn track-loop-btn ${status?.backingTrackLoop ? "active" : ""}`}
                    onClick={onTrackLoopToggle}
                    aria-label="Toggle Loop"
                    aria-pressed={Boolean(status?.backingTrackLoop)}
                    title={status?.backingTrackLoop ? "Loop ON" : "Loop OFF"}
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

              <CompactFader
                ariaLabel="Backing Track Volume"
                pct={trackVolPct}
                resetPct={75}
                onChangePct={onTrackVolumeChange}
              />
            </div>
          </div>
        )}
      </section>
    </aside>
  );
}

