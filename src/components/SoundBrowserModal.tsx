import { useEffect, useMemo, useState } from "react";
import { LAYER_COLORS, SoundDto } from "../types";
import { TYPE_FACETS, getSoundLibrary, soundMatchesFacet } from "../utils/music";
import { CustomSelect } from "./ui";

export function SoundBrowserModal({
  pickerTarget,
  layerCount,
  sounds,
  loadingTarget,
  onClose,
  onAssignSound,
}: {
  pickerTarget: number | "add";
  layerCount: number;
  sounds: SoundDto[];
  loadingTarget: string | null;
  onClose: () => void;
  onAssignSound: (target: number | "add", soundId: string) => void;
}) {
  const [soundSearch, setSoundSearch] = useState("");
  const [soundLibrary, setSoundLibrary] = useState("All");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [soundType, setSoundType] = useState("All");
  const [soundSortBy, setSoundSortBy] = useState<"name" | "category">("name");
  const [soundSortAsc, setSoundSortAsc] = useState(true);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setPickerSelectedId(null);
  }, [pickerTarget]);

  const soundCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sounds) {
      counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sounds]);

  const soundLibraries = useMemo(() => {
    const set = new Set<string>();
    for (const s of sounds) set.add(getSoundLibrary(s));
    return Array.from(set).sort();
  }, [sounds]);

  const availableTypes = useMemo(
    () => TYPE_FACETS.filter((f) => sounds.some((s) => soundMatchesFacet(s, f))),
    [sounds]
  );

  const filteredSounds = useMemo(() => {
    const q = soundSearch.trim().toLowerCase();
    const list = sounds.filter((s) => {
      if (soundLibrary !== "All" && getSoundLibrary(s) !== soundLibrary) {
        return false;
      }
      if (selectedCategory !== "All" && s.category !== selectedCategory) {
        return false;
      }
      if (soundType !== "All" && !soundMatchesFacet(s, soundType)) {
        return false;
      }
      if (q) {
        return (
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q)
        );
      }
      return true;
    });

    const sorted = [...list].sort((a, b) => {
      const cmp =
        soundSortBy === "category"
          ? a.category.localeCompare(b.category) || a.name.localeCompare(b.name)
          : a.name.localeCompare(b.name);
      return soundSortAsc ? cmp : -cmp;
    });
    return sorted;
  }, [
    sounds,
    soundLibrary,
    selectedCategory,
    soundType,
    soundSearch,
    soundSortBy,
    soundSortAsc,
  ]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card sound-browser-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Sound Select"
      >
        <div className="sb-header">
          <div className="sb-library-wrap">
            <span className="sb-label">Library</span>
            <CustomSelect
              ariaLabel="Library"
              className="sb-dropdown"
              value={soundLibrary}
              options={[
                { value: "All", label: "All Sounds" },
                ...soundLibraries.map((lib) => ({ value: lib, label: lib })),
              ]}
              onChange={setSoundLibrary}
            />
          </div>

          <div className="sb-title-center">
            <span
              className="sb-module-dot"
              style={{
                background:
                  LAYER_COLORS[
                    (pickerTarget === "add" ? layerCount : pickerTarget) %
                      LAYER_COLORS.length
                  ],
              }}
            />
            <span className="sb-title-text">
              {pickerTarget === "add"
                ? `Add Sound to Module ${layerCount + 1}`
                : `Select Sound for Module ${pickerTarget + 1}`}
            </span>
          </div>

          <div className="sb-search-wrap">
            <svg
              className="sb-search-icon"
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              type="search"
              className="sb-search-input"
              placeholder="Search"
              value={soundSearch}
              onChange={(e) => setSoundSearch(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        <div className="sb-columns">
          <div className="sb-col">
            <div className="sb-col-title">Category</div>
            <div className="sb-col-list" role="listbox" aria-label="Category">
              <button
                type="button"
                className={`sb-item ${selectedCategory === "All" ? "active" : ""}`}
                onClick={() => setSelectedCategory("All")}
              >
                All
              </button>
              {soundCategories.map((cat) => (
                <button
                  key={cat.name}
                  type="button"
                  className={`sb-item ${selectedCategory === cat.name ? "active" : ""}`}
                  onClick={() => setSelectedCategory(cat.name)}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-col">
            <div className="sb-col-title">Type</div>
            <div className="sb-col-list" role="listbox" aria-label="Type">
              <button
                type="button"
                className={`sb-item ${soundType === "All" ? "active" : ""}`}
                onClick={() => setSoundType("All")}
              >
                All
              </button>
              {availableTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={`sb-item ${soundType === t ? "active" : ""}`}
                  onClick={() => setSoundType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div className="sb-col sb-results-col">
            <div className="sb-results-head">
              <span className="sb-label">Order by</span>
              <CustomSelect
                ariaLabel="Order by"
                className="sb-dropdown sb-order-select"
                value={soundSortBy}
                options={[
                  { value: "name", label: "Name" },
                  { value: "category", label: "Category" },
                ]}
                onChange={(val) => setSoundSortBy(val as "name" | "category")}
              />
              <button
                type="button"
                className="sb-sort-dir-btn"
                onClick={() => setSoundSortAsc((v) => !v)}
                title={soundSortAsc ? "Ascending" : "Descending"}
              >
                {soundSortAsc ? "↓≡" : "↑≡"}
              </button>
            </div>

            <div className="sb-results-list" role="listbox" aria-label="Sounds">
              {filteredSounds.map((sound) => {
                const selected = pickerSelectedId === sound.id;
                const dotCount = Math.min(
                  6,
                  Math.max(2, Math.ceil(sound.supportedParams.length / 2))
                );
                return (
                  <button
                    key={sound.id}
                    type="button"
                    className={`sb-result-row ${selected ? "active" : ""}`}
                    onClick={() => setPickerSelectedId(sound.id)}
                    onDoubleClick={() => onAssignSound(pickerTarget, sound.id)}
                  >
                    <span className="sb-result-name">{sound.name}</span>
                    <span className="sb-result-dots" aria-hidden="true">
                      {Array.from({ length: 6 }).map((_, d) => (
                        <span
                          key={d}
                          className={`sb-dot ${d < dotCount ? "lit" : ""}`}
                        />
                      ))}
                    </span>
                  </button>
                );
              })}
              {filteredSounds.length === 0 && (
                <div className="sb-empty">No sounds match filters</div>
              )}
            </div>
          </div>
        </div>

        <div className="sb-footer">
          <button type="button" className="sb-btn-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="sb-btn-confirm"
            disabled={!pickerSelectedId || loadingTarget !== null}
            onClick={() => {
              if (pickerSelectedId) {
                onAssignSound(pickerTarget, pickerSelectedId);
              }
            }}
          >
            {loadingTarget
              ? "Loading…"
              : pickerTarget === "add"
                ? "Add Sound"
                : "Select Sound"}
          </button>
        </div>
      </div>
    </div>
  );
}

