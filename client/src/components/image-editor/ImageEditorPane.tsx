import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { ImageCanvas } from "./ImageCanvas";
import { InspectorColumn } from "./InspectorColumn";
import type { LayoutTransform } from "../../lib/bbox";

const TRANSFORMS: { op: LayoutTransform; label: string }[] = [
  { op: "transpose", label: "Transpose (swap H ↔ V)" },
  { op: "rotate_cw", label: "Rotate 90° ⟳" },
  { op: "rotate_ccw", label: "Rotate 90° ⟲" },
  { op: "rotate_180", label: "Rotate 180°" },
  { op: "flip_h", label: "Flip horizontal" },
  { op: "flip_v", label: "Flip vertical" },
];

export function ImageEditorPane() {
  const project = useStore((s) => s.project)!;
  const images = useStore((s) => s.images);
  const selectedImageId = useStore((s) => s.selectedImageId);
  const selectImage = useStore((s) => s.selectImage);
  const generateImage = useStore((s) => s.generateImage);
  const generatingImageIds = useStore((s) => s.generatingImageIds);
  const openViewer = useStore((s) => s.openViewer);
  const transformLayout = useStore((s) => s.transformLayout);
  const [showTransform, setShowTransform] = useState(false);

  useEffect(() => {
    if (!showTransform) return;
    const close = () => setShowTransform(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [showTransform]);

  const index = images.findIndex((i) => i.id === selectedImageId);
  const image = index >= 0 ? images[index] : undefined;

  if (!image) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-500 text-sm">
        Frame not found
      </div>
    );
  }

  const isGenerating = image.status === "generating" || generatingImageIds.has(image.id);
  const hasImage = !!image.filePath;

  const go = (delta: number) => {
    const next = images[index + delta];
    if (next) selectImage(next.id);
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header bar */}
      <div className="h-11 flex items-center gap-2 px-3 border-b border-zinc-800 shrink-0">
        <button
          onClick={() => selectImage(null)}
          className="text-xs px-2 py-1 rounded text-zinc-300 hover:bg-zinc-800"
        >
          ← Grid
        </button>

        <div className="flex items-center gap-0.5">
          <button
            onClick={() => go(-1)}
            disabled={index <= 0}
            className="text-xs px-1.5 py-1 rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ‹
          </button>
          <span className="text-xs text-zinc-400 tabular-nums">
            {index + 1} / {images.length}
          </span>
          <button
            onClick={() => go(1)}
            disabled={index >= images.length - 1}
            className="text-xs px-1.5 py-1 rounded text-zinc-400 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            ›
          </button>
        </div>

        {image.status === "failed" && image.lastError && (
          <span className="text-[10px] text-red-400 truncate max-w-[260px]" title={image.lastError}>
            {image.lastError}
          </span>
        )}

        <div className="flex-1" />

        {/* Transform: re-map all boxes to fix a rotated/transposed layout */}
        <div className="relative">
          <button
            onClick={(e) => { e.stopPropagation(); setShowTransform((v) => !v); }}
            disabled={image.layout.compositional_deconstruction.length === 0}
            className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500 disabled:opacity-40"
            title="Re-map all boxes (fix a rotated/transposed layout)"
          >
            ⤢ Transform ▾
          </button>
          {showTransform && (
            <div
              className="absolute right-0 mt-1 z-50 min-w-[200px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1 text-xs"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">Re-map all boxes</div>
              {TRANSFORMS.map((t) => (
                <button
                  key={t.op}
                  onMouseDown={(e) => { e.stopPropagation(); transformLayout(image.id, t.op); setShowTransform(false); }}
                  className="w-full text-left px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <button
          onClick={() => openViewer(index)}
          className="text-xs px-2 py-1 rounded border border-zinc-700 text-zinc-300 hover:text-white hover:border-zinc-500"
          title="Display mode — view frames fullscreen"
        >
          ▶ Display
        </button>

        {hasImage ? (
          <button
            onClick={() => generateImage(image.id, { regenerate: true })}
            disabled={isGenerating}
            className="text-xs px-3 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-100 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isGenerating && <Spinner />}
            {isGenerating ? "Generating…" : "Regenerate"}
          </button>
        ) : (
          <button
            onClick={() => generateImage(image.id)}
            disabled={isGenerating}
            className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {isGenerating && <Spinner />}
            {isGenerating ? "Generating…" : "Generate"}
          </button>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        <ImageCanvas image={image} project={project} />
        <InspectorColumn image={image} />
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" className="animate-spin">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round" />
    </svg>
  );
}
