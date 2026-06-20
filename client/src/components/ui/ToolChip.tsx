import type { ReactNode } from "react";

type Status = "executed" | "rejected" | "pending";

const styles: Record<
  Status,
  { bg: string; border: string; fg: string; iconColor: string; glyph: string }
> = {
  executed: {
    bg: "linear-gradient(180deg, rgba(6,78,59,0.6) 0%, rgba(6,78,59,0.4) 100%)",
    border: "1px solid rgba(16,185,129,0.3)",
    fg: "#6ee7b7",
    iconColor: "#10b981",
    glyph: "✓",
  },
  rejected: {
    bg: "linear-gradient(180deg, rgba(127,29,29,0.6) 0%, rgba(127,29,29,0.4) 100%)",
    border: "1px solid rgba(239,68,68,0.3)",
    fg: "#fca5a5",
    iconColor: "#ef4444",
    glyph: "✕",
  },
  pending: {
    bg: "linear-gradient(180deg, #2d2d33 0%, #232328 100%)",
    border: "1px solid #3f3f46",
    fg: "#d4d4d8",
    iconColor: "#3b82f6",
    glyph: "◐",
  },
};

export interface ToolChipProps {
  status?: Status;
  name: string;
  label?: string;
  children?: ReactNode;
}

export function ToolChip({ status = "executed", name, label, children }: ToolChipProps) {
  const s = styles[status];
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-sm leading-tight"
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        padding: "3px 7px 3px 6px",
        background: s.bg,
        border: s.border,
        color: s.fg,
        boxShadow: "0 1px 0 rgba(255,255,255,0.04) inset",
      }}
    >
      <span
        className={status === "pending" ? "inline-block animate-spin" : "inline-block"}
        style={{ color: s.iconColor, fontSize: 10 }}
      >
        {s.glyph}
      </span>
      <span className="font-medium" style={{ color: s.fg }}>{name}</span>
      {label && (
        <span
          className="overflow-hidden text-ellipsis whitespace-nowrap"
          style={{ color: "#52525b", maxWidth: 140 }}
        >
          {label}
        </span>
      )}
      {children}
    </span>
  );
}
