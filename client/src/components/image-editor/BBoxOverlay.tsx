import { useRef } from "react";
import { useStore } from "../../store";
import { toPx, toNorm, clampBox, type Rect } from "../../lib/bbox";
import type { BoundingBox, Region } from "../../types";

type Handle = "nw" | "ne" | "sw" | "se";

const HANDLES: { id: Handle; cls: string; cursor: string }[] = [
  { id: "nw", cls: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize" },
  { id: "ne", cls: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize" },
  { id: "sw", cls: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize" },
  { id: "se", cls: "right-0 bottom-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize" },
];

export const REGION_COLORS = ["#3b82f6", "#ef4444", "#22c55e", "#eab308", "#a855f7", "#06b6d4", "#f97316", "#ec4899"];

export function BBoxOverlay({
  region,
  index,
  rect,
  onCommit,
}: {
  region: Region;
  index: number;
  rect: Rect;
  onCommit: (box: BoundingBox) => void;
}) {
  const selectedRegionIndices = useStore((s) => s.selectedRegionIndices);
  const hoveredRegionIndex = useStore((s) => s.hoveredRegionIndex);
  const dragPreview = useStore((s) => s.dragPreview);
  const selectRegion = useStore((s) => s.selectRegion);
  const toggleRegionSelection = useStore((s) => s.toggleRegionSelection);
  const setHoveredRegion = useStore((s) => s.setHoveredRegion);
  const setDragPreview = useStore((s) => s.setDragPreview);

  const dragState = useRef<{
    mode: "move" | Handle;
    startX: number;
    startY: number;
    startBox: BoundingBox;
  } | null>(null);

  const selected = selectedRegionIndices.includes(index);
  const hovered = hoveredRegionIndex === index;
  const color = REGION_COLORS[index % REGION_COLORS.length];

  // Render the live drag preview for this region if one exists, else the stored box.
  const box: BoundingBox =
    dragPreview && dragPreview.index === index ? dragPreview.box : region.bounding_box;
  const px = toPx(box, rect);

  const beginDrag = (mode: "move" | Handle) => (e: React.MouseEvent) => {
    // Left button only — let right-click bubble up to the canvas stack picker.
    if (e.button !== 0) return;
    // Ctrl/Cmd is for multi-select toggling (handled on click), not dragging.
    if (e.metaKey || e.ctrlKey) return;
    e.preventDefault();
    e.stopPropagation();
    selectRegion(index);
    dragState.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startBox: region.bounding_box,
    };

    const onMove = (ev: MouseEvent) => {
      const st = dragState.current;
      if (!st) return;
      const dxNorm = ((ev.clientX - st.startX) / (rect.w || 1)) * 1000;
      const dyNorm = ((ev.clientY - st.startY) / (rect.h || 1)) * 1000;
      let [yMin, xMin, yMax, xMax] = st.startBox;

      if (st.mode === "move") {
        const w = xMax - xMin;
        const h = yMax - yMin;
        xMin = Math.max(0, Math.min(1000 - w, xMin + dxNorm));
        yMin = Math.max(0, Math.min(1000 - h, yMin + dyNorm));
        xMax = xMin + w;
        yMax = yMin + h;
      } else {
        if (st.mode === "nw" || st.mode === "sw") xMin += dxNorm;
        if (st.mode === "ne" || st.mode === "se") xMax += dxNorm;
        if (st.mode === "nw" || st.mode === "ne") yMin += dyNorm;
        if (st.mode === "sw" || st.mode === "se") yMax += dyNorm;
        // Keep min<max while dragging (allow crossing).
        if (xMin > xMax) [xMin, xMax] = [xMax, xMin];
        if (yMin > yMax) [yMin, yMax] = [yMax, yMin];
      }
      setDragPreview({ index, box: [yMin, xMin, yMax, xMax] });
    };

    const onUp = () => {
      const st = dragState.current;
      dragState.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const preview = useStore.getState().dragPreview;
      setDragPreview(null);
      if (preview && preview.index === index) {
        onCommit(clampBox(preview.box));
      } else if (st) {
        // No movement — nothing to commit.
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Re-derive normalized -> just for handle re-resize from current px (unused but
  // keeps toNorm referenced if needed in future). We rely on norm math above.
  void toNorm;

  return (
    <div
      onMouseDown={beginDrag("move")}
      onMouseEnter={() => setHoveredRegion(index)}
      onMouseLeave={() => setHoveredRegion(null)}
      onClick={(e) => {
        e.stopPropagation();
        if (e.metaKey || e.ctrlKey) toggleRegionSelection(index);
        else selectRegion(index);
      }}
      className="absolute"
      style={{
        left: px.x,
        top: px.y,
        width: px.w,
        height: px.h,
        border: `2px solid ${color}`,
        background: selected ? `${color}22` : hovered ? `${color}14` : "transparent",
        cursor: "move",
        boxSizing: "border-box",
        // Raise the selected box to the top of the stack so it's the one that
        // receives drag/resize even when boxes overlap. Hover raises slightly so
        // the labels stay legible.
        zIndex: selected ? 40 : hovered ? 30 : 20,
      }}
    >
      {/* Label */}
      <div
        className="absolute -top-5 left-0 px-1 rounded text-[10px] font-medium whitespace-nowrap"
        style={{ background: color, color: "#fff" }}
      >
        {index + 1}
        {region.description ? `· ${region.description.slice(0, 18)}` : ""}
      </div>

      {/* Resize handles (only when selected) */}
      {selected &&
        HANDLES.map((h) => (
          <div
            key={h.id}
            onMouseDown={beginDrag(h.id)}
            className={`absolute ${h.cls} w-2.5 h-2.5 rounded-sm border border-white`}
            style={{ background: color, cursor: h.cursor }}
          />
        ))}
    </div>
  );
}
