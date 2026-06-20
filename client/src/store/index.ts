import { create } from "zustand";
import { api } from "../api/client";
import { createProjectSlice, type ProjectSlice } from "./projectSlice";
import { createImageSlice, type ImageSlice } from "./imageSlice";
import { createRegionEditorSlice, type RegionEditorSlice } from "./regionEditorSlice";
import { createChatSlice, type ChatSlice } from "./chatSlice";
import { createFolderSlice, type FolderSlice } from "./folderSlice";
import { createAssetSlice, type AssetSlice } from "./assetSlice";
import { createStyleguideSlice, type StyleguideSlice } from "./styleguideSlice";
import type { ComfyWorkflowSummary } from "../types";

interface WorkflowSlice {
  workflows: ComfyWorkflowSummary[];
  loadingWorkflows: boolean;
  loadWorkflows: () => Promise<void>;
  toggleWorkflow: (id: string, enabled: boolean) => Promise<void>;
}

interface UndoSlice {
  canUndo: boolean;
  canRedo: boolean;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  refreshUndoState: () => Promise<void>;
}

interface SettingsSlice {
  settings: Record<string, string>;
  loadSettings: () => Promise<void>;
  updateSettings: (data: Record<string, string>) => Promise<void>;
  showSettings: boolean;
  setShowSettings: (v: boolean) => void;
}

export type AppState =
  & ProjectSlice
  & ImageSlice
  & RegionEditorSlice
  & ChatSlice
  & AssetSlice
  & StyleguideSlice
  & FolderSlice
  & UndoSlice
  & SettingsSlice
  & WorkflowSlice;

export const useStore = create<AppState>((...a) => {
  const [set, get] = a;
  return {
    ...createProjectSlice(...a),
    ...createImageSlice(...a),
    ...createRegionEditorSlice(...a),
    ...createChatSlice(...a),
    ...createFolderSlice(...a),
    ...createAssetSlice(...a),
    ...createStyleguideSlice(...a),

    // Undo/Redo
    canUndo: false,
    canRedo: false,
    undo: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const result = await api.undo(project.id);
        set({ canUndo: result.canUndo, canRedo: result.canRedo });
        if (result.success) await get().loadImages();
      } catch (e) { console.error("[store] undo failed", e); }
    },
    redo: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const result = await api.redo(project.id);
        set({ canUndo: result.canUndo, canRedo: result.canRedo });
        if (result.success) await get().loadImages();
      } catch (e) { console.error("[store] redo failed", e); }
    },
    refreshUndoState: async () => {
      const project = get().project;
      if (!project) return;
      try {
        const history = await api.getHistory(project.id);
        set({ canUndo: history.canUndo, canRedo: history.canRedo });
      } catch {}
    },

    // Settings
    settings: {},
    loadSettings: async () => {
      const settings = await api.getSettings();
      set({ settings });
    },
    updateSettings: async (data) => {
      const settings = await api.updateSettings(data);
      set({ settings });
    },
    showSettings: false,
    setShowSettings: (v) => set({ showSettings: v }),

    // Workflows
    workflows: [],
    loadingWorkflows: false,
    loadWorkflows: async () => {
      set({ loadingWorkflows: true });
      try {
        const workflows = await api.listComfyWorkflows();
        set({ workflows });
      } catch {}
      set({ loadingWorkflows: false });
    },
    toggleWorkflow: async (id, enabled) => {
      const updated = await api.updateComfyWorkflow(id, { enabled });
      set({
        workflows: get().workflows.map((wf) =>
          wf.id === id ? { ...wf, enabled: updated.enabled } : wf
        ),
      });
    },
  };
});
