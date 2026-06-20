import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { StoryboardImage, Layout } from "../types";
import type { AppState } from "./index";

const GRID_KEY = "sb.gridColumns";

function initGridColumns(): number {
  try {
    const v = localStorage.getItem(GRID_KEY);
    if (v) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n >= 2 && n <= 8) return n;
    }
  } catch {
    /* ignore */
  }
  return 4;
}

// Module-level debounce timers for layout persistence, keyed by image id.
const patchTimers = new Map<string, ReturnType<typeof setTimeout>>();
const PATCH_DELAY = 400;

export interface ImageSlice {
  images: StoryboardImage[];
  selectedImageId: string | null;
  gridColumns: number;
  generatingImageIds: Set<string>;
  // Fullscreen "display" viewer — index into `images`, or null when closed.
  viewerIndex: number | null;

  loadImages: () => Promise<void>;
  selectImage: (id: string | null) => void;
  addImage: (afterId?: string) => Promise<void>;
  deleteImage: (id: string) => Promise<void>;
  reorderImages: (orderedIds: string[]) => Promise<void>;
  updateImageLayout: (id: string, layout: Layout) => Promise<void>;
  patchImageLayout: (id: string, layout: Layout) => void;
  generateImage: (id: string, opts?: { regenerate?: boolean }) => Promise<void>;
  setGridColumns: (n: number) => void;
  openViewer: (index?: number) => void;
  closeViewer: () => void;
  stepViewer: (delta: number) => void;
}

export const createImageSlice: StateCreator<AppState, [], [], ImageSlice> = (set, get) => ({
  images: [],
  selectedImageId: null,
  gridColumns: initGridColumns(),
  generatingImageIds: new Set<string>(),
  viewerIndex: null,

  loadImages: async () => {
    const project = get().project;
    if (!project) {
      set({ images: [] });
      return;
    }
    const images = await api.listImages(project.id);
    set({ images });
  },

  selectImage: (id) => {
    const prevScope = get().chatScope;
    set({
      selectedImageId: id,
      selectedRegionIndex: null,
      hoveredRegionIndex: null,
      dragPreview: null,
      jsonError: null,
    });
    // Keep the image-scoped side chat pointed at the right frame: reload it when
    // switching frames, and fall back to the project conversation on deselect.
    if (prevScope === "image") {
      if (!id) {
        get().setChatScope("project");
      } else {
        get().loadMessages();
      }
    }
  },

  addImage: async (afterId) => {
    const project = get().project;
    if (!project) return;
    await api.createImage(project.id, afterId ? { afterImageId: afterId } : {});
    await get().loadImages();
  },

  deleteImage: async (id) => {
    await api.deleteImage(id);
    if (get().selectedImageId === id) get().selectImage(null);
    await get().loadImages();
  },

  reorderImages: async (orderedIds) => {
    const project = get().project;
    if (!project) return;
    // Optimistic local reorder.
    const byId = new Map(get().images.map((img) => [img.id, img]));
    const reordered = orderedIds
      .map((id, i) => {
        const img = byId.get(id);
        return img ? { ...img, order: i } : null;
      })
      .filter((x): x is StoryboardImage => x !== null);
    set({ images: reordered });
    try {
      const fresh = await api.reorderImages(project.id, orderedIds);
      set({ images: fresh });
    } catch (e) {
      console.error("[store] reorder failed", e);
      await get().loadImages();
    }
  },

  updateImageLayout: async (id, layout) => {
    const updated = await api.updateImage(id, { layout });
    set({ images: get().images.map((img) => (img.id === id ? updated : img)) });
  },

  patchImageLayout: (id, layout) => {
    // Optimistic local merge.
    set({
      images: get().images.map((img) => (img.id === id ? { ...img, layout } : img)),
    });
    // Debounced persist.
    const existing = patchTimers.get(id);
    if (existing) clearTimeout(existing);
    patchTimers.set(
      id,
      setTimeout(() => {
        patchTimers.delete(id);
        api
          .updateImage(id, { layout })
          .then((updated) => {
            // Reconcile (e.g. fresh region ids) without clobbering newer edits.
            set({
              images: get().images.map((img) =>
                img.id === id ? { ...img, layout: updated.layout, updatedAt: updated.updatedAt } : img,
              ),
            });
          })
          .catch((e) => console.error("[store] patchImageLayout persist failed", e));
      }, PATCH_DELAY),
    );
  },

  generateImage: async (id, opts) => {
    const next = new Set(get().generatingImageIds);
    next.add(id);
    set({ generatingImageIds: next });
    try {
      const updated = opts?.regenerate
        ? await api.regenerateImage(id)
        : await api.generateImage(id);
      set({ images: get().images.map((img) => (img.id === id ? updated : img)) });
    } catch (e) {
      console.error("[store] generateImage failed", e);
      // Reload to pick up the failed status / lastError the server recorded.
      await get().loadImages();
    } finally {
      const after = new Set(get().generatingImageIds);
      after.delete(id);
      set({ generatingImageIds: after });
    }
  },

  setGridColumns: (n) => {
    const clamped = Math.max(2, Math.min(8, Math.round(n)));
    set({ gridColumns: clamped });
    try {
      localStorage.setItem(GRID_KEY, String(clamped));
    } catch {
      /* ignore */
    }
  },

  openViewer: (index) => {
    const images = get().images;
    if (images.length === 0) return;
    let start = index ?? 0;
    // Default to the currently selected frame if one is open.
    if (index === undefined && get().selectedImageId) {
      const i = images.findIndex((img) => img.id === get().selectedImageId);
      if (i >= 0) start = i;
    }
    set({ viewerIndex: Math.max(0, Math.min(images.length - 1, start)) });
  },
  closeViewer: () => set({ viewerIndex: null }),
  stepViewer: (delta) => {
    const { viewerIndex, images } = get();
    if (viewerIndex === null || images.length === 0) return;
    const next = (viewerIndex + delta + images.length) % images.length;
    set({ viewerIndex: next });
  },
});
