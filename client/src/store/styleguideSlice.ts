import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { Styleguide, StyleguideBrandAsset, AttachedStyleguideSummary } from "../types";
import type { AppState } from "./index";

export type StyleguideBuilderTab = "markdown" | "assets" | "animations";

export interface StyleguideSlice {
  styleguides: Styleguide[];
  activeStyleguideId: string | null;
  activeStyleguide: Styleguide | null;
  styleguidesLoading: boolean;
  styleguideBuilderTab: StyleguideBuilderTab;

  /** Styleguides attached to the currently-loaded project. Kept in sync via attach/detach. */
  projectStyleguides: AttachedStyleguideSummary[];

  loadStyleguides: () => Promise<void>;
  loadStyleguide: (id: string) => Promise<void>;
  /** Re-fetch only the active styleguide's detail (markdown/assets) without
   *  touching the chat conversation — safe to call mid-run. */
  refreshActiveStyleguide: () => Promise<void>;
  clearActiveStyleguide: () => void;
  createStyleguide: (name?: string) => Promise<Styleguide>;
  updateStyleguide: (id: string, patch: { name?: string; description?: string; markdown?: string }) => Promise<void>;
  deleteStyleguide: (id: string) => Promise<void>;

  uploadStyleguideAsset: (file: File, role: string, label?: string) => Promise<StyleguideBrandAsset | null>;
  updateStyleguideAsset: (assetId: string, data: { role?: string; label?: string; order?: number }) => Promise<void>;
  deleteStyleguideAsset: (assetId: string) => Promise<void>;

  updateStyleguideAnimation: (animId: string, data: Record<string, unknown>) => Promise<void>;
  deleteStyleguideAnimation: (animId: string) => Promise<void>;

  loadProjectStyleguides: () => Promise<void>;
  attachStyleguide: (styleguideId: string) => Promise<void>;
  detachStyleguide: (styleguideId: string) => Promise<void>;

  setStyleguideBuilderTab: (tab: StyleguideBuilderTab) => void;
}

export const createStyleguideSlice: StateCreator<AppState, [], [], StyleguideSlice> = (set, get) => ({
  styleguides: [],
  activeStyleguideId: null,
  activeStyleguide: null,
  styleguidesLoading: false,
  styleguideBuilderTab: "markdown",
  projectStyleguides: [],

  loadStyleguides: async () => {
    set({ styleguidesLoading: true });
    try {
      const styleguides = await api.listStyleguides();
      set({ styleguides, styleguidesLoading: false });
    } catch {
      set({ styleguidesLoading: false });
    }
  },

  loadStyleguide: async (id) => {
    try {
      const sg = await api.getStyleguide(id);
      set({
        activeStyleguideId: id,
        activeStyleguide: sg,
        // Mutually exclusive with project selection
        project: null,
        images: [],
        selectedImageId: null,
        messages: [],
        messagesLoaded: false,
        contextStatus: null,
        activePlan: null,
      } as Partial<AppState>);
      await get().loadMessages();
    } catch (e) {
      console.error("[styleguide] load failed", e);
    }
  },

  refreshActiveStyleguide: async () => {
    const id = get().activeStyleguideId;
    if (!id) return;
    try {
      const sg = await api.getStyleguide(id);
      set({
        activeStyleguide: sg,
        styleguides: get().styleguides.map((s) => (s.id === id ? { ...s, ...sg } : s)),
      });
    } catch (e) {
      console.error("[styleguide] refresh failed", e);
    }
  },

  clearActiveStyleguide: () => set({ activeStyleguideId: null, activeStyleguide: null }),

  createStyleguide: async (name) => {
    const sg = await api.createStyleguide({ name: name ?? "Untitled Styleguide" });
    await get().loadStyleguides();
    return sg;
  },

  updateStyleguide: async (id, patch) => {
    const updated = await api.updateStyleguide(id, patch);
    // Update both list + active
    set({
      styleguides: get().styleguides.map((s) => s.id === id ? { ...s, ...updated } : s),
      activeStyleguide: get().activeStyleguideId === id ? updated : get().activeStyleguide,
    });
  },

  deleteStyleguide: async (id) => {
    await api.deleteStyleguide(id);
    const wasActive = get().activeStyleguideId === id;
    set({
      styleguides: get().styleguides.filter((s) => s.id !== id),
      ...(wasActive ? { activeStyleguideId: null, activeStyleguide: null } : {}),
    });
  },

  uploadStyleguideAsset: async (file, role, label) => {
    const sgId = get().activeStyleguideId;
    if (!sgId) return null;
    const asset = await api.uploadStyleguideAsset(sgId, file, role, label);
    // Refresh the active styleguide detail
    await get().loadStyleguide(sgId);
    return asset;
  },

  updateStyleguideAsset: async (assetId, data) => {
    const sgId = get().activeStyleguideId;
    if (!sgId) return;
    await api.updateStyleguideAsset(sgId, assetId, data);
    await get().loadStyleguide(sgId);
  },

  deleteStyleguideAsset: async (assetId) => {
    const sgId = get().activeStyleguideId;
    if (!sgId) return;
    await api.deleteStyleguideAsset(sgId, assetId);
    await get().loadStyleguide(sgId);
  },

  updateStyleguideAnimation: async (animId, data) => {
    const sgId = get().activeStyleguideId;
    if (!sgId) return;
    await api.updateStyleguideAnimation(sgId, animId, data);
    await get().loadStyleguide(sgId);
  },

  deleteStyleguideAnimation: async (animId) => {
    const sgId = get().activeStyleguideId;
    if (!sgId) return;
    await api.deleteStyleguideAnimation(sgId, animId);
    await get().loadStyleguide(sgId);
  },

  loadProjectStyleguides: async () => {
    const project = get().project;
    if (!project) {
      set({ projectStyleguides: [] });
      return;
    }
    try {
      const list = await api.listProjectStyleguides(project.id);
      set({ projectStyleguides: list });
    } catch {
      set({ projectStyleguides: [] });
    }
  },

  attachStyleguide: async (styleguideId) => {
    const project = get().project;
    if (!project) return;
    await api.attachStyleguide(project.id, styleguideId);
    await get().loadProjectStyleguides();
  },

  detachStyleguide: async (styleguideId) => {
    const project = get().project;
    if (!project) return;
    await api.detachStyleguide(project.id, styleguideId);
    await get().loadProjectStyleguides();
  },

  setStyleguideBuilderTab: (tab) => set({ styleguideBuilderTab: tab }),
});
