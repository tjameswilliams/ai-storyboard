import { useEffect } from "react";
import { useStore } from "../../store";
import { api } from "../../api/client";
import { Icon } from "../ui/Icon";

/**
 * Fullscreen "display" viewer — shows the generated picture for one frame with
 * no bboxes or inspector, and lets the user page through the sequence. Opened
 * from the grid/editor "Display" button.
 */
export function ImageViewerModal() {
  const viewerIndex = useStore((s) => s.viewerIndex);
  const images = useStore((s) => s.images);
  const closeViewer = useStore((s) => s.closeViewer);
  const stepViewer = useStore((s) => s.stepViewer);

  const open = viewerIndex !== null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeViewer();
      else if (e.key === "ArrowLeft") stepViewer(-1);
      else if (e.key === "ArrowRight") stepViewer(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeViewer, stepViewer]);

  if (!open || viewerIndex === null) return null;
  const image = images[viewerIndex];
  if (!image) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/95 flex flex-col select-none"
      onClick={closeViewer}
    >
      {/* Top bar */}
      <div
        className="flex items-center justify-between px-4 h-12 text-zinc-300 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="text-xs font-mono text-zinc-400">
          {viewerIndex + 1} / {images.length}
        </span>
        <span className="text-xs text-zinc-300 truncate px-3 min-w-0">
          {image.name || `Frame ${viewerIndex + 1}`}
        </span>
        <button
          type="button"
          onClick={closeViewer}
          className="p-1.5 rounded hover:bg-white/10 text-zinc-300"
          title="Close (Esc)"
        >
          <Icon name="x" size={18} />
        </button>
      </div>

      {/* Image area */}
      <div className="flex-1 min-h-0 flex items-center justify-center px-16 pb-6" onClick={closeViewer}>
        {image.filePath ? (
          <img
            src={api.mediaUrl(image.filePath)}
            alt={image.name || "frame"}
            className="max-w-full max-h-full object-contain shadow-2xl"
            draggable={false}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <div className="text-zinc-500 text-sm">
            {image.status === "generating" ? "Generating…" : "Not generated yet"}
          </div>
        )}
      </div>

      {/* Prev / Next */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); stepViewer(-1); }}
            className="absolute left-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/15 text-zinc-200"
            title="Previous (←)"
          >
            <Icon name="skipBack" size={20} />
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); stepViewer(1); }}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-3 rounded-full bg-white/5 hover:bg-white/15 text-zinc-200"
            title="Next (→)"
          >
            <Icon name="skipFwd" size={20} />
          </button>
        </>
      )}
    </div>
  );
}
