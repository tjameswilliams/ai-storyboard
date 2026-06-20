import { useState } from "react";
import type { Plan, PlanStep } from "../../types";

function StepIcon({ status }: { status: PlanStep["status"] }) {
  switch (status) {
    case "completed":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-emerald-400 shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M8 12l3 3 5-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case "in_progress":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-blue-400 shrink-0 animate-spin">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeDasharray="31.4 31.4" strokeLinecap="round" />
        </svg>
      );
    case "failed":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-red-400 shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M15 9l-6 6M9 9l6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    case "skipped":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-500 shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
          <path d="M8 12h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      );
    default: // pending
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-zinc-600 shrink-0">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" />
        </svg>
      );
  }
}

function StatusBadge({ status }: { status: Plan["status"] }) {
  const colors: Record<string, string> = {
    draft: "bg-amber-900/50 text-amber-300",
    approved: "bg-blue-900/50 text-blue-300",
    executing: "bg-blue-900/50 text-blue-300",
    completed: "bg-emerald-900/50 text-emerald-300",
    cancelled: "bg-zinc-800 text-zinc-500",
  };
  const labels: Record<string, string> = {
    draft: "Draft",
    approved: "Approved",
    executing: "Executing",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium ${colors[status] || colors.draft}`}>
      {labels[status] || status}
    </span>
  );
}

export function PlanChecklist({
  plan,
  onApprove,
  onCancel,
  onDismiss,
}: {
  plan: Plan;
  onApprove: () => void;
  onCancel: () => void;
  onDismiss: () => void;
}) {
  // Auto-collapse for large plans
  const [collapsed, setCollapsed] = useState(plan.steps.length > 8);

  const completedCount = plan.steps.filter((s) => s.status === "completed").length;
  const totalSteps = plan.steps.length;
  const progress = totalSteps > 0 ? (completedCount / totalSteps) * 100 : 0;

  return (
    <div className="bg-zinc-900 border border-zinc-700 rounded-lg overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-zinc-800/50 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="currentColor"
            className={`text-zinc-500 shrink-0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
          >
            <path d="M7 10l5 5 5-5z" />
          </svg>
          <span className="text-xs font-medium text-zinc-200 truncate">{plan.title}</span>
          <StatusBadge status={plan.status} />
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {plan.status === "executing" && (
            <span className="text-[10px] text-zinc-500">
              {completedCount}/{totalSteps}
            </span>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            className="w-4 h-4 flex items-center justify-center rounded hover:bg-zinc-700 text-zinc-600 hover:text-zinc-300"
            title="Remove plan"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </button>

      {/* Progress bar */}
      {(plan.status === "executing" || plan.status === "completed") && (
        <div className="h-0.5 bg-zinc-800">
          <div
            className={`h-full transition-all duration-500 ${plan.status === "completed" ? "bg-emerald-500" : "bg-blue-500"}`}
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Steps */}
      {!collapsed && (
        <div className="px-3 py-2 space-y-1.5 max-h-52 overflow-y-auto">
          {plan.steps.map((step, i) => (
            <div
              key={step.id}
              className={`flex items-start gap-2 ${step.status === "in_progress" ? "bg-blue-950/30 -mx-1.5 px-1.5 py-1 rounded" : ""}`}
            >
              <div className="mt-0.5">
                <StepIcon status={step.status} />
              </div>
              <div className="min-w-0 flex-1">
                <span
                  className={`text-[11px] leading-tight ${
                    step.status === "completed" ? "text-zinc-500 line-through" :
                    step.status === "in_progress" ? "text-zinc-200 font-medium" :
                    step.status === "failed" ? "text-red-400" :
                    step.status === "skipped" ? "text-zinc-600" :
                    "text-zinc-400"
                  }`}
                >
                  {i + 1}. {step.label}
                </span>
                {step.notes && (
                  <p className="text-[10px] text-zinc-600 mt-0.5">{step.notes}</p>
                )}
              </div>
            </div>
          ))}

        </div>
      )}

      {/* Draft action buttons — outside scroll area so always visible */}
      {!collapsed && plan.status === "draft" && (
        <div className="flex gap-2 px-3 py-2 border-t border-zinc-800">
          <button
            onClick={onApprove}
            className="text-[10px] px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium"
          >
            Approve Plan
          </button>
          <button
            onClick={onCancel}
            className="text-[10px] px-2.5 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
