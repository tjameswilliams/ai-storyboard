import { useEffect, useRef, useState, useCallback } from "react";
import { useStore } from "./store";
import { SidebarPane } from "./components/sidebar/SidebarPane";
import { StoryboardPane } from "./components/storyboard/StoryboardPane";
import { ChatPane } from "./components/chat/ChatPane";
import { SettingsModal } from "./components/SettingsModal";
import { StyleguidePickerButton } from "./components/styleguide/StyleguidePickerPopover";
import { IconButton } from "./components/ui/IconButton";
import { Icon } from "./components/ui/Icon";

export default function App() {
  const project = useStore((s) => s.project);
  const loadProjects = useStore((s) => s.loadProjects);
  const projects = useStore((s) => s.projects);
  const loadProject = useStore((s) => s.loadProject);
  const activeStyleguideId = useStore((s) => s.activeStyleguideId);
  const activeStyleguide = useStore((s) => s.activeStyleguide);
  const loadStyleguide = useStore((s) => s.loadStyleguide);
  const loadStyleguides = useStore((s) => s.loadStyleguides);
  const showSettings = useStore((s) => s.showSettings);
  const loadSettings = useStore((s) => s.loadSettings);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const undo = useStore((s) => s.undo);
  const redo = useStore((s) => s.redo);
  const initializedRef = useRef(false);

  const [sidebarWidth, setSidebarWidth] = useState(220);
  const [chatWidth, setChatWidth] = useState(380);
  const dragging = useRef<{ target: "sidebar" | "chat"; startX: number; startW: number } | null>(null);

  const loadFolders = useStore((s) => s.loadFolders);

  useEffect(() => {
    loadProjects();
    loadFolders();
    loadSettings();
    loadStyleguides();
  }, []);

  useEffect(() => {
    if (initializedRef.current || projects.length === 0) return;
    initializedRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const urlStyleguideId = params.get("styleguide");
    if (urlStyleguideId) {
      loadStyleguide(urlStyleguideId);
      return;
    }
    // Restore the project to open: URL param wins, then the last project opened
    // before shutdown (Electron restarts at a bare URL), then the first project.
    const urlProjectId = params.get("project");
    const lastProjectId = (() => {
      try { return localStorage.getItem("sb.lastProjectId"); } catch { return null; }
    })();
    const valid = (id: string | null | undefined) => !!id && projects.some((p) => p.id === id);
    const targetId = valid(urlProjectId)
      ? urlProjectId!
      : valid(lastProjectId)
        ? lastProjectId!
        : projects[0].id;
    loadProject(targetId);
  }, [projects]);

  useEffect(() => {
    const url = new URL(window.location.href);
    if (activeStyleguideId) {
      url.searchParams.set("styleguide", activeStyleguideId);
      url.searchParams.delete("project");
    } else if (project) {
      url.searchParams.set("project", project.id);
      url.searchParams.delete("styleguide");
      // Remember the last opened project so it reopens after an app restart.
      try { localStorage.setItem("sb.lastProjectId", project.id); } catch { /* ignore */ }
    } else {
      return;
    }
    window.history.replaceState({}, "", url.toString());
  }, [project, activeStyleguideId]);

  const onMouseDown = useCallback((target: "sidebar" | "chat", e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = {
      target,
      startX: e.clientX,
      startW: target === "sidebar" ? sidebarWidth : chatWidth,
    };
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      const dx = ev.clientX - dragging.current.startX;
      if (dragging.current.target === "sidebar") {
        setSidebarWidth(Math.max(160, Math.min(400, dragging.current.startW + dx)));
      } else {
        setChatWidth(Math.max(280, Math.min(600, dragging.current.startW - dx)));
      }
    };
    const onUp = () => {
      dragging.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth, chatWidth]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
      {/* Top bar */}
      <div
        className="h-11 flex items-center gap-2 px-3 border-b border-border-subtle shrink-0"
        style={{
          background: "linear-gradient(180deg, #1c1c20 0%, #16161a 100%)",
          boxShadow: "0 1px 0 rgba(255,255,255,0.02) inset, 0 1px 0 rgba(0,0,0,0.4)",
        }}
      >
        <BrandLogo />
        <span className="text-[12px] font-medium text-fg-2 tracking-tight">AI Storyboard</span>

        {(activeStyleguide || project) && (
          <div className="flex items-center gap-1.5 ml-2 min-w-0">
            <Icon name="folder" size={12} className="text-fg-subtle shrink-0" />
            {activeStyleguide ? (
              <>
                <span className="text-[12px] text-fg-muted">Styleguides</span>
                <span className="text-[12px] text-border-default">/</span>
                <span className="text-[12px] font-medium text-fg-2 truncate" style={{ maxWidth: 240 }}>
                  {activeStyleguide.name}
                </span>
              </>
            ) : project ? (
              <span className="text-[12px] font-medium text-fg-2 truncate" style={{ maxWidth: 240 }}>
                {project.name}
              </span>
            ) : null}
          </div>
        )}

        <div className="flex-1" />

        {project && !activeStyleguideId && (
          <div className="flex items-center gap-1 mr-1">
            <button
              onClick={() => undo()}
              disabled={!canUndo}
              title="Undo"
              className="text-[11px] px-1.5 py-0.5 rounded text-fg-muted hover:text-fg-2 hover:bg-zinc-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Undo
            </button>
            <button
              onClick={() => redo()}
              disabled={!canRedo}
              title="Redo"
              className="text-[11px] px-1.5 py-0.5 rounded text-fg-muted hover:text-fg-2 hover:bg-zinc-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Redo
            </button>
          </div>
        )}

        {project && !activeStyleguideId && <StyleguidePickerButton />}
        <IconButton
          icon="settings"
          tooltip="Settings"
          size="sm"
          onClick={() => useStore.getState().setShowSettings(true)}
        />
      </div>

      {/* Main content */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        <div style={{ width: sidebarWidth }} className="shrink-0 border-r border-zinc-800 bg-zinc-900">
          <SidebarPane />
        </div>

        {/* Sidebar resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 shrink-0"
          onMouseDown={(e) => onMouseDown("sidebar", e)}
        />

        {/* Center (storyboard) */}
        <div className="flex-1 min-w-0">
          <StoryboardPane />
        </div>

        {/* Chat resize handle */}
        <div
          className="w-1 cursor-col-resize hover:bg-blue-500/30 active:bg-blue-500/50 shrink-0"
          onMouseDown={(e) => onMouseDown("chat", e)}
        />

        {/* Chat */}
        <div style={{ width: chatWidth }} className="shrink-0 border-l border-zinc-800 bg-zinc-900">
          <ChatPane />
        </div>
      </div>

      {showSettings && <SettingsModal />}
    </div>
  );
}

function BrandLogo() {
  return (
    <div
      className="relative w-[22px] h-[22px] rounded-[5px] shrink-0 flex items-center justify-center"
      style={{ background: "var(--brand-gradient)" }}
      aria-hidden="true"
    >
      <div className="absolute inset-[2px] rounded-[3px] bg-white/5 border border-white/10" />
      <svg className="relative" width="9" height="9" viewBox="0 0 24 24" fill="white">
        <path d="M6 4l14 8-14 8z" />
      </svg>
    </div>
  );
}
