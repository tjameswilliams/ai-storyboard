import { useCallback, useRef, useState } from "react";
import { useStore } from "../../store";
import type { StyleguideBrandAsset } from "../../types";

const ROLES: Array<{ value: string; label: string }> = [
  { value: "primary-logo", label: "Primary logo" },
  { value: "secondary-logo", label: "Secondary logo" },
  { value: "wordmark", label: "Wordmark" },
  { value: "icon", label: "Icon" },
  { value: "accent-image", label: "Accent image" },
  { value: "color-swatch", label: "Color swatch" },
  { value: "reference", label: "Reference" },
];

function roleLabel(value: string): string {
  return ROLES.find((r) => r.value === value)?.label ?? value;
}

export function BrandAssetsTab() {
  const sg = useStore((s) => s.activeStyleguide);
  const uploadStyleguideAsset = useStore((s) => s.uploadStyleguideAsset);
  const updateStyleguideAsset = useStore((s) => s.updateStyleguideAsset);
  const deleteStyleguideAsset = useStore((s) => s.deleteStyleguideAsset);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadRole, setUploadRole] = useState<string>("primary-logo");
  const [dragOver, setDragOver] = useState<boolean>(false);
  const [uploading, setUploading] = useState<boolean>(false);

  const uploadFiles = useCallback(
    async (files: FileList | File[]) => {
      setUploading(true);
      try {
        const list = Array.from(files);
        for (const file of list) {
          await uploadStyleguideAsset(file, uploadRole);
        }
      } finally {
        setUploading(false);
      }
    },
    [uploadRole, uploadStyleguideAsset],
  );

  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        await uploadFiles(e.dataTransfer.files);
      }
    },
    [uploadFiles],
  );

  if (!sg) return null;

  const assets = sg.assets ?? [];

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-zinc-800 shrink-0 bg-zinc-900">
        <label className="text-[11px] text-zinc-400">
          Upload as:
          <select
            value={uploadRole}
            onChange={(e) => setUploadRole(e.target.value)}
            className="ml-2 bg-zinc-800 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </label>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) uploadFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="text-xs px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white"
        >
          {uploading ? "Uploading..." : "Upload image"}
        </button>
        <div className="flex-1" />
        <div className="text-[11px] text-zinc-500">{assets.length} asset{assets.length === 1 ? "" : "s"}</div>
      </div>

      {/* Grid */}
      <div
        className={`flex-1 min-h-0 overflow-auto p-4 ${dragOver ? "bg-blue-900/10 ring-2 ring-blue-600/40 ring-inset" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
          e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {assets.length === 0 ? (
          <div className="h-full flex items-center justify-center text-zinc-600 text-sm text-center px-8">
            <div>
              Drag images here, or use the Upload button above.
              <div className="text-[11px] text-zinc-700 mt-2">
                Logos, wordmarks, color swatches, and reference imagery live here and are made available to the LLM when this styleguide is attached to a project.
              </div>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-3">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                onRoleChange={(role) => updateStyleguideAsset(asset.id, { role })}
                onLabelChange={(label) => updateStyleguideAsset(asset.id, { label })}
                onDelete={() => deleteStyleguideAsset(asset.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  onRoleChange,
  onLabelChange,
  onDelete,
}: {
  asset: StyleguideBrandAsset;
  onRoleChange: (role: string) => void;
  onLabelChange: (label: string) => void;
  onDelete: () => void;
}) {
  const [labelDraft, setLabelDraft] = useState<string>(asset.label ?? "");

  const commitLabel = () => {
    if ((asset.label ?? "") !== labelDraft) onLabelChange(labelDraft);
  };

  return (
    <div className="rounded border border-zinc-800 bg-zinc-900 overflow-hidden flex flex-col group">
      <div className="aspect-square bg-[repeating-conic-gradient(#18181b_0_25%,#27272a_0_50%)] bg-[length:16px_16px] flex items-center justify-center">
        <img
          src={`/api/uploads/${asset.filePath}`}
          alt={asset.label || asset.fileName}
          className="max-w-full max-h-full object-contain"
        />
      </div>
      <div className="p-2 text-[11px] space-y-1.5">
        <div className="text-zinc-300 truncate" title={asset.fileName}>{asset.fileName}</div>
        <select
          value={asset.role}
          onChange={(e) => onRoleChange(e.target.value)}
          className="w-full bg-zinc-800 text-zinc-200 px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
        >
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
          {/* Render current role even if not in ROLES (custom LLM-assigned) */}
          {!ROLES.find((r) => r.value === asset.role) && (
            <option value={asset.role}>{roleLabel(asset.role)}</option>
          )}
        </select>
        <input
          type="text"
          value={labelDraft}
          onChange={(e) => setLabelDraft(e.target.value)}
          onBlur={commitLabel}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          placeholder="Label (optional)"
          className="w-full bg-zinc-800 text-zinc-200 px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
        />
        <div className="flex justify-end">
          <button
            onClick={() => {
              if (confirm(`Delete ${asset.fileName}?`)) onDelete();
            }}
            className="text-zinc-500 hover:text-red-400"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
