import { useState } from "react";
import { useStore } from "../../store";
import { api } from "../../api/client";

type Format = "zip" | "pdf";

/** Download a URL as a file, using the server's Content-Disposition name. */
async function downloadFile(url: string, fallbackName: string) {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = `Export failed (${res.status})`;
    try { const j = await res.json(); if (j?.error) msg = j.error; } catch { /* ignore */ }
    throw new Error(msg);
  }
  const cd = res.headers.get("Content-Disposition") || "";
  const m = cd.match(/filename="?([^"]+)"?/);
  const name = m?.[1] || fallbackName;
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

export function ExportModal({ onClose }: { onClose: () => void }) {
  const project = useStore((s) => s.project)!;
  const images = useStore((s) => s.images);

  const [format, setFormat] = useState<Format>("pdf");
  const [columns, setColumns] = useState(2);
  const [captions, setCaptions] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generatedCount = images.filter((i) => i.filePath).length;

  const handleExport = async () => {
    setBusy(true);
    setError(null);
    try {
      if (format === "zip") {
        await downloadFile(api.exportZipUrl(project.id), `${project.name || "storyboard"}.zip`);
      } else {
        await downloadFile(api.exportPdfUrl(project.id, columns, captions), `${project.name || "storyboard"}.pdf`);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-[420px] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3">
          <h2 className="text-lg font-semibold text-zinc-200">Export storyboard</h2>
          <p className="text-[11px] text-zinc-500 mt-1">
            {images.length} {images.length === 1 ? "frame" : "frames"} · {generatedCount} generated
          </p>
        </div>

        <div className="px-5 pb-4 space-y-4">
          {/* Format */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setFormat("pdf")}
              className={`rounded-md border p-3 text-left transition-colors ${
                format === "pdf" ? "border-blue-500 bg-blue-500/10" : "border-zinc-700 hover:border-zinc-600"
              }`}
            >
              <div className="text-sm text-zinc-200">PDF</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Grid layout, your column count</div>
            </button>
            <button
              type="button"
              onClick={() => setFormat("zip")}
              className={`rounded-md border p-3 text-left transition-colors ${
                format === "zip" ? "border-blue-500 bg-blue-500/10" : "border-zinc-700 hover:border-zinc-600"
              }`}
            >
              <div className="text-sm text-zinc-200">ZIP</div>
              <div className="text-[10px] text-zinc-500 mt-0.5">Images numbered in sequence</div>
            </button>
          </div>

          {/* PDF options */}
          {format === "pdf" && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs text-zinc-400 mb-1.5">Columns</label>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5, 6].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setColumns(n)}
                      className={`flex-1 py-1.5 rounded border text-xs ${
                        columns === n
                          ? "border-blue-500/50 bg-blue-500/15 text-blue-200"
                          : "border-zinc-700 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex items-center gap-2 text-xs text-zinc-300">
                <input type="checkbox" checked={captions} onChange={(e) => setCaptions(e.target.checked)} className="accent-blue-500" />
                Include captions (frame number + name)
              </label>
            </div>
          )}

          {format === "zip" && generatedCount === 0 && (
            <p className="text-[11px] text-amber-400">No generated images yet — the ZIP would be empty.</p>
          )}

          {error && <p className="text-[11px] text-red-400">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button onClick={onClose} className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">
            Cancel
          </button>
          <button
            onClick={handleExport}
            disabled={busy || (format === "zip" && generatedCount === 0)}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? "Exporting…" : "Export"}
          </button>
        </div>
      </div>
    </div>
  );
}
