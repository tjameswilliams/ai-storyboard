import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { AutoTextarea } from "../ui/AutoTextarea";
import type { StoryboardImage, Layout, StyleDescription } from "../../types";

export function LayoutMetaPanel({ image }: { image: StoryboardImage }) {
  const patchImageLayout = useStore((s) => s.patchImageLayout);
  const layout = image.layout;
  const style: StyleDescription = layout.style_description ?? {};

  const patch = (updates: Partial<Layout>) => {
    patchImageLayout(image.id, { ...layout, ...updates });
  };

  const patchStyle = (updates: Partial<StyleDescription>) => {
    const next: StyleDescription = { ...style, ...updates };
    (Object.keys(next) as (keyof StyleDescription)[]).forEach((k) => {
      const v = next[k];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) delete next[k];
    });
    patch({ style_description: next });
  };

  // Photo and art_style are mutually exclusive — track which path is active.
  const [styleMode, setStyleMode] = useState<"art" | "photo">(style.photo ? "photo" : "art");
  useEffect(() => {
    setStyleMode(image.layout.style_description?.photo ? "photo" : "art");
  }, [image.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* Ideogram structured style_description */}
      <div className="space-y-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Style</div>
        <div>
          <label className="block text-[10px] text-zinc-400 mb-1">Aesthetics</label>
          <AutoTextarea
            value={style.aesthetics ?? ""}
            onChange={(e) => patchStyle({ aesthetics: e.target.value })}
            rows={1}
            className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500 resize-y"
            placeholder="mood keywords — e.g. moody, cinematic, desaturated"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-400 mb-1">Lighting</label>
          <input
            value={style.lighting ?? ""}
            onChange={(e) => patchStyle({ lighting: e.target.value })}
            className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
            placeholder="e.g. golden hour, rim light"
          />
        </div>
        <div>
          <label className="block text-[10px] text-zinc-400 mb-1">Medium</label>
          <input
            value={style.medium ?? ""}
            onChange={(e) => patchStyle({ medium: e.target.value })}
            className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
            placeholder="photograph | illustration | 3d_render | painting | graphic_design"
          />
        </div>
        <div>
          <div className="flex items-center gap-1 mb-1">
            <button
              onClick={() => { setStyleMode("art"); patchStyle({ photo: undefined }); }}
              className={`text-[10px] px-2 py-0.5 rounded border ${styleMode === "art" ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-zinc-700 text-zinc-400"}`}
            >
              Art style
            </button>
            <button
              onClick={() => { setStyleMode("photo"); patchStyle({ art_style: undefined }); }}
              className={`text-[10px] px-2 py-0.5 rounded border ${styleMode === "photo" ? "border-blue-500/50 bg-blue-500/15 text-blue-200" : "border-zinc-700 text-zinc-400"}`}
            >
              Photo
            </button>
            <span className="text-[9px] text-zinc-600">pick one</span>
          </div>
          {styleMode === "art" ? (
            <input
              value={style.art_style ?? ""}
              onChange={(e) => patchStyle({ art_style: e.target.value })}
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
              placeholder="art style — e.g. flat vector, bold outlines"
            />
          ) : (
            <input
              value={style.photo ?? ""}
              onChange={(e) => patchStyle({ photo: e.target.value })}
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
              placeholder="camera/lens — e.g. 35mm, f/1.4, shallow depth of field"
            />
          )}
        </div>
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
