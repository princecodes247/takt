import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { detectChord } from "./chord";
import { HeaderBar } from "./components/HeaderBar";
import { KeyboardDeck } from "./components/KeyboardDeck";
import { LayerInspectorModal } from "./components/LayerInspectorModal";
import { LayerStrips } from "./components/LayerStrips";
import { LeftSidebar } from "./components/LeftSidebar";
import { RangesView, ZoneDragState } from "./components/RangesView";
import { SetupPanel } from "./components/SetupPanel";
import { SoundBrowserModal } from "./components/SoundBrowserModal";
import {
  AudioDeviceDto,
  DEFAULT_BUFFERS,
  InitialStateDto,
  LayerDto,
  Patch,
  PatchSnapshot,
  SnapshotLayerState,
  SoundDto,
  SoundParamsDto,
  StatusDto,
  TelemetryDto,
} from "./types";
import {
  CODE_TO_SEMITONE,
  easeInOutCubic,
  groupMidiDevices,
  interpolateSoundParams,
  lerp,
  makeDefaultPatches,
} from "./utils/music";

const KEYBOARD_STORAGE_KEY = "takt:computer-keyboard";
const CHORD_STORAGE_KEY = "takt:chord-detect";
const PATCHES_STORAGE_KEY = "takt:patches-v1";
const SNAPSHOT_MORPH_MS = 450;

