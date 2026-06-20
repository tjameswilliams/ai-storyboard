import { useState, useEffect, useMemo } from "react";
import { useStore } from "../../store";
import { ASPECT_RATIOS, MEGAPIXELS, computeDims } from "../../lib/aspectPresets";

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const createProject = useStore((s) => s.createProject);
  const workflows = useStore((s) => s.workflows);
  const loadWorkflows = useStore((s) => s.loadWorkflows);

  const [name, setName] = useState("");
  const [aspect, setAspect] = useState<string>("1:1");
  const [mp, setMp] = useState<number>(1);
  const [workflowId, setWorkflowId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only text-to-image workflows make sense for storyboard frames.
  const t2iWorkflows = useMemo(
    () => workflows.filter((w) => w.workflowType === "t2i" || w.workflowType === "txt2img"),
    [workflows],
  );
  const selectableWorkflows = t2iWorkflows.length > 0 ? t2iWorkflows : workflows;

  useEffect(() => {
    if (workflows.length === 0) loadWorkflows();
  }, [workflows.length, loadWorkflows]);

  // Default the workflow once the list loads: prefer an Ideogram t2i workflow.
  useEffect(() => {
    if (workflowId || selectableWorkflows.length === 0) return;
    const ideogram = selectableWorkflows.find((w) => /ideogram/i.test(w.name));
    setWorkflowId((ideogram ?? selectableWorkflows[0]).id);
  }, [selectableWorkflows, workflowId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const dims = useMemo(() => computeDims(aspect, mp), [aspect, mp]);

  const canSubmit = name.trim().length > 0 && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await createProject({
        name: name.trim(),
        aspectRatio: aspect,
        megapixels: mp,
        width: dims.width,
        height: dims.height,
        workflowId: workflowId || undefined,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create storyboard");
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-lg w-[420px] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-200">New storyboard</h2>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <label className="block text-xs text-zinc-400 mb-1">Name</label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
              placeholder="My storyboard"
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Aspect ratio</label>
            <div className="flex flex-wrap gap-1.5">
              {ASPECT_RATIOS.map((ar) => (
                <button
                  key={ar}
                  onClick={() => setAspect(ar)}
                  className={`text-[11px] px-2 py-1 rounded border transition-colors ${
                    aspect === ar
                      ? "border-blue-500/40 bg-blue-500/15 text-blue-200"
                      : "border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600"
                  }`}
                >
                  {ar}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1.5">Resolution budget</label>
            <div className="inline-flex rounded border border-zinc-700 overflow-hidden">
              {MEGAPIXELS.map((m) => (
                <button
                  key={m}
                  onClick={() => setMp(m)}
                  className={`text-[11px] px-3 py-1 transition-colors ${
                    mp === m ? "bg-blue-600 text-white" : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                  }`}
                >
                  {m} MP
                </button>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-zinc-500" style={{ fontFamily: "var(--font-mono)" }}>
              ≈ {dims.width} × {dims.height} px
            </div>
          </div>

          <div>
            <label className="block text-xs text-zinc-400 mb-1">Image model / workflow</label>
            <select
              value={workflowId}
              onChange={(e) => setWorkflowId(e.target.value)}
              className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
            >
              {selectableWorkflows.length === 0 && <option value="">No workflows configured</option>}
              {selectableWorkflows.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>

          {error && <div className="text-[10px] text-red-400">{error}</div>}
        </div>

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
