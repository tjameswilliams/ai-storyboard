import { toPx, type Rect } from "../../lib/bbox";
import type { BoundingBox } from "../../types";

type Corner = "nw" | "ne" | "sw" | "se";

const CORNERS: { id: Corner; cls: string; cursor: string }[] = [
  { id: "nw", cls: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize" },
  { id: "ne", cls: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize" },
  { id: "sw", cls: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize" },
  { id: "se", cls: "right-0 bottom-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize" },
];

const MIN_GROUP = 20;

export function GroupSelection({
  regions,
  rect,
  onChange,
  onDelete,
}: {
  regions: { index: number; box: BoundingBox }[];
  rect: Rect;
  onChange: (updates: { index: number; box: BoundingBox }[]) => void;
  onDelete: () => void;
}) {
  // Union of the selected boxes, in normalized 0..1000.
  let gy0 = 1000, gx0 = 1000, gy1 = 0, gx1 = 0;
  for (const r of regions) {
    gy0 = Math.min(gy0, r.box[0]); gx0 = Math.min(gx0, r.box[1]);
    gy1 = Math.max(gy1, r.box[2]); gx1 = Math.max(gx1, r.box[3]);
  }
  const px = toPx([gy0, gx0, gy1, gx1], rect);

  const begin = (mode: "move" | Corner) => (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const snapshot = regions.map((r) => ({ index: r.index, box: [...r.box] as BoundingBox }));
    const s = { gy0, gx0, gy1, gx1 };
    const startX = e.clientX;
    const startY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const dx = ((ev.clientX - startX) / (rect.w || 1)) * 1000;
      const dy = ((ev.clientY - startY) / (rect.h || 1)) * 1000;
      let updates: { index: number; box: BoundingBox }[];

      if (mode === "move") {
        const cdx = Math.max(-s.gx0, Math.min(1000 - s.gx1, dx));
        const cdy = Math.max(-s.gy0, Math.min(1000 - s.gy1, dy));
        updates = snapshot.map((r) => ({
          index: r.index,
          box: [r.box[0] + cdy, r.box[1] + cdx, r.box[2] + cdy, r.box[3] + cdx] as BoundingBox,
        }));
      } else {
        // Resize the group rect from the dragged corner, then scale every box
        // about the opposite corner so relative positions are preserved.
        let nx0 = s.gx0, ny0 = s.gy0, nx1 = s.gx1, ny1 = s.gy1;
        if (mode === "nw" || mode === "sw") nx0 = s.gx0 + dx;
        if (mode === "ne" || mode === "se") nx1 = s.gx1 + dx;
        if (mode === "nw" || mode === "ne") ny0 = s.gy0 + dy;
        if (mode === "sw" || mode === "se") ny1 = s.gy1 + dy;
        if (nx1 - nx0 < MIN_GROUP) { if (mode === "nw" || mode === "sw") nx0 = nx1 - MIN_GROUP; else nx1 = nx0 + MIN_GROUP; }
        if (ny1 - ny0 < MIN_GROUP) { if (mode === "nw" || mode === "ne") ny0 = ny1 - MIN_GROUP; else ny1 = ny0 + MIN_GROUP; }
        const sx = (nx1 - nx0) / ((s.gx1 - s.gx0) || 1);
        const sy = (ny1 - ny0) / ((s.gy1 - s.gy0) || 1);
        updates = snapshot.map((r) => {
          const [y0, x0, y1, x1] = r.box;
          return {
            index: r.index,
            box: [
              ny0 + (y0 - s.gy0) * sy,
              nx0 + (x0 - s.gx0) * sx,
              ny0 + (y1 - s.gy0) * sy,
              nx0 + (x1 - s.gx0) * sx,
            ] as BoundingBox,
          };
        });
      }
      onChange(updates);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  return (
    <div
      className="absolute pointer-events-none"
      style={{ left: px.x, top: px.y, width: px.w, height: px.h, zIndex: 60 }}
    >
      <div className="absolute inset-0 border-2 border-dashed border-white/70 rounded-sm" />

      {/* Move + delete controls */}
      <div className="absolute -top-7 left-0 flex items-center gap-1 pointer-events-auto">
        <button
          onMouseDown={begin("move")}
          className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-600 text-[10px] text-zinc-200 cursor-move"
          title="Drag to move all selected boxes"
        >
          ✥ {regions.length}
        </button>
        <button
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); onDelete(); }}
          className="px-1.5 py-0.5 rounded bg-red-900/70 border border-red-700 text-[10px] text-red-200"
          title="Delete selected boxes"
        >
          Delete
        </button>
      </div>

      {/* Resize handles */}
      {CORNERS.map((c) => (
        <div
          key={c.id}
          onMouseDown={begin(c.id)}
          className={`absolute ${c.cls} w-3 h-3 rounded-sm bg-white border border-zinc-700 pointer-events-auto`}
          style={{ cursor: c.cursor }}
        />
      ))}
    </div>
  );
}