export function App() {
  const [midiDevices, setMidiDevices] = useState<string[]>([]);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceDto[]>([]);
  const [sounds, setSounds] = useState<SoundDto[]>([]);
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [setupOpen, setSetupOpen] = useState(false);
  const [zonesView, setZonesView] = useState(false);
  const [showAllMidiPorts, setShowAllMidiPorts] = useState(false);
  const [leftTab, setLeftTab] = useState<"pad" | "track">("pad");
  const [loadingTarget, setLoadingTarget] = useState<string | null>(null);

  const [pickerTarget, setPickerTarget] = useState<number | "add" | null>(null);
  const [editingLayerIdx, setEditingLayerIdx] = useState<number | null>(null);
  const inspectorSnapshotRef = useRef<{
    index: number;
    layer: LayerDto;
  } | null>(null);

  const [patches, setPatches] = useState<Patch[]>(() => {
    try {
      const raw = localStorage.getItem(PATCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {
      // ignore
    }
    return makeDefaultPatches();
  });
  const [activePatchId, setActivePatchId] = useState<string>(() => {
    try {
      const raw = localStorage.getItem(PATCHES_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed[0].id;
      }
    } catch {
      // ignore
    }
    return "patch-worship";
  });
  const [activeSnapshotIdx, setActiveSnapshotIdx] = useState<number>(0);
  const snapshotAnimRef = useRef<number | null>(null);
  const cancelSnapshotAnim = useCallback(() => {
    if (snapshotAnimRef.current !== null) {
      cancelAnimationFrame(snapshotAnimRef.current);
      snapshotAnimRef.current = null;
    }
  }, []);

  useEffect(() => cancelSnapshotAnim, [cancelSnapshotAnim]);

  const [keyboardEnabled, setKeyboardEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(KEYBOARD_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [chordDetectEnabled, setChordDetectEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(CHORD_STORAGE_KEY);
      return saved === null ? true : saved === "true";
    } catch {
      return true;
    }
  });
  const [octave, setOctave] = useState<number>(4);
  const [activeKeyboardNotes, setActiveKeyboardNotes] = useState<Set<number>>(
    () => new Set()
  );
  const [activeMidiNotes, setActiveMidiNotes] = useState<Set<number>>(
    () => new Set()
  );
  const [activeMouseNote, setActiveMouseNote] = useState<number | null>(null);

  const activeKeyNotesRef = useRef<Map<string, number>>(new Map());
  const activeMouseNoteRef = useRef<number | null>(null);
  const mousePressedRef = useRef<boolean>(false);
  const zoneDragRef = useRef<ZoneDragState | null>(null);

  const activePatch = useMemo(
    () => patches.find((p) => p.id === activePatchId) ?? patches[0],
    [patches, activePatchId]
  );

  useEffect(() => {
    try {
      localStorage.setItem(PATCHES_STORAGE_KEY, JSON.stringify(patches));
    } catch {
      // ignore
    }
  }, [patches]);

  const applySnapshotToEngine = useCallback(
    async (snap: PatchSnapshot, currentLayers: LayerDto[]) => {
      const count = Math.min(snap.layers.length, currentLayers.length);
      for (let i = 0; i < count; i++) {
        const l = snap.layers[i];
        await invoke("update_layer", {
          index: i,
          enabled: l.enabled,
          volume: l.volume,
          minNote: l.minNote,
          maxNote: l.maxNote,
          octaveShift: l.octaveShift,
          params: l.params,
        });
      }
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: snap.worshipPadEnabled,
        key: snap.worshipPadKey,
      });
      setStatus(next);
    },
    []
  );

  const handleLoadPatch = useCallback(
    async (patch: Patch, snapIdx = 0) => {
      if (loadingTarget !== null) return;
      cancelSnapshotAnim();
      setError(null);
      setLoadingTarget(patch.id);
      setActivePatchId(patch.id);
      const targetSnapIdx = Math.min(
        snapIdx,
        Math.max(0, patch.snapshots.length - 1)
      );
      setActiveSnapshotIdx(targetSnapIdx);

      try {
        const soundSet = new Set(sounds.map((s) => s.id));
        const validIds = patch.layerSoundIds.map((id) =>
          soundSet.has(id) ? id : sounds[0]?.id ?? "model-d"
        );
        let latest = status;
        const curLen = latest?.layers.length ?? 1;

        for (let i = curLen - 1; i >= validIds.length; i--) {
          latest = await invoke<StatusDto>("remove_layer", { index: i });
        }
        for (let i = 0; i < validIds.length; i++) {
          if (i < (latest?.layers.length ?? 0)) {
            if (latest?.layers[i].soundId !== validIds[i]) {
              latest = await invoke<StatusDto>("set_layer_sound", {
                index: i,
                soundId: validIds[i],
              });
            }
          } else {
            latest = await invoke<StatusDto>("add_layer", {
              soundId: validIds[i],
            });
          }
        }
        if (latest) {
          setStatus(latest);
          const snap = patch.snapshots[targetSnapIdx];
          if (snap) {
            await applySnapshotToEngine(snap, latest.layers);
          }
        }
      } catch (err) {
        setError(String(err));
      } finally {
        setLoadingTarget(null);
      }
    },
    [loadingTarget, sounds, status, applySnapshotToEngine, cancelSnapshotAnim]
  );

  const handleSelectSnapshot = useCallback(
    async (idx: number) => {
      if (!activePatch || !status) return;
      const snap = activePatch.snapshots[idx];
      if (!snap) return;

      cancelSnapshotAnim();
      setActiveSnapshotIdx(idx);

      const startLayers = status.layers;
      const count = Math.min(snap.layers.length, startLayers.length);

      try {
        const nextPadStatus = await invoke<StatusDto>("set_worship_pad", {
          enabled: snap.worshipPadEnabled,
          key: snap.worshipPadKey,
        });
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                worshipPadEnabled: nextPadStatus.worshipPadEnabled,
                worshipPadKey: nextPadStatus.worshipPadKey,
              }
            : nextPadStatus
        );
      } catch (err) {
        setError(String(err));
      }

      if (count === 0) return;

      const startTime = performance.now();
      const step = (now: number) => {
        const rawT = Math.min(1, (now - startTime) / SNAPSHOT_MORPH_MS);
        const eased = easeInOutCubic(rawT);
        const done = rawT >= 1;

        const morphedLayers: LayerDto[] = startLayers.map((from, i) => {
          if (i >= count) return from;
          const to = snap.layers[i];
          const fromVol = from.enabled ? from.volume : 0;
          const toVol = to.enabled ? to.volume : 0;
          const enabled = done ? to.enabled : from.enabled || to.enabled;
          const volume = done ? to.volume : lerp(fromVol, toVol, eased);
          const params = done
            ? to.params
            : interpolateSoundParams(from.params, to.params, eased);

          void invoke("update_layer", {
            index: i,
            enabled,
            volume,
            minNote: to.minNote,
            maxNote: to.maxNote,
            octaveShift: to.octaveShift,
            params,
          }).catch(() => {});

          return {
            ...from,
            enabled,
            volume,
            minNote: to.minNote,
            maxNote: to.maxNote,
            octaveShift: to.octaveShift,
            params,
          };
        });

        setStatus((prev) => (prev ? { ...prev, layers: morphedLayers } : prev));

        if (!done) {
          snapshotAnimRef.current = requestAnimationFrame(step);
        } else {
          snapshotAnimRef.current = null;
        }
      };

      snapshotAnimRef.current = requestAnimationFrame(step);
    },
    [activePatch, status, cancelSnapshotAnim]
  );

  const handleSaveCurrentSnapshot = () => {
    if (!activePatch || !status) return;
    const snapLayers: SnapshotLayerState[] = status.layers.map((l) => ({
      enabled: l.enabled,
      volume: l.volume,
      minNote: l.minNote,
      maxNote: l.maxNote,
      octaveShift: l.octaveShift,
      params: l.params,
    }));
    const layerSoundIds = status.layers.map((l) => l.soundId);

    setPatches((prev) =>
      prev.map((p) => {
        if (p.id !== activePatch.id) return p;
        const nextSnaps = p.snapshots.map((s, i) =>
          i === activeSnapshotIdx
            ? {
                ...s,
                layers: snapLayers,
                worshipPadEnabled: status.worshipPadEnabled,
                worshipPadKey: status.worshipPadKey,
              }
            : s
        );
        return { ...p, layerSoundIds, snapshots: nextSnaps };
      })
    );
  };

  const handleAddSnapshot = () => {
    if (!activePatch || !status) return;
    const nextNum = activePatch.snapshots.length + 1;
    const newSnap: PatchSnapshot = {
      id: `snap-${Date.now()}`,
      name: `Snapshot ${nextNum}`,
      layers: status.layers.map((l) => ({
        enabled: l.enabled,
        volume: l.volume,
        minNote: l.minNote,
        maxNote: l.maxNote,
        octaveShift: l.octaveShift,
        params: l.params,
      })),
      worshipPadEnabled: status.worshipPadEnabled,
      worshipPadKey: status.worshipPadKey,
    };
    const nextIdx = activePatch.snapshots.length;
    setPatches((prev) =>
      prev.map((p) =>
        p.id === activePatch.id
          ? {
              ...p,
              layerSoundIds: status.layers.map((l) => l.soundId),
              snapshots: [...p.snapshots, newSnap],
            }
          : p
      )
    );
    setActiveSnapshotIdx(nextIdx);
  };

  const handleDeleteSnapshot = (idx: number) => {
    if (!activePatch || activePatch.snapshots.length <= 1) return;
    const nextSnaps = activePatch.snapshots.filter((_, i) => i !== idx);
    setPatches((prev) =>
      prev.map((p) =>
        p.id === activePatch.id ? { ...p, snapshots: nextSnaps } : p
      )
    );
    const nextIdx = Math.min(activeSnapshotIdx, nextSnaps.length - 1);
    setActiveSnapshotIdx(nextIdx);
  };

  const handleCreatePatch = () => {
    if (!status) return;
    const nextNum = patches.length + 1;
    const newPatch: Patch = {
      id: `patch-${Date.now()}`,
      name: `Patch ${nextNum}`,
      layerSoundIds: status.layers.map((l) => l.soundId),
      snapshots: [
        {
          id: `snap-${Date.now()}`,
          name: "Default",
          layers: status.layers.map((l) => ({
            enabled: l.enabled,
            volume: l.volume,
            minNote: l.minNote,
            maxNote: l.maxNote,
            octaveShift: l.octaveShift,
            params: l.params,
          })),
          worshipPadEnabled: status.worshipPadEnabled,
          worshipPadKey: status.worshipPadKey,
        },
      ],
    };
    setPatches((prev) => [...prev, newPatch]);
    setActivePatchId(newPatch.id);
    setActiveSnapshotIdx(0);
  };

  const handleDeletePatch = (patchId: string) => {
    if (patches.length <= 1) return;
    const nextPatches = patches.filter((p) => p.id !== patchId);
    setPatches(nextPatches);
    if (activePatchId === patchId) {
      handleLoadPatch(nextPatches[0], 0);
    }
  };

  const handleUpdateLayer = useCallback(
    async (
      index: number,
      patch: Partial<LayerDto> & { paramsPatch?: Partial<SoundParamsDto> }
    ) => {
      cancelSnapshotAnim();
      const layer = status?.layers[index];
      if (!layer) return;
      const nextLayer: LayerDto = {
        ...layer,
        ...patch,
        params: patch.paramsPatch
          ? { ...layer.params, ...patch.paramsPatch }
          : patch.params ?? layer.params,
      };
      setStatus((prev) => {
        if (!prev) return prev;
        const nextLayers = prev.layers.map((l, i) =>
          i === index ? nextLayer : l
        );
        return { ...prev, layers: nextLayers };
      });
      try {
        await invoke("update_layer", {
          index,
          enabled: nextLayer.enabled,
          volume: nextLayer.volume,
          minNote: nextLayer.minNote,
          maxNote: nextLayer.maxNote,
          octaveShift: nextLayer.octaveShift,
          params: nextLayer.params,
        });
      } catch (err) {
        setError(String(err));
      }
    },
    [status?.layers, cancelSnapshotAnim]
  );

  const openLayerInspector = useCallback(
    (idx: number) => {
      setEditingLayerIdx((cur) => {
        if (cur === idx) return null;
        const target = status?.layers[idx];
        if (target) {
          inspectorSnapshotRef.current = {
            index: idx,
            layer: JSON.parse(JSON.stringify(target)),
          };
        }
        return idx;
      });
    },
    [status?.layers]
  );

  const discardInspectorChanges = useCallback(() => {
    const snap = inspectorSnapshotRef.current;
    if (snap) {
      void handleUpdateLayer(snap.index, {
        enabled: snap.layer.enabled,
        volume: snap.layer.volume,
        minNote: snap.layer.minNote,
        maxNote: snap.layer.maxNote,
        octaveShift: snap.layer.octaveShift,
        params: snap.layer.params,
      });
    }
    inspectorSnapshotRef.current = null;
    setEditingLayerIdx(null);
  }, [handleUpdateLayer]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const drag = zoneDragRef.current;
      if (!drag || drag.trackWidth <= 0) return;
      const deltaNotes = Math.round(
        ((e.clientX - drag.startX) / drag.trackWidth) * 87
      );
      if (drag.mode === "min") {
        const nextMin = Math.max(
          21,
          Math.min(drag.origMax, drag.origMin + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, { minNote: nextMin });
      } else if (drag.mode === "max") {
        const nextMax = Math.min(
          108,
          Math.max(drag.origMin, drag.origMax + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, { maxNote: nextMax });
      } else {
        const span = drag.origMax - drag.origMin;
        const nextMin = Math.max(
          21,
          Math.min(108 - span, drag.origMin + deltaNotes)
        );
        handleUpdateLayer(drag.layerIdx, {
          minNote: nextMin,
          maxNote: nextMin + span,
        });
      }
    };
    const onUp = () => {
      zoneDragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [handleUpdateLayer]);

  useEffect(() => {
    invoke<InitialStateDto>("get_initial_state")
      .then((data) => {
        setMidiDevices(data.midiDevices);
        setAudioDevices(data.audioDevices);
        setSounds(data.sounds);
        setStatus(data.status);
      })
      .catch((err) => setError(String(err)));

    const unlistenTelemetry = listen<TelemetryDto>(
      "takt://telemetry",
      (event) => {
        setStatus((prev) =>
          prev
            ? {
                ...prev,
                isPlaying: event.payload.isPlaying,
                activeVoices: event.payload.activeVoices,
                estimatedLatencyMs: event.payload.estimatedLatencyMs,
                midiDevices: event.payload.midiDevices,
                desiredMidiDevices: event.payload.desiredMidiDevices,
                sustainActive: event.payload.sustainActive,
                pitchBend: event.payload.pitchBend,
                modWheel: event.payload.modWheel,
                backingTrackPlaying: event.payload.backingTrackPlaying,
                backingTrackPositionMs: event.payload.backingTrackPositionMs,
                backingTrackDurationMs: event.payload.backingTrackDurationMs,
              }
            : prev
        );
        setActiveMidiNotes(new Set(event.payload.activeMidiNotes));
      }
    );

    const unlistenMidi = listen<string[]>("takt://midi-devices", (event) => {
      setMidiDevices(event.payload);
    });

    return () => {
      unlistenTelemetry.then((fn) => fn());
      unlistenMidi.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const unlistenPc = listen<number>("takt://program-change", (event) => {
      const targetPatch = patches[event.payload];
      if (targetPatch) {
        void handleLoadPatch(targetPatch, 0);
      }
    });
    return () => {
      unlistenPc.then((fn) => fn());
    };
  }, [patches, handleLoadPatch]);

  const glissandoTo = useCallback((note: number | null) => {
    const prev = activeMouseNoteRef.current;
    if (prev === note) return;
    if (prev !== null) {
      invoke("trigger_test_note", { note: prev, down: false }).catch((err) =>
        setError(String(err))
      );
    }
    activeMouseNoteRef.current = note;
    setActiveMouseNote(note);
    if (note !== null) {
      invoke("trigger_test_note", { note, down: true, velocity: 100 }).catch(
        (err) => setError(String(err))
      );
    }
  }, []);

  useEffect(() => {
    const endMouse = () => {
      mousePressedRef.current = false;
      glissandoTo(null);
    };
    window.addEventListener("pointerup", endMouse);
    window.addEventListener("pointercancel", endMouse);
    window.addEventListener("blur", endMouse);
    return () => {
      window.removeEventListener("pointerup", endMouse);
      window.removeEventListener("pointercancel", endMouse);
      window.removeEventListener("blur", endMouse);
    };
  }, [glissandoTo]);

  const releaseAllKeyboardNotes = useCallback(() => {
    const held = Array.from(activeKeyNotesRef.current.values());
    if (held.length === 0) return;
    activeKeyNotesRef.current.clear();
    setActiveKeyboardNotes(new Set());
    for (const note of held) {
      invoke("trigger_test_note", { note, down: false }).catch((err) =>
        setError(String(err))
      );
    }
  }, []);

  const triggerKeyNote = useCallback(
    (code: string, down: boolean) => {
      const semitone = CODE_TO_SEMITONE.get(code);
      if (semitone === undefined) return;
      if (down) {
        if (activeKeyNotesRef.current.has(code)) return;
        const note = (octave + 1) * 12 + semitone;
        if (note < 21 || note > 108) return;
        activeKeyNotesRef.current.set(code, note);
        setActiveKeyboardNotes(new Set(activeKeyNotesRef.current.values()));
        invoke("trigger_test_note", { note, down: true, velocity: 100 }).catch(
          (err) => setError(String(err))
        );
      } else {
        const note = activeKeyNotesRef.current.get(code);
        if (note === undefined) return;
        activeKeyNotesRef.current.delete(code);
        setActiveKeyboardNotes(new Set(activeKeyNotesRef.current.values()));
        invoke("trigger_test_note", { note, down: false }).catch((err) =>
          setError(String(err))
        );
      }
    },
    [octave]
  );

  useEffect(() => {
    try {
      localStorage.setItem(KEYBOARD_STORAGE_KEY, String(keyboardEnabled));
    } catch {
      // ignore
    }
    if (!keyboardEnabled) releaseAllKeyboardNotes();
  }, [keyboardEnabled, releaseAllKeyboardNotes]);

  useEffect(() => {
    if (!keyboardEnabled) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "KeyZ") {
        e.preventDefault();
        setOctave((o) => Math.max(0, o - 1));
        return;
      }
      if (e.code === "KeyX") {
        e.preventDefault();
        setOctave((o) => Math.min(7, o + 1));
        return;
      }
      if (!CODE_TO_SEMITONE.has(e.code)) return;
      e.preventDefault();
      triggerKeyNote(e.code, true);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (!activeKeyNotesRef.current.has(e.code)) return;
      e.preventDefault();
      triggerKeyNote(e.code, false);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", releaseAllKeyboardNotes);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", releaseAllKeyboardNotes);
    };
  }, [keyboardEnabled, triggerKeyNote, releaseAllKeyboardNotes]);

  useEffect(() => {
    try {
      localStorage.setItem(CHORD_STORAGE_KEY, String(chordDetectEnabled));
    } catch {
      // ignore
    }
  }, [chordDetectEnabled]);

  const groupedMidi = useMemo(() => groupMidiDevices(midiDevices), [midiDevices]);

  const detectedChord = useMemo(() => {
    if (!chordDetectEnabled) return null;
    const allNotes = new Set<number>(activeMidiNotes);
    for (const n of activeKeyboardNotes) allNotes.add(n);
    if (activeMouseNote !== null) allNotes.add(activeMouseNote);
    return detectChord(allNotes);
  }, [chordDetectEnabled, activeMidiNotes, activeKeyboardNotes, activeMouseNote]);

  const handleTrackFileSelected = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      const buf = new Uint8Array(await file.arrayBuffer());
      const next = await invoke<StatusDto>("load_backing_track", buf, {
        headers: { "x-track-name": file.name },
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackPlayToggle = async () => {
    if (!status?.backingTrackName) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_backing_track_playing", {
        playing: !status.backingTrackPlaying,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackLoopToggle = async () => {
    if (!status) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_backing_track_loop", {
        looping: !status.backingTrackLoop,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackSeek = async (ms: number) => {
    setStatus((prev) =>
      prev ? { ...prev, backingTrackPositionMs: ms } : prev
    );
    try {
      await invoke("seek_backing_track", { positionMs: ms });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleTrackVolumeChange = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) =>
      prev ? { ...prev, backingTrackVolume: volume } : prev
    );
    try {
      await invoke("set_backing_track_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadToggle = async () => {
    if (!status) return;
    setError(null);
    try {
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: !status.worshipPadEnabled,
        key: status.worshipPadKey,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadKey = async (key: number) => {
    if (!status) return;
    setError(null);
    const shouldDisable =
      status.worshipPadEnabled && status.worshipPadKey === key;
    try {
      const next = await invoke<StatusDto>("set_worship_pad", {
        enabled: !shouldDisable,
        key,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadVolume = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) => (prev ? { ...prev, worshipPadVolume: volume } : prev));
    try {
      await invoke("set_worship_pad_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handleWorshipPadVoice = (voice: number) => {
    setStatus((prev) => (prev ? { ...prev, worshipPadVoice: voice } : prev));
    void invoke("set_worship_pad_voice", { voice });
  };

  const handleAssignSound = async (
    target: number | "add",
    soundId: string
  ) => {
    if (loadingTarget !== null) return;
    setError(null);
    setLoadingTarget(soundId);
    try {
      const next =
        target === "add"
          ? await invoke<StatusDto>("add_layer", { soundId })
          : await invoke<StatusDto>("set_layer_sound", {
              index: target,
              soundId,
            });
      setStatus(next);
      setPickerTarget(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoadingTarget(null);
    }
  };

  const handleRemoveLayer = async (index: number) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("remove_layer", { index });
      setStatus(next);
      if (editingLayerIdx === index) setEditingLayerIdx(null);
    } catch (err) {
      setError(String(err));
    }
  };

  const currentAudioDevice = audioDevices.find(
    (d) => d.name === status?.audioDevice
  );
  const bufferChoices =
    currentAudioDevice && currentAudioDevice.supportedBufferSizes.length > 0
      ? currentAudioDevice.supportedBufferSizes
      : DEFAULT_BUFFERS;

  const handleRefreshMidiDevices = useCallback(async () => {
    try {
      const devices = await invoke<string[]>("refresh_midi_devices");
      setMidiDevices(devices);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  const handleToggleMidiDevice = async (deviceName: string) => {
    setError(null);
    const current = status?.desiredMidiDevices ?? [];
    const nextDevices = current.includes(deviceName)
      ? current.filter((d) => d !== deviceName)
      : [...current, deviceName];
    try {
      const next = await invoke<StatusDto>("set_midi_devices", {
        devices: nextDevices,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleAudioChange = async (
    deviceName: string,
    bufferSize: number | null
  ) => {
    setError(null);
    try {
      const next = await invoke<StatusDto>("select_audio_device", {
        deviceName: deviceName === "" ? null : deviceName,
        bufferSize,
      });
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const handleVolumeChange = async (pct: number) => {
    const volume = pct / 100;
    setStatus((prev) => (prev ? { ...prev, masterVolume: volume } : prev));
    try {
      await invoke("set_volume", { volume });
    } catch (err) {
      setError(String(err));
    }
  };

  const handlePanic = async () => {
    setError(null);
    releaseAllKeyboardNotes();
    mousePressedRef.current = false;
    glissandoTo(null);
    try {
      const next = await invoke<StatusDto>("panic_all_notes_off");
      setStatus(next);
    } catch (err) {
      setError(String(err));
    }
  };

  const triggerAudition = async (down: boolean) => {
    try {
      await invoke("trigger_test_note", { note: 60, down });
    } catch (err) {
      setError(String(err));
    }
  };

  const volumePct = Math.round((status?.masterVolume ?? 0.8) * 100);
  const trackVolPct = Math.round((status?.backingTrackVolume ?? 0.75) * 100);
  const padVolPct = Math.round((status?.worshipPadVolume ?? 0.55) * 100);
  const trackDuration = Math.max(status?.backingTrackDurationMs ?? 0, 1);
  const trackPos = Math.min(status?.backingTrackPositionMs ?? 0, trackDuration);
  const trackSeekPct = (trackPos / trackDuration) * 100;

  const layers = status?.layers ?? [];
  const editingLayer =
    editingLayerIdx !== null ? layers[editingLayerIdx] ?? null : null;

  return (
    <main className="rack">
      <HeaderBar
        status={status}
        volumePct={volumePct}
        setupOpen={setupOpen}
        onPanic={handlePanic}
        onVolumeChange={handleVolumeChange}
        onToggleSetup={() =>
          setSetupOpen((v) => {
            if (!v) void handleRefreshMidiDevices();
            return !v;
          })
        }
      />

      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}

      {setupOpen ? (
        <SetupPanel
          status={status}
          midiDevices={midiDevices}
          groupedMidi={groupedMidi}
          showAllMidiPorts={showAllMidiPorts}
          audioDevices={audioDevices}
          bufferChoices={bufferChoices}
          layerCount={layers.length}
          onSetShowAllMidiPorts={setShowAllMidiPorts}
          onRefreshMidiDevices={() => void handleRefreshMidiDevices()}
          onToggleMidiDevice={handleToggleMidiDevice}
          onAudioChange={handleAudioChange}
          onTriggerAudition={triggerAudition}
        />
      ) : zonesView ? (
        <RangesView
          layers={layers}
          zoneDragRef={zoneDragRef}
          onUpdateLayer={handleUpdateLayer}
          onOpenSoundPicker={setPickerTarget}
          onOpenLayerInspector={openLayerInspector}
        />
      ) : (
        <div className="stage-layout">
          <LeftSidebar
            patches={patches}
            activePatch={activePatch}
            loadingTarget={loadingTarget}
            leftTab={leftTab}
            status={status}
            padVolPct={padVolPct}
            trackPos={trackPos}
            trackDuration={trackDuration}
            trackSeekPct={trackSeekPct}
            trackVolPct={trackVolPct}
            onSetLeftTab={setLeftTab}
            onCreatePatch={handleCreatePatch}
            onLoadPatch={handleLoadPatch}
            onDeletePatch={handleDeletePatch}
            onWorshipPadToggle={handleWorshipPadToggle}
            onWorshipPadKey={handleWorshipPadKey}
            onWorshipPadVolume={handleWorshipPadVolume}
            onWorshipPadVoice={handleWorshipPadVoice}
            onTrackFileSelected={handleTrackFileSelected}
            onTrackPlayToggle={handleTrackPlayToggle}
            onTrackLoopToggle={handleTrackLoopToggle}
            onTrackSeek={handleTrackSeek}
            onTrackVolumeChange={handleTrackVolumeChange}
          />

          <LayerStrips
            layers={layers}
            editingLayerIdx={editingLayerIdx}
            activePatch={activePatch}
            activeSnapshotIdx={activeSnapshotIdx}
            onOpenSoundPicker={setPickerTarget}
            onOpenLayerInspector={openLayerInspector}
            onRemoveLayer={handleRemoveLayer}
            onUpdateLayer={handleUpdateLayer}
            onSelectSnapshot={handleSelectSnapshot}
            onDeleteSnapshot={handleDeleteSnapshot}
            onAddSnapshot={handleAddSnapshot}
            onSaveCurrentSnapshot={handleSaveCurrentSnapshot}
          />
        </div>
      )}

      {!setupOpen && (
        <KeyboardDeck
          status={status}
          layers={layers}
          chordDetectEnabled={chordDetectEnabled}
          detectedChord={detectedChord}
          keyboardEnabled={keyboardEnabled}
          octave={octave}
          zonesView={zonesView}
          activeMidiNotes={activeMidiNotes}
          activeKeyboardNotes={activeKeyboardNotes}
          activeMouseNote={activeMouseNote}
          mousePressedRef={mousePressedRef}
          onToggleSustain={() => {
            const next = !status?.sustainActive;
            setStatus((prev) =>
              prev ? { ...prev, sustainActive: next } : prev
            );
            void invoke("set_sustain", { pressed: next });
          }}
          onToggleChordDetect={() => setChordDetectEnabled((v) => !v)}
          onSetOctave={setOctave}
          onToggleKeyboard={() => setKeyboardEnabled((v) => !v)}
          onToggleZonesView={() => setZonesView((v) => !v)}
          onOpenZonesView={() => setZonesView(true)}
          onSetPitchBend={(val) => {
            setStatus((prev) => (prev ? { ...prev, pitchBend: val } : prev));
            void invoke("set_pitch_bend", { value: val });
          }}
          onSetModWheel={(val) => {
            setStatus((prev) => (prev ? { ...prev, modWheel: val } : prev));
            void invoke("set_mod_wheel", { value: val });
          }}
          onGlissandoTo={glissandoTo}
        />
      )}

      {pickerTarget !== null && (
        <SoundBrowserModal
          pickerTarget={pickerTarget}
          layerCount={layers.length}
          sounds={sounds}
          loadingTarget={loadingTarget}
          onClose={() => setPickerTarget(null)}
          onAssignSound={(target, soundId) =>
            void handleAssignSound(target, soundId)
          }
        />
      )}

      {editingLayer && editingLayerIdx !== null && (
        <LayerInspectorModal
          editingLayer={editingLayer}
          editingLayerIdx={editingLayerIdx}
          layerCount={layers.length}
          onClose={() => setEditingLayerIdx(null)}
          onDiscard={discardInspectorChanges}
          onConfirm={() => {
            inspectorSnapshotRef.current = null;
            setEditingLayerIdx(null);
          }}
          onRemoveLayer={(idx) => void handleRemoveLayer(idx)}
          onOpenSoundPicker={(idx) => setPickerTarget(idx)}
          onUpdateLayer={handleUpdateLayer}
        />
      )}
    </main>
  );
}

export default App;
