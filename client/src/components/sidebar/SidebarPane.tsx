import { useState, useRef, useCallback, useEffect } from "react";
import { useStore } from "../../store";
import type { Folder, Project } from "../../types";
import { AssetBrowser } from "./AssetBrowser";
import { StyleguideBrowser } from "./StyleguideBrowser";
import { NewProjectDialog } from "./NewProjectDialog";
import { Icon, type IconName } from "../ui/Icon";

export function SidebarPane() {
  const projects = useStore((s) => s.projects);
  const project = useStore((s) => s.project);
  const loadProject = useStore((s) => s.loadProject);
  const deleteProject = useStore((s) => s.deleteProject);
  const cloneProject = useStore((s) => s.cloneProject);
  const folders = useStore((s) => s.folders);
  const collapsedFolders = useStore((s) => s.collapsedFolders);
  const createFolder = useStore((s) => s.createFolder);
  const deleteFolder = useStore((s) => s.deleteFolder);
  const updateFolder = useStore((s) => s.updateFolder);
  const toggleFolderCollapsed = useStore((s) => s.toggleFolderCollapsed);
  const moveProjectToFolder = useStore((s) => s.moveProjectToFolder);

  const activeStyleguideId = useStore((s) => s.activeStyleguideId);
  const [sidebarTab, setSidebarTab] = useState<"projects" | "assets" | "styleguides">(
    activeStyleguideId ? "styleguides" : "projects"
  );
  useEffect(() => {
    // Auto-switch to the tab that matches the active entity.
    if (activeStyleguideId) setSidebarTab("styleguides");
    else if (project) setSidebarTab((tab) => (tab === "styleguides" ? "projects" : tab));
  }, [activeStyleguideId, project]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [search, setSearch] = useState("");
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [contextMenu, setContextMenu] = useState<
    | { x: number; y: number; kind: "folder"; folderId: string }
    | { x: number; y: number; kind: "project"; projectId: string }
    | null
  >(null);
  const [cloningId, setCloningId] = useState<string | null>(null);
  const dragData = useRef<{ type: "project"; id: string } | null>(null);

  const handleCreateFolder = async () => {
    await createFolder("New Folder");
  };

  const startRenamingFolder = useCallback((id: string) => {
    const folder = useStore.getState().folders.find((f) => f.id === id);
    if (!folder) return;
    setContextMenu(null);
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
  }, []);

  const finishRenamingFolder = async () => {
    if (editingFolderId && editingFolderName.trim()) {
      await updateFolder(editingFolderId, { name: editingFolderName.trim() });
    }
    setEditingFolderId(null);
    setEditingFolderName("");
  };

  const handleFolderContextMenu = (e: React.MouseEvent, folderId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, kind: "folder", folderId });
  };

  const handleProjectContextMenu = (e: React.MouseEvent, projectId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, kind: "project", projectId });
  };

  const handleCloneProject = async (projectId: string) => {
    setContextMenu(null);
    setCloningId(projectId);
    try {
      await cloneProject(projectId);
    } catch (err) {
      console.error("Failed to clone project", err);
      alert(`Clone failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCloningId(null);
    }
  };

  // Drag handlers
  const onDragStart = (e: React.DragEvent, projectId: string) => {
    dragData.current = { type: "project", id: projectId };
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", projectId);
  };

  const onDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverId(targetId);
  };

  const onDragLeave = () => {
    setDragOverId(null);
  };

  const onDrop = async (e: React.DragEvent, folderId: string | null) => {
    e.preventDefault();
    setDragOverId(null);
    if (dragData.current?.type === "project") {
      await moveProjectToFolder(dragData.current.id, folderId);
    }
    dragData.current = null;
  };

  // Group projects by folder (filter by search term)
  const q = search.trim().toLowerCase();
  const filtered = q
    ? projects.filter((p) => p.name.toLowerCase().includes(q))
    : projects;
  const rootProjects = filtered.filter((p) => !p.folderId);
  const projectsByFolder = new Map<string, Project[]>();
  for (const p of filtered) {
    if (p.folderId) {
      const list = projectsByFolder.get(p.folderId) || [];
      list.push(p);
      projectsByFolder.set(p.folderId, list);
    }
  }

  // Only top-level folders (no nesting for now)
  const topFolders = folders.filter((f) => !f.parentId);

  const renderProject = (p: Project) => {
    const isActive = project?.id === p.id;
    const isCloning = cloningId === p.id;
    return (
      <div
        key={p.id}
        draggable
        onDragStart={(e) => onDragStart(e, p.id)}
        onContextMenu={(e) => handleProjectContextMenu(e, p.id)}
        className={`relative flex items-center justify-between pl-3 pr-2 py-1.5 rounded-[5px] cursor-pointer text-xs group ${
          isActive
            ? "text-fg-1 border border-blue-500/25 bg-gradient-to-b from-blue-500/[0.18] to-blue-500/[0.08]"
            : "border border-transparent text-fg-muted hover:bg-zinc-700/40 hover:text-fg-2"
        } ${isCloning ? "opacity-60" : ""}`}
        onClick={() => loadProject(p.id)}
      >
        {isActive && (
          <span
            className="absolute left-0 top-1 bottom-1 w-[2px] rounded-r-sm bg-blue-500"
            style={{ boxShadow: "0 0 8px rgba(59,130,246,0.6)" }}
            aria-hidden="true"
          />
        )}
        <span className="truncate">
          {p.name}
          {isCloning && <span className="ml-1 text-fg-faint italic">(cloning...)</span>}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete "${p.name}"?`)) deleteProject(p.id);
          }}
          className="text-fg-faint hover:text-red-400 ml-1 opacity-0 group-hover:opacity-100"
          title="Delete project"
        >
          ×
        </button>
      </div>
    );
  };

  return (
    <div
      className="h-full flex flex-col text-sm"
      style={{ background: "linear-gradient(180deg, #16161a 0%, #131316 100%)" }}
    >
      {/* Search bar */}
      <div className="px-3 pt-3 pb-2 shrink-0">
        <div className="relative">
          <Icon
            name="search"
            size={11}
            className="absolute left-2 top-1/2 -translate-y-1/2 text-fg-faint pointer-events-none"
          />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search projects..."
            className="w-full bg-bg-input border border-border-subtle rounded-[5px] text-[11px] text-fg-2 placeholder:text-fg-faint pl-7 pr-12 py-1.5 focus:outline-none focus:border-accent"
          />
          <span
            className="absolute right-2 top-1/2 -translate-y-1/2 px-1 py-0.5 rounded-sm border border-white/10 bg-black/25 text-fg-faint text-[9px] pointer-events-none"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            ⌘K
          </span>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex px-2 gap-0.5 border-b border-border-subtle shrink-0">
        <SidebarTab
          icon="folder"
          label="Projects"
          active={sidebarTab === "projects"}
          onClick={() => setSidebarTab("projects")}
        />
        <SidebarTab
          icon="image"
          label="Assets"
          active={sidebarTab === "assets"}
          onClick={() => setSidebarTab("assets")}
        />
        <SidebarTab
          icon="type"
          label="Styleguides"
          active={sidebarTab === "styleguides"}
          onClick={() => setSidebarTab("styleguides")}
        />
      </div>

      {sidebarTab === "assets" ? (
        <AssetBrowser />
      ) : sidebarTab === "styleguides" ? (
        <StyleguideBrowser />
      ) : (
      <div className="flex-1 flex flex-col p-3 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-fg-faint text-[9.5px] uppercase tracking-[0.1em]">
          Projects
        </div>
        <button
          onClick={handleCreateFolder}
          className="text-fg-faint hover:text-fg-muted text-[10px] px-1"
          title="New folder"
        >
          + Folder
        </button>
      </div>

      <div className="mb-3">
        <button
          onClick={() => setShowNewProject(true)}
          className="w-full text-xs px-2 py-1.5 rounded-[5px] bg-accent hover:bg-accent-hover text-white flex items-center justify-center gap-1"
        >
          <span className="text-sm leading-none">+</span>
          <span>New project</span>
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto space-y-1"
        onClick={() => setContextMenu(null)}
      >
        {/* Folders */}
        {topFolders.map((folder) => {
          const isCollapsed = collapsedFolders.has(folder.id);
          const folderProjects = projectsByFolder.get(folder.id) || [];
          const isDragOver = dragOverId === folder.id;

          return (
            <div key={folder.id}>
              <div
                className={`flex items-center px-2 py-1.5 rounded text-xs group cursor-pointer select-none ${
                  isDragOver
                    ? "bg-blue-600/20 border border-blue-500/50"
                    : "text-zinc-300 hover:bg-zinc-800"
                }`}
                onDragOver={(e) => onDragOver(e, folder.id)}
                onDragLeave={onDragLeave}
                onDrop={(e) => onDrop(e, folder.id)}
                onClick={() => toggleFolderCollapsed(folder.id)}
                onContextMenu={(e) => handleFolderContextMenu(e, folder.id)}
              >
                <span className="mr-1 text-zinc-500 w-3 text-center select-none">
                  {isCollapsed ? "\u25B6" : "\u25BC"}
                </span>
                <span className="mr-1.5 text-zinc-500">
                  {isCollapsed ? "\uD83D\uDCC1" : "\uD83D\uDCC2"}
                </span>
                {editingFolderId === folder.id ? (
                  <input
                    autoFocus
                    value={editingFolderName}
                    onChange={(e) => setEditingFolderName(e.target.value)}
                    onBlur={finishRenamingFolder}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") finishRenamingFolder();
                      if (e.key === "Escape") {
                        setEditingFolderId(null);
                        setEditingFolderName("");
                      }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 bg-zinc-700 text-zinc-200 text-xs px-1 py-0 rounded border border-zinc-600 focus:outline-none focus:border-blue-500"
                  />
                ) : (
                  <span className="flex-1 truncate">{folder.name}</span>
                )}
                <span className="text-zinc-600 text-[10px] ml-1">
                  {folderProjects.length}
                </span>
              </div>
              {!isCollapsed && (
                <div className="ml-4 space-y-0.5 mt-0.5">
                  {folderProjects.length === 0 && (
                    <div className="text-zinc-600 text-[10px] px-2 py-1 italic">
                      Drop projects here
                    </div>
                  )}
                  {folderProjects.map(renderProject)}
                </div>
              )}
            </div>
          );
        })}

        {/* Root-level projects (not in any folder) */}
        <div
          className={`space-y-0.5 ${
            dragOverId === "__root" ? "bg-blue-600/10 rounded" : ""
          }`}
          onDragOver={(e) => onDragOver(e, "__root")}
          onDragLeave={onDragLeave}
          onDrop={(e) => onDrop(e, null)}
        >
          {rootProjects.map(renderProject)}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-zinc-800 border border-zinc-700 rounded shadow-lg py-1 min-w-[140px] text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseLeave={() => setContextMenu(null)}
        >
          {contextMenu.kind === "folder" ? (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                onClick={() => startRenamingFolder(contextMenu.folderId)}
              >
                Rename
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-zinc-700"
                onClick={() => {
                  const folder = folders.find((f) => f.id === contextMenu.folderId);
                  setContextMenu(null);
                  if (folder && confirm(`Delete folder "${folder.name}"? Projects will be moved to root.`)) {
                    deleteFolder(folder.id);
                  }
                }}
              >
                Delete
              </button>
            </>
          ) : (
            <>
              <button
                className="w-full text-left px-3 py-1.5 text-zinc-200 hover:bg-zinc-700"
                onClick={() => handleCloneProject(contextMenu.projectId)}
              >
                Clone
              </button>
              <button
                className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-zinc-700"
                onClick={() => {
                  const p = projects.find((x) => x.id === contextMenu.projectId);
                  setContextMenu(null);
                  if (p && confirm(`Delete "${p.name}"?`)) deleteProject(p.id);
                }}
              >
                Delete
              </button>
            </>
          )}
        </div>
      )}
      </div>
      )}

      {showNewProject && (
        <NewProjectDialog onClose={() => setShowNewProject(false)} />
      )}
    </div>
  );
}

function SidebarTab({
  icon,
  label,
  active,
  onClick,
}: {
  icon: IconName;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 flex items-center justify-center gap-1 py-1.5 text-[10.5px] font-medium rounded-t-[5px] -mb-px transition-colors duration-[120ms] ${
        active
          ? "text-fg-2 bg-bg-elevated border border-border-subtle border-b-transparent"
          : "text-fg-faint hover:text-fg-3 border border-transparent"
      }`}
    >
      <Icon name={icon} size={11} />
      {label}
    </button>
  );
}
