import { useEffect, useMemo, useRef, useState } from "react";
import type { ComfyWorkflowSummary } from "../../types";

interface WorkflowCheckboxDropdownProps {
  workflows: ComfyWorkflowSummary[];
  loading?: boolean;
  onToggle: (workflowId: string, enabled: boolean) => Promise<void> | void;
  align?: "left" | "right";
  buttonClassName?: string;
  label?: string;
}

export function WorkflowCheckboxDropdown({
  workflows,
  loading = false,
  onToggle,
  align = "right",
  buttonClassName = "",
  label = "Workflows",
}: WorkflowCheckboxDropdownProps) {
  const [open, setOpen] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const enabledCount = useMemo(
    () => workflows.filter((wf) => wf.enabled).length,
    [workflows]
  );

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  const handleToggle = async (workflow: ComfyWorkflowSummary) => {
    setSavingId(workflow.id);
    try {
      await onToggle(workflow.id, !workflow.enabled);
    } finally {
      setSavingId(null);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={buttonClassName}
      >
        <span>{label}</span>
        <span className="text-zinc-500">{enabledCount}/{workflows.length}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>

      {open && (
        <div className={`absolute z-50 mt-1 w-80 rounded-md border border-zinc-700 bg-zinc-900 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}>
          <div className="border-b border-zinc-800 px-3 py-2">
            <div className="text-[10px] font-medium text-zinc-300">Enabled for AI</div>
            <div className="text-[9px] text-zinc-500">Unchecked workflows stay configured, but are hidden from chat and default workflow selection.</div>
          </div>

          <div className="max-h-72 overflow-y-auto p-1.5">
            {loading ? (
              <div className="px-2 py-3 text-[10px] text-zinc-500">Loading workflows...</div>
            ) : workflows.length === 0 ? (
              <div className="px-2 py-3 text-[10px] text-zinc-500">No ComfyUI workflows configured.</div>
            ) : (
              workflows.map((workflow) => {
                const disabled = savingId === workflow.id;
                return (
                  <label
                    key={workflow.id}
                    className={`flex cursor-pointer items-start gap-2 rounded px-2 py-1.5 hover:bg-zinc-800 ${disabled ? "opacity-60" : ""}`}
                  >
                    <input
                      type="checkbox"
                      checked={workflow.enabled}
                      disabled={disabled}
                      onChange={() => void handleToggle(workflow)}
                      className="mt-0.5 rounded border-zinc-600 bg-zinc-800"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[10px] text-zinc-200">{workflow.name}</span>
                        <span className="shrink-0 rounded bg-zinc-800 px-1 py-0.5 text-[9px] uppercase text-zinc-400">
                          {workflow.workflowType}
                        </span>
                        {workflow.isDefault ? (
                          <span className="shrink-0 text-[9px] text-yellow-400">default</span>
                        ) : null}
                      </span>
                      {workflow.description ? (
                        <span className="mt-0.5 block text-[9px] text-zinc-500">{workflow.description}</span>
                      ) : null}
                    </span>
                  </label>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
