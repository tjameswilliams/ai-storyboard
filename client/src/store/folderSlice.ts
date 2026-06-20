import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { Folder } from "../types";
import type { AppState } from "./index";

export interface FolderSlice {
  folders: Folder[];
  collapsedFolders: Set<string>;
  loadFolders: () => Promise<void>;
  createFolder: (name: string, parentId?: string) => Promise<Folder>;
  updateFolder: (id: string, data: Record<string, unknown>) => Promise<void>;
  deleteFolder: (id: string) => Promise<void>;
  toggleFolderCollapsed: (id: string) => void;
  moveProjectToFolder: (projectId: string, folderId: string | null) => Promise<void>;
}

export const createFolderSlice: StateCreator<AppState, [], [], FolderSlice> = (set, get) => ({
  folders: [],
  collapsedFolders: new Set(),
  loadFolders: async () => {
    const folders = await api.listFolders();
    set({ folders });
  },
  createFolder: async (name: string, parentId?: string) => {
    const folder = await api.createFolder({ name, parentId });
    await get().loadFolders();
    return folder;
  },
  updateFolder: async (id: string, data: Record<string, unknown>) => {
    await api.updateFolder(id, data);
    await get().loadFolders();
  },
  deleteFolder: async (id: string) => {
    await api.deleteFolder(id);
    await get().loadFolders();
    await get().loadProjects();
  },
  toggleFolderCollapsed: (id: string) => {
    const collapsed = new Set(get().collapsedFolders);
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    set({ collapsedFolders: collapsed });
  },
  moveProjectToFolder: async (projectId: string, folderId: string | null) => {
    await api.updateProject(projectId, { folderId });
    await get().loadProjects();
  },
});
