import { useEffect, useRef, useState } from "react";
import { api } from "../../api/client";
import { useStore } from "../../store";
import { BBoxOverlay, REGION_COLORS } from "./BBoxOverlay";
import type { StoryboardImage, Project, BoundingBox, Layout } from "../../types";
import type { Rect } from "../../lib/bbox";

export function ImageCanvas({ image, project }: { image: StoryboardImage; project: Project }) {
  const patchImageLayout = useStore((s) => s.patchImageLayout);
  const selectRegion = useStore((s) => s.selectRegion);
  const selectedRegionIndex = useStore((s) => s.selectedRegionIndex);

  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // The letterboxed frame size (px), locked to the project's aspect ratio so
  // bboxes never warp when the editor pane is a different shape than the image.
  const [rect, setRect] = useState<Rect>({ w: 0, h: 0 });
  // Right-click stack picker: which regions sit under the cursor.
  const [menu, setMenu] = useState<{ x: number; y: number; items: number[] } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const aspect = project.width / project.height;
    const fit = () => {
      const cw = el.clientWidth;
      const ch = el.clientHeight;
      if (cw <= 0 || ch <= 0) return;
      // Contain the aspect-locked frame within the available area.
      let w = cw;
      let h = w / aspect;
      if (h > ch) { h = ch; w = h * aspect; }
      setRect({ w: Math.round(w), h: Math.round(h) });
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [project.width, project.height]);

  const regions = image.layout.compositional_deconstruction;

  // Close the picker on outside click / Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenu(null); };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const commitRegionBox = (index: number, box: BoundingBox) => {
    const next: Layout = {
      ...image.layout,
      compositional_deconstruction: image.layout.compositional_deconstruction.map((r, i) =>
        i === index ? { ...r, bounding_box: box } : r,
      ),
    };
    patchImageLayout(image.id, next);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    const el = frameRef.current;
    if (!el || rect.w <= 0 || rect.h <= 0) return;
    e.preventDefault();
    const r = el.getBoundingClientRect();
    const xNorm = ((e.clientX - r.left) / rect.w) * 1000;
    const yNorm = ((e.clientY - r.top) / rect.h) * 1000;
    const items: number[] = [];
    regions.forEach((rg, i) => {
      const [yMin, xMin, yMax, xMax] = rg.bounding_box;
      const x0 = Math.min(xMin, xMax), x1 = Math.max(xMin, xMax);
      const y0 = Math.min(yMin, yMax), y1 = Math.max(yMin, yMax);
      if (xNorm >= x0 && xNorm <= x1 && yNorm >= y0 && yNorm <= y1) items.push(i);
    });
    if (items.length === 0) { setMenu(null); return; }
    // Show topmost-first (higher index renders on top) so the list reads
    // front-to-back of the visual stack.
    items.reverse();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  return (
    <div className="flex-1 min-w-0 bg-zinc-950 overflow-hidden p-6">
      <div ref={containerRef} className="w-full h-full flex items-center justify-center">
        {/* The frame: explicit px size locked to the project aspect ratio. */}
        <div
          ref={frameRef}
          className="relative bg-zinc-900 border border-zinc-800 shadow-lg"
          style={{ width: rect.w || undefined, height: rect.h || undefined }}
          onClick={() => selectRegion(null)}
          onContextMenu={handleContextMenu}
        >
          {image.filePath ? (
            <img
              src={api.mediaUrl(image.filePath)}
              alt={image.name || "frame"}
              className="absolute inset-0 w-full h-full object-contain"
              draggable={false}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[11px] text-zinc-600 text-center px-4">
              {image.status === "generating" ? "Generating…" : "Not generated yet — draw and edit regions, then Generate"}
            </div>
          )}

          {/* Region overlays */}
          {rect.w > 0 &&
            regions.map((region, index) => (
              <BBoxOverlay
                key={region.id || index}
                region={region}
                index={index}
                rect={rect}
                onCommit={(box) => commitRegionBox(index, box)}
              />
            ))}
        </div>
      </div>

      {/* Right-click stack picker — select an overlapped region and raise it. */}
      {menu && (
        <div
          className="fixed z-50 min-w-[180px] max-w-[300px] bg-zinc-900 border border-zinc-700 rounded-md shadow-xl py-1 text-xs"
          style={{ left: menu.x, top: menu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-zinc-500 border-b border-zinc-800">
            {menu.items.length} region{menu.items.length === 1 ? "" : "s"} here
          </div>
          {menu.items.map((i) => {
            const rg = regions[i];
            return (
              <button
                key={i}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  selectRegion(i);
                  setMenu(null);
                }}
                className={`w-full text-left px-2 py-1.5 flex items-center gap-2 hover:bg-zinc-800 ${
                  selectedRegionIndex === i ? "bg-zinc-800/70" : ""
                }`}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: REGION_COLORS[i % REGION_COLORS.length] }}
                />
                <span className="text-zinc-300 shrink-0">{i + 1}</span>
                <span className="text-zinc-500 truncate">{rg?.description || "(no description)"}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
