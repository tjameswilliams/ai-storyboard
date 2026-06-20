import { useStore } from "../../store";
import { AutoTextarea } from "../ui/AutoTextarea";
import type { StoryboardImage, Layout } from "../../types";

export function LayoutMetaPanel({ image }: { image: StoryboardImage }) {
  const patchImageLayout = useStore((s) => s.patchImageLayout);
  const layout = image.layout;

  const patch = (updates: Partial<Layout>) => {
    patchImageLayout(image.id, { ...layout, ...updates });
  };

  const setColor = (i: number, value: string) => {
    const palette = [...layout.color_palette];
    palette[i] = value;
    patch({ color_palette: palette });
  };

  const addColor = () => patch({ color_palette: [...layout.color_palette, "#888888"] });
  const removeColor = (i: number) =>
    patch({ color_palette: layout.color_palette.filter((_, idx) => idx !== i) });

  return (
    <div className="border-b border-zinc-800 p-3 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Layout</div>

      <div>
        <label className="block text-[10px] text-zinc-400 mb-1">High-level description</label>
        <AutoTextarea
          value={layout.high_level_description}
          onChange={(e) => patch({ high_level_description: e.target.value })}
          rows={3}
          className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500 resize-y"
          placeholder="What the whole frame depicts…"
        />
      </div>

      <div>
        <label className="block text-[10px] text-zinc-400 mb-1">Style description</label>
        <AutoTextarea
          value={layout.style_description}
          onChange={(e) => patch({ style_description: e.target.value })}
          rows={2}
          className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500 resize-y"
          placeholder="Art style, medium, lighting…"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-zinc-400">Color palette</label>
          <button onClick={addColor} className="text-[10px] text-blue-400 hover:text-blue-300">
            + Add
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {layout.color_palette.map((c, i) => (
            <div key={i} className="flex items-center gap-1 bg-zinc-800 rounded border border-zinc-700 px-1 py-0.5">
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#888888"}
                onChange={(e) => setColor(i, e.target.value)}
                className="w-5 h-5 rounded cursor-pointer bg-transparent border-0 p-0"
              />
              <input
                value={c}
                onChange={(e) => setColor(i, e.target.value)}
                className="w-16 bg-transparent text-[10px] text-zinc-300 focus:outline-none"
                style={{ fontFamily: "var(--font-mono)" }}
              />
              <button onClick={() => removeColor(i)} className="text-zinc-500 hover:text-red-400 text-[10px]">
                ×
              </button>
            </div>
          ))}
          {layout.color_palette.length === 0 && (
            <span className="text-[10px] text-zinc-600 italic">No colors</span>
          )}
        </div>
      </div>
    </div>
  );
}
