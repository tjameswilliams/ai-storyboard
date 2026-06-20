import { useState } from "react";
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

  const [dragId, setDragId] = useState<string | null>(null);
  const [dropBeforeId, setDropBeforeId] = useState<string | null>(null);
  const [showExport, setShowExport] = useState(false);

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
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {showExport && <ExportModal onClose={() => setShowExport(false)} />}
    </div>
  );
}
