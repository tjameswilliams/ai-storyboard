import type { StateCreator } from "zustand";
import type { BoundingBox } from "../types";
import type { AppState } from "./index";

export interface DragPreview {
  index: number;
  box: BoundingBox;
}

export interface RegionEditorSlice {
  selectedRegionIndex: number | null;
  hoveredRegionIndex: number | null;
  dragPreview: DragPreview | null;
  jsonError: string | null;

  selectRegion: (i: number | null) => void;
  setHoveredRegion: (i: number | null) => void;
  setDragPreview: (p: DragPreview | null) => void;
  setJsonError: (s: string | null) => void;
}

export const createRegionEditorSlice: StateCreator<AppState, [], [], RegionEditorSlice> = (set) => ({
  selectedRegionIndex: null,
  hoveredRegionIndex: null,
  dragPreview: null,
  jsonError: null,

  selectRegion: (i) => set({ selectedRegionIndex: i }),
  setHoveredRegion: (i) => set({ hoveredRegionIndex: i }),
  setDragPreview: (p) => set({ dragPreview: p }),
  setJsonError: (s) => set({ jsonError: s }),
});
