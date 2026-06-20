import { useState, useEffect, useCallback, useRef } from "react";
import { AutoTextarea } from "../ui/AutoTextarea";
import { useStore } from "../../store";
import type { Asset } from "../../types";
import { api } from "../../api/client";

const TYPE_FILTERS = ["all", "image", "video", "audio", "tts"] as const;

const TYPE_ICONS: Record<string, string> = {
  image: "\u{1F5BC}",
  video: "\u{1F3AC}",
  audio: "\u{1F3B5}",
  tts: "\u{1F5E3}",
};

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AssetBrowser() {
  const assets = useStore((s) => s.assets);
  const assetsLoading = useStore((s) => s.assetsLoading);
  const assetFilter = useStore((s) => s.assetFilter);
  const selectedAssetId = useStore((s) => s.selectedAssetId);
  const loadAssets = useStore((s) => s.loadAssets);
  const searchAssets = useStore((s) => s.searchAssets);
  const setAssetFilter = useStore((s) => s.setAssetFilter);
  const selectAsset = useStore((s) => s.selectAsset);
  const toggleAssetFavorite = useStore((s) => s.toggleAssetFavorite);
  const updateAssetMetadata = useStore((s) => s.updateAssetMetadata);
  const regenerateAssetDescription = useStore((s) => s.regenerateAssetDescription);
  const deleteAsset = useStore((s) => s.deleteAsset);
  const project = useStore((s) => s.project);

  const [searchText, setSearchText] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; assetId: string } | null>(null);
  const [descDraft, setDescDraft] = useState("");
  const [regenPrompt, setRegenPrompt] = useState("");
  const [regenOpen, setRegenOpen] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [infoAssetId, setInfoAssetId] = useState<string | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (project) loadAssets();
  }, [project?.id]);

  const handleSearchChange = useCallback((value: string) => {
    setSearchText(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      if (value.trim()) {
        searchAssets(value.trim());
      } else {
        loadAssets();
      }
    }, 300);
  }, [searchAssets, loadAssets]);

  const handleTypeFilter = useCallback((type: string) => {
    setAssetFilter({ type: type === "all" ? undefined : type });
  }, [setAssetFilter]);

  const handleContextMenu = useCallback((e: React.MouseEvent, assetId: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, assetId });
  }, []);

  const selectedAsset = assets.find((a) => a.id === selectedAssetId);

  useEffect(() => {
    setDescDraft(selectedAsset?.description ?? "");
  }, [selectedAssetId, selectedAsset?.description]);

  // Reset the regen panel when the user picks a different asset so a stale
  // prompt or error from one asset doesn't bleed into the next.
  useEffect(() => {
    setRegenOpen(false);
    setRegenPrompt("");
    setRegenError(null);
  }, [selectedAssetId]);

  const commitDescription = useCallback(() => {
    if (!selectedAsset) return;
    const next = descDraft.trim();
    const current = (selectedAsset.description ?? "").trim();
    if (next === current) return;
    updateAssetMetadata(selectedAsset.id, { description: next });
  }, [selectedAsset, descDraft, updateAssetMetadata]);

  const handleRegenerate = useCallback(async () => {
    if (!selectedAsset) return;
    setRegenerating(true);
    setRegenError(null);
    try {
      await regenerateAssetDescription(selectedAsset.id, regenPrompt.trim() || undefined);
      setRegenOpen(false);
      setRegenPrompt("");
    } catch (err) {
      setRegenError((err as Error).message || "Failed to regenerate");
    } finally {
      setRegenerating(false);
    }
  }, [selectedAsset, regenPrompt, regenerateAssetDescription]);

  return (
    <div className="flex flex-col h-full" onClick={() => setContextMenu(null)}>
      {/* Search */}
      <div className="px-2 pt-2 pb-1">
        <input
          type="text"
          value={searchText}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder="Search assets..."
          className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500"
        />
      </div>

      {/* Type filters */}
      <div className="flex gap-1 px-2 pb-2 flex-wrap">
        {TYPE_FILTERS.map((t) => (
          <button
            key={t}
            onClick={() => handleTypeFilter(t)}
            className={`px-2 py-0.5 text-[10px] rounded ${
              (t === "all" && !assetFilter.type) || assetFilter.type === t
                ? "bg-blue-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {t === "all" ? "All" : `${TYPE_ICONS[t] || ""} ${t.charAt(0).toUpperCase() + t.slice(1)}`}
          </button>
        ))}
      </div>

      {/* Asset grid */}
      <div className="flex-1 overflow-y-auto px-2">
        {assetsLoading ? (
          <div className="text-center text-zinc-500 text-xs py-4">Loading...</div>
        ) : assets.length === 0 ? (
          <div className="text-center text-zinc-500 text-xs py-4">
            {searchText ? "No matching assets" : "No assets yet. Generate images, videos, or audio to see them here."}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((asset) => (
              <AssetCard
                key={asset.id}
                asset={asset}
                selected={asset.id === selectedAssetId}
                onClick={() => selectAsset(asset.id === selectedAssetId ? null : asset.id)}
                onContextMenu={(e) => handleContextMenu(e, asset.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Selected asset details */}
      {selectedAsset && (
        <div className="border-t border-zinc-700 px-2 py-2 text-xs space-y-1 max-h-64 overflow-y-auto">
          <div className="flex items-center gap-1">
            <div className="font-medium text-zinc-200 truncate flex-1">{selectedAsset.fileName}</div>
            <button
              onClick={() => toggleAssetFavorite(selectedAsset.id)}
              title={selectedAsset.favorite ? "Unfavorite" : "Favorite"}
              className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${
                selectedAsset.favorite ? "bg-amber-600 text-white" : "bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
              }`}
            >
              {"★"}
            </button>
            <button
              onClick={() => setInfoAssetId(selectedAsset.id)}
              title="Inspect metadata and the workflow JSON sent to ComfyUI"
              className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
            >
              Info
            </button>
            <button
              onClick={() => {
                if (confirm("Delete this asset?")) deleteAsset(selectedAsset.id);
              }}
              title="Delete asset"
              className="shrink-0 px-1.5 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300 hover:bg-red-700"
            >
              {"✕"}
            </button>
          </div>
          {selectedAsset.prompt && (
            <div className="text-zinc-400 line-clamp-2">{selectedAsset.prompt}</div>
          )}
          <div className="pt-1">
            <label className="block text-[10px] uppercase tracking-wide text-zinc-500 mb-0.5">
              Description (visible to agent)
            </label>
            <AutoTextarea
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              onBlur={commitDescription}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                  e.preventDefault();
                  (e.currentTarget as HTMLTextAreaElement).blur();
                }
              }}
              placeholder="Describe this asset so the agent can find and reuse it..."
              rows={3}
              className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-y"
            />
            {selectedAsset.type === "image" && (
              <div className="mt-1">
                {!regenOpen ? (
                  <button
                    onClick={() => setRegenOpen(true)}
                    className="text-[10px] px-2 py-0.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                  >
                    Regenerate from image
                  </button>
                ) : (
                  <div className="space-y-1 border border-zinc-700 rounded p-1.5 bg-zinc-900">
                    <AutoTextarea
                      value={regenPrompt}
                      onChange={(e) => setRegenPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                          e.preventDefault();
                          handleRegenerate();
                        }
                      }}
                      placeholder='Optional prompt — e.g. "list every object" or "describe the colors". Leave blank for default.'
                      rows={2}
                      disabled={regenerating}
                      className="w-full px-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-zinc-500 resize-y disabled:opacity-60"
                    />
                    {regenError && (
                      <div className="text-[10px] text-red-400">{regenError}</div>
                    )}
                    <div className="flex gap-1">
                      <button
                        onClick={handleRegenerate}
                        disabled={regenerating}
                        className="px-2 py-0.5 rounded text-[10px] bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {regenerating ? "Generating…" : "Generate"}
                      </button>
                      <button
                        onClick={() => {
                          setRegenOpen(false);
                          setRegenPrompt("");
                          setRegenError(null);
                        }}
                        disabled={regenerating}
                        className="px-2 py-0.5 rounded text-[10px] bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-60"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          {selectedAsset.workflowName && (
            <div className="text-zinc-500">Workflow: {selectedAsset.workflowName}</div>
          )}
          {selectedAsset.seed != null && (
            <div className="text-zinc-500">Seed: {selectedAsset.seed}</div>
          )}
          <div className="text-zinc-500">{formatAge(selectedAsset.createdAt)}</div>
        </div>
      )}

      {infoAssetId && (
        <AssetInfoModal assetId={infoAssetId} onClose={() => setInfoAssetId(null)} />
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-zinc-800 border border-zinc-600 rounded shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            className="block w-full text-left px-3 py-1 hover:bg-zinc-700 text-zinc-200"
            onClick={() => {
              toggleAssetFavorite(contextMenu.assetId);
              setContextMenu(null);
            }}
          >
            Toggle favorite
          </button>
          <button
            className="block w-full text-left px-3 py-1 hover:bg-red-700 text-zinc-200"
            onClick={() => {
              if (confirm("Delete this asset?")) deleteAsset(contextMenu.assetId);
              setContextMenu(null);
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

function AssetInfoModal({ assetId, onClose }: { assetId: string; onClose: () => void }) {
  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"metadata" | "workflow">("metadata");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.getAsset(assetId)
      .then((a) => { if (!cancelled) { setAsset(a); setLoading(false); } })
      .catch((err) => { if (!cancelled) { setError((err as Error).message || "Failed to load"); setLoading(false); } });
    return () => { cancelled = true; };
  }, [assetId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Build the metadata view by pretty-printing every asset field except the
  // workflow JSON (shown in its own tab) and parsing nested JSON fields like
  // generationParams / tags so the user sees structured objects, not strings.
  const metadataView = (() => {
    if (!asset) return null;
    const parseJson = (v: string | null | undefined) => {
      if (!v) return null;
      try { return JSON.parse(v); } catch { return v; }
    };
    const { executedWorkflowJson: _wf, ...rest } = asset;
    const view: Record<string, unknown> = {
      ...rest,
      generationParams: parseJson(rest.generationParams),
      tags: parseJson(rest.tags),
      sourceAssetIds: parseJson(rest.sourceAssetIds),
    };
    return JSON.stringify(view, null, 2);
  })();

  const workflowView = (() => {
    if (!asset?.executedWorkflowJson) return null;
    try {
      return JSON.stringify(JSON.parse(asset.executedWorkflowJson), null, 2);
    } catch {
      return asset.executedWorkflowJson;
    }
  })();

  const handleCopy = async (text: string | null) => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl flex flex-col max-w-3xl w-full max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-700 px-4 py-2">
          <div className="text-sm font-medium text-zinc-200 truncate">
            {asset?.fileName || "Asset info"}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 text-lg leading-none"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 border-b border-zinc-700 px-3 pt-2">
          <button
            onClick={() => setTab("metadata")}
            className={`px-3 py-1 text-xs rounded-t ${
              tab === "metadata" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Metadata
          </button>
          <button
            onClick={() => setTab("workflow")}
            className={`px-3 py-1 text-xs rounded-t ${
              tab === "workflow" ? "bg-zinc-800 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            Workflow JSON
            {asset && !asset.executedWorkflowJson && (
              <span className="ml-1 text-[9px] text-zinc-500">(none)</span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-3 bg-zinc-950">
          {loading ? (
            <div className="text-xs text-zinc-500">Loading…</div>
          ) : error ? (
            <div className="text-xs text-red-400">{error}</div>
          ) : tab === "metadata" ? (
            <pre className="text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-words">
              {metadataView}
            </pre>
          ) : workflowView ? (
            <pre className="text-[11px] font-mono text-zinc-200 whitespace-pre-wrap break-words">
              {workflowView}
            </pre>
          ) : (
            <div className="text-xs text-zinc-500">
              No workflow JSON stored for this asset. Generations made before this feature was added won't have one — regenerate the asset to capture it.
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-zinc-700 px-3 py-2 flex justify-end">
          <button
            onClick={() => handleCopy(tab === "metadata" ? metadataView : workflowView)}
            disabled={loading || (tab === "workflow" && !workflowView)}
            className="px-2 py-0.5 rounded text-[11px] bg-zinc-700 text-zinc-200 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
    </div>
  );
}

function AssetCard({
  asset,
  selected,
  onClick,
  onContextMenu,
}: {
  asset: Asset;
  selected: boolean;
  onClick: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const isImage = asset.type === "image";
  const icon = TYPE_ICONS[asset.type] || "\u{1F4C4}";
  const promptSnippet = asset.prompt
    ? asset.prompt.length > 40 ? asset.prompt.slice(0, 40) + "..." : asset.prompt
    : asset.fileName;

  return (
    <div
      className={`rounded cursor-pointer overflow-hidden border ${
        selected ? "border-blue-500 bg-zinc-700" : "border-zinc-700 bg-zinc-800 hover:border-zinc-600"
      }`}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {/* Thumbnail area */}
      <div className="aspect-square bg-zinc-900 flex items-center justify-center relative">
        {isImage ? (
          <img
            src={api.mediaUrl(asset.filePath)}
            alt={asset.prompt || asset.fileName}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="text-2xl">{icon}</span>
        )}
        {asset.favorite === 1 && (
          <span className="absolute top-0.5 right-0.5 text-amber-400 text-xs">{"\u2605"}</span>
        )}
      </div>
      {/* Label */}
      <div className="px-1 py-0.5">
        <div className="text-[10px] text-zinc-300 truncate">{promptSnippet}</div>
        <div className="text-[9px] text-zinc-500">{formatAge(asset.createdAt)}</div>
      </div>
    </div>
  );
}
