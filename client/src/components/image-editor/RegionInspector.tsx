import { useStore } from "../../store";
import { AutoTextarea } from "../ui/AutoTextarea";
import { clampBox } from "../../lib/bbox";
import type { StoryboardImage, Layout, Region, BoundingBox } from "../../types";

const BOX_LABELS: { idx: 0 | 1 | 2 | 3; label: string }[] = [
  { idx: 0, label: "y min" },
  { idx: 1, label: "x min" },
  { idx: 2, label: "y max" },
  { idx: 3, label: "x max" },
];

function newRegion(): Omit<Region, "id"> {
  return {
    bounding_box: [250, 250, 750, 750],
    description: "",
  };
}

export function RegionInspector({ image }: { image: StoryboardImage }) {
  const selectedRegionIndex = useStore((s) => s.selectedRegionIndex);
  const selectRegion = useStore((s) => s.selectRegion);
  const patchImageLayout = useStore((s) => s.patchImageLayout);

  const layout = image.layout;
  const regions = layout.compositional_deconstruction;

  const writeRegions = (next: Region[]) => {
    const updated: Layout = { ...layout, compositional_deconstruction: next };
    patchImageLayout(image.id, updated);
  };

  const addRegion = () => {
    const next = [...regions, newRegion() as Region];
    writeRegions(next);
    selectRegion(next.length - 1);
  };

  const deleteRegion = (i: number) => {
    writeRegions(regions.filter((_, idx) => idx !== i));
    selectRegion(null);
  };

  const patchRegion = (i: number, updates: Partial<Region>) => {
    writeRegions(regions.map((r, idx) => (idx === i ? { ...r, ...updates } : r)));
  };

  const region = selectedRegionIndex != null ? regions[selectedRegionIndex] : undefined;

  return (
    <div className="border-b border-zinc-800 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">
          Region {region && selectedRegionIndex != null ? `${selectedRegionIndex + 1} / ${regions.length}` : ""}
        </div>
        <button onClick={addRegion} className="text-[10px] text-blue-400 hover:text-blue-300">
          + Add region
        </button>
      </div>

      {!region || selectedRegionIndex == null ? (
        <div className="text-[10px] text-zinc-600 italic">
          Select a region on the canvas, or add one.
        </div>
      ) : (
        <>
          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">Description</label>
            <AutoTextarea
              value={region.description}
              onChange={(e) => patchRegion(selectedRegionIndex, { description: e.target.value })}
              rows={2}
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500 resize-y"
              placeholder="What occupies this region…"
            />
          </div>

          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">Text (optional)</label>
            <input
              value={region.text ?? ""}
              onChange={(e) => patchRegion(selectedRegionIndex, { text: e.target.value || undefined })}
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
              placeholder="Literal text to render in-image"
            />
          </div>

          <div>
            <label className="block text-[10px] text-zinc-400 mb-1">Bounding box (0–1000)</label>
            <div className="grid grid-cols-2 gap-1.5">
              {BOX_LABELS.map(({ idx, label }) => (
                <div key={idx} className="flex items-center gap-1">
                  <span className="text-[9px] text-zinc-500 w-9">{label}</span>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    value={region.bounding_box[idx]}
                    onChange={(e) => {
                      const box = [...region.bounding_box] as BoundingBox;
                      box[idx] = parseInt(e.target.value, 10) || 0;
                      patchRegion(selectedRegionIndex, { bounding_box: clampBox(box) });
                    }}
                    className="flex-1 bg-zinc-800 text-zinc-200 text-[11px] px-1.5 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
                  />
                </div>
              ))}
            </div>
          </div>

          <RegionPalette
            region={region}
            onChange={(palette) => patchRegion(selectedRegionIndex, { color_palette: palette.length ? palette : undefined })}
          />

          <button
            onClick={() => deleteRegion(selectedRegionIndex)}
            className="w-full text-[11px] py-1.5 rounded border border-red-900/50 text-red-400 hover:bg-red-950/30"
          >
            Delete region
          </button>
        </>
      )}
    </div>
  );
}

function RegionPalette({
  region,
  onChange,
}: {
  region: Region;
  onChange: (palette: string[]) => void;
}) {
  const palette = region.color_palette ?? [];
  const set = (i: number, v: string) => {
    const next = [...palette];
    next[i] = v;
    onChange(next);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] text-zinc-400">Region colors</label>
        <button onClick={() => onChange([...palette, "#888888"])} className="text-[10px] text-blue-400 hover:text-blue-300">
          + Add
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {palette.map((c, i) => (
          <div key={i} className="flex items-center gap-1 bg-zinc-800 rounded border border-zinc-700 px-1 py-0.5">
            <input
              type="color"
              value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#888888"}
              onChange={(e) => set(i, e.target.value)}
              className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
            />
            <input
              value={c}
              onChange={(e) => set(i, e.target.value)}
              className="w-16 bg-transparent text-[10px] text-zinc-300 focus:outline-none"
              style={{ fontFamily: "var(--font-mono)" }}
            />
            <button
              onClick={() => onChange(palette.filter((_, idx) => idx !== i))}
              className="text-zinc-500 hover:text-red-400 text-[10px]"
            >
              ×
            </button>
          </div>
        ))}
        {palette.length === 0 && <span className="text-[10px] text-zinc-600 italic">Inherits frame palette</span>}
      </div>
    </div>
  );
}
