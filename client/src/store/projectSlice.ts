import type { StateCreator } from "zustand";
import { api } from "../api/client";
import type { Project } from "../types";
import type { AppState } from "./index";

export interface ProjectSlice {
  project: Project | null;
  projects: Project[];
  loadProjects: () => Promise<void>;
  loadProject: (id: string) => Promise<void>;
  createProject: (input: {
    name: string;
    aspectRatio: string;
    megapixels: number;
    width: number;
    height: number;
    workflowId?: string;
  }) => Promise<Project>;
  updateProject: (id: string, data: Record<string, unknown>) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  cloneProject: (id: string, newName?: string) => Promise<Project>;
}

export const createProjectSlice: StateCreator<AppState, [], [], ProjectSlice> = (set, get) => ({
  project: null,
  projects: [],
  loadProjects: async () => {
    const projects = await api.listProjects();
    set({ projects });
  },
  loadProject: async (id: string) => {
    // Detach the previous project's focused stream before swapping state, so it
    // can't write into the new project's messages while everything loads.
    get().detachFocusedStream();
    const project = await api.getProject(id);
    // Reset all storyboard + chat state. Clearing activeStyleguideId keeps
    // project/styleguide modes mutually exclusive.
    set({
      project,
      images: [],
      selectedImageId: null,
      selectedRegionIndex: null,
      hoveredRegionIndex: null,
      dragPreview: null,
      jsonError: null,
      messages: [],
      messagesLoaded: false,
      contextStatus: null,
      // Detach the previous project's focused stream (its run keeps running in
      // the background and still reports status via the active-runs poll).
      isStreaming: false,
      focusedRunId: null,
      activeStyleguideId: null,
      activeStyleguide: null,
    });
    await get().loadImages();
    await Promise.all([
      get().loadMessages(),
      get().loadActivePlan(),
      get().loadProjectStyleguides(),
    ]);
    // Attach to the new project's main-thread run if one is in flight.
    await get().focusConversation();
  },
  createProject: async (input) => {
    const project = await api.createProject(input);
    await get().loadProjects();
    await get().loadProject(project.id);
    return project;
  },
  updateProject: async (id: string, data: Record<string, unknown>) => {
    await api.updateProject(id, data);
    await get().loadProjects();
    if (get().project?.id === id) {
      const updated = await api.getProject(id);
      set({ project: updated });
    }
  },
  deleteProject: async (id: string) => {
    await api.deleteProject(id);
    if (get().project?.id === id) {
      set({ project: null, images: [], selectedImageId: null, messages: [] });
    }
    await get().loadProjects();
  },
  cloneProject: async (id: string, newName?: string) => {
    const { project } = await api.cloneProject(id, newName);
    await get().loadProjects();
    await get().loadProject(project.id);
    return project;
  },
});
