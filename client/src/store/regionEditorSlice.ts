import type { StateCreator } from "zustand";
import type { BoundingBox } from "../types";
import type { AppState } from "./index";

export interface DragPreview {
  index: number;
  box: BoundingBox;
}

export interface RegionEditorSlice {
  // The "primary" selection (drives the single-region inspector). Null when
  // nothing or 2+ regions are selected.
  selectedRegionIndex: number | null;
  // The full multi-selection set (always includes the primary when set). Hold
  // Ctrl/Cmd and click boxes to add/remove; 2+ enables group move/resize/delete.
  selectedRegionIndices: number[];
  hoveredRegionIndex: number | null;
  dragPreview: DragPreview | null;
  jsonError: string | null;

  selectRegion: (i: number | null) => void;
  toggleRegionSelection: (i: number) => void;
  setHoveredRegion: (i: number | null) => void;
  setDragPreview: (p: DragPreview | null) => void;
  setJsonError: (s: string | null) => void;
}

export const createRegionEditorSlice: StateCreator<AppState, [], [], RegionEditorSlice> = (set, get) => ({
  selectedRegionIndex: null,
  selectedRegionIndices: [],
  hoveredRegionIndex: null,
  dragPreview: null,
  jsonError: null,

  selectRegion: (i) => set({ selectedRegionIndex: i, selectedRegionIndices: i === null ? [] : [i] }),
  toggleRegionSelection: (i) => {
    const cur = get().selectedRegionIndices;
    const has = cur.includes(i);
    const next = has ? cur.filter((x) => x !== i) : [...cur, i];
    set({
      selectedRegionIndices: next,
      // Primary (drives the single-region inspector) only when exactly one is selected.
      selectedRegionIndex: next.length === 1 ? next[0] : null,
    });
  },
  setHoveredRegion: (i) => set({ hoveredRegionIndex: i }),
  setDragPreview: (p) => set({ dragPreview: p }),
  setJsonError: (s) => set({ jsonError: s }),
});
