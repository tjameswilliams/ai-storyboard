import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { StoryboardCell } from "./StoryboardCell";
import { ExportModal } from "./ExportModal";

export function StoryboardGrid() {
  const project = useStore((s) => s.project)!;
  const images = useStore((s) => s.images);
  const gridColumns = useStore((s) => s.gridColumns);
  const setGridColumns = useStore((s) => s.setGridColumns);
  const addImage = useStore((s) => s.addImage);
  const reorderImages = useStore((s) => s.reorderImages);
  const openViewer = useStore((s) => s.openViewer);
  const regenerateAll = useStore((s) => s.regenerateAll);
  const generateImage = useStore((s) => s.generateImage);
  const deleteImage = useStore((s) => s.deleteImage);
  const selectImage = useStore((s) => s.selectImage);
  const anyGenerating = useStore((s) => s.generatingImageIds.size > 0);

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);
  const [cellMenu, setCellMenu] = useState<{ x: number; y: number; imageId: string; index: number } | null>(null);

  // Close the cell context menu on outside click / Escape.
  useEffect(() => {
    if (!cellMenu) return;
    const close = () => setCellMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setCellMenu(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [cellMenu]);

  const handleRegenerateAll = () => {
    if (anyGenerating) return;
    const n = images.filter((i) => i.layout?.high_level_description?.trim() || (i.layout?.compositional_deconstruction?.length ?? 0) > 0 || i.plainPrompt?.trim()).length;
    if (n === 0) return;
    if (window.confirm(`Regenerate ${n} frame${n === 1 ? "" : "s"}? This re-runs the workflow for each (new seeds) and overwrites their current images.`)) {
      regenerateAll();
    }
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) {
      setDragId(null);
      setDropBeforeId(null);
      return;
    }
    const ids = images.map((i) => i.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    ids.splice(from, 1);
    const insertAt = ids.indexOf(targetId);
    ids.splice(insertAt, 0, dragId);
    reorderImages(ids);
    setDragId(null);
    setDropBeforeId(null);
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Toolbar */}
      <div className="h-11 flex items-center gap-3 px-4 border-b border-zinc-800 shrink-0">
        <span className="text-xs text-zinc-400">
          {images.length} {images.length === 1 ? "frame" : "frames"}
        </span>
        <button
          onClick={() => addImage()}
          className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
        >
          + Add image
        </button>
        <button
          onClick={() => openViewer(0)}
          disabled={images.length === 0}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40"
          title="Display mode — view frames fullscreen"
        >
          ▶ Display
        </button>
        <button
          onClick={() => setShowExport(true)}
          disabled={images.length === 0}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40"
          title="Export as ZIP or PDF"
        >
          ⬇ Export
        </button>
        <button
          onClick={handleRegenerateAll}
          disabled={images.length === 0 || anyGenerating}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40"
          title="Regenerate every frame that has content"
        >
          {anyGenerating ? "Regenerating…" : "⟳ Regenerate all"}
        </button>

        <div className="flex-1" />

        {/* Column count control */}
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-500">Columns</span>
          <input
            type="range"
            min={2}
            max={8}
            value={gridColumns}
            onChange={(e) => setGridColumns(parseInt(e.target.value, 10))}
            className="w-24 accent-blue-500"
          />
          <div className="flex gap-0.5">
            {[2, 3, 4, 6].map((n) => (
              <button
                key={n}
                onClick={() => setGridColumns(n)}
                className={`text-[10px] w-6 py-0.5 rounded border ${
                  gridColumns === n
                    ? "border-blue-500/40 bg-blue-500/15 text-blue-200"
                    : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                }`}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        {images.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-sm gap-3">
            <p>No frames yet</p>
            <button
              onClick={() => addImage()}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white"
            >
              + Add your first image
            </button>
          </div>
        ) : (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))` }}
          >
            {images.map((image, index) => (
              <div key={image.id} className="relative">
                {dropBeforeId === image.id && dragId && (
                  <div className="absolute -left-1.5 top-0 bottom-0 w-0.5 bg-blue-500 rounded-full z-10" />
                )}
                <StoryboardCell
                  image={image}
                  index={index}
                  project={project}
                  isDragging={dragId === image.id}
                  onDragStart={(e) => {
                    setDragId(image.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragId(null);
                    setDropBeforeId(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dragId && dragId !== image.id) setDropBeforeId(image.id);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    handleDrop(image.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setCellMenu({ x: e.clientX, y: e.clientY, imageId: image.id, index });
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Per-frame right-click menu */}
      {cellMenu && (
        <div
          className="fixed z-50 min-w-[170px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1 text-xs"
          style={{ left: cellMenu.x, top: cellMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
            Frame {cellMenu.index + 1}
          </div>
          <button
            onMouseDown={(e) => { e.stopPropagation(); selectImage(cellMenu.imageId); setCellMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
          >
            Open editor
          </button>
          <button
            onMouseDown={(e) => { e.stopPropagation(); generateImage(cellMenu.imageId, { regenerate: true }); setCellMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
          >
            Regenerate
          </button>
          <button
            onMouseDown={(e) => { e.stopPropagation(); openViewer(cellMenu.index); setCellMenu(null); }}
            className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
          >
            Display from here
          </button>
          <div className="my-1 border-t border-zinc-800" />
          <button
            onMouseDown={(e) => {
              e.stopPropagation();
              const idx = cellMenu.index;
              const id = cellMenu.imageId;
              setCellMenu(null);
              if (window.confirm(`Delete frame ${idx + 1}? This can't be undone.`)) deleteImage(id);
            }}
            className="w-full text-left px-3 py-1.5 text-red-400 hover:bg-red-950/40"
          >
            Delete frame
          </button>
        </div>
      )}

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </div>
  );
}
