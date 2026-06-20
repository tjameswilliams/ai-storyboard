import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { Asset } from "../types";
import type { AppState } from "./index";

export interface AssetSlice {
  assets: Asset[];
  assetsLoading: boolean;
  assetFilter: { type?: string; search?: string };
  selectedAssetId: string | null;
  loadAssets: () => Promise<void>;
  searchAssets: (query: string) => Promise<void>;
  setAssetFilter: (filter: Partial<AssetSlice["assetFilter"]>) => void;
  selectAsset: (id: string | null) => void;
  toggleAssetFavorite: (id: string) => Promise<void>;
  updateAssetMetadata: (id: string, data: { description?: string; fileName?: string; tags?: string[] }) => Promise<void>;
  regenerateAssetDescription: (id: string, prompt?: string) => Promise<void>;
  deleteAsset: (id: string) => Promise<void>;
}

export const createAssetSlice: StateCreator<AppState, [], [], AssetSlice> = (set, get) => ({
  assets: [],
  assetsLoading: false,
  assetFilter: {},
  selectedAssetId: null,

  loadAssets: async () => {
    const project = get().project;
    if (!project) return;
    set({ assetsLoading: true });
    try {
      const assets = await api.listAssets(project.id, { type: get().assetFilter.type, limit: 100 });
      set({ assets, assetsLoading: false });
    } catch {
      set({ assetsLoading: false });
    }
  },

  searchAssets: async (query: string) => {
    const project = get().project;
    if (!project) return;
    set({ assetsLoading: true });
    try {
      const assets = await api.searchAssets(project.id, query, get().assetFilter.type);
      set({ assets, assetsLoading: false });
    } catch {
      set({ assetsLoading: false });
    }
  },

  setAssetFilter: (filter) => {
    set({ assetFilter: { ...get().assetFilter, ...filter } });
    // Reload with new filter
    get().loadAssets();
  },

  selectAsset: (id) => set({ selectedAssetId: id }),

  toggleAssetFavorite: async (id: string) => {
    const asset = get().assets.find((a) => a.id === id);
    if (!asset) return;
    await api.updateAsset(id, { favorite: asset.favorite !== 1 });
    await get().loadAssets();
  },

  updateAssetMetadata: async (id, data) => {
    const updated = await api.updateAsset(id, data);
    set({ assets: get().assets.map((a) => (a.id === id ? updated : a)) });
  },

  regenerateAssetDescription: async (id, prompt) => {
    const updated = await api.regenerateAssetDescription(id, prompt);
    set({ assets: get().assets.map((a) => (a.id === id ? updated : a)) });
  },

  deleteAsset: async (id: string) => {
    await api.deleteAsset(id, true);
    if (get().selectedAssetId === id) set({ selectedAssetId: null });
    await get().loadAssets();
  },
});
