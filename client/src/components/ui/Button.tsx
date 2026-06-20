import { forwardRef, type ButtonHTMLAttributes, type CSSProperties, type ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

type Variant = "primary" | "destructive" | "plan" | "ghost" | "panel" | "text" | "shape" | "exp";
type Size = "xs" | "sm" | "md" | "lg";

const variants: Record<Variant, { bg: string; bgHover: string; fg: string; border: string; shadow: string }> = {
  primary: {
    bg: "linear-gradient(180deg, #3b82f6 0%, #2563eb 100%)",
    bgHover: "linear-gradient(180deg, #60a5fa 0%, #3b82f6 100%)",
    fg: "#fff",
    border: "1px solid rgba(96, 165, 250, 0.6)",
    shadow: "0 1px 0 rgba(255,255,255,0.15) inset, 0 1px 2px rgba(0,0,0,0.3)",
  },
  destructive: {
    bg: "linear-gradient(180deg, #ef4444 0%, #dc2626 100%)",
    bgHover: "linear-gradient(180deg, #f87171 0%, #ef4444 100%)",
    fg: "#fff",
    border: "1px solid rgba(248, 113, 113, 0.5)",
    shadow: "0 1px 0 rgba(255,255,255,0.12) inset, 0 1px 2px rgba(0,0,0,0.3)",
  },
  plan: {
    bg: "linear-gradient(180deg, rgba(180,83,9,0.6) 0%, rgba(120,53,15,0.7) 100%)",
    bgHover: "linear-gradient(180deg, rgba(217,119,6,0.6) 0%, rgba(180,83,9,0.7) 100%)",
    fg: "#fde68a",
    border: "1px solid rgba(217,119,6,0.5)",
    shadow: "0 0 0 1px rgba(180,83,9,0.3) inset",
  },
  ghost: {
    bg: "transparent",
    bgHover: "rgba(63,63,70,0.6)",
    fg: "#a1a1aa",
    border: "1px solid transparent",
    shadow: "none",
  },
  panel: {
    bg: "linear-gradient(180deg, #2d2d33 0%, #232328 100%)",
    bgHover: "linear-gradient(180deg, #38383f 0%, #2d2d33 100%)",
    fg: "#e4e4e7",
    border: "1px solid #3f3f46",
    shadow: "0 1px 0 rgba(255,255,255,0.04) inset, 0 1px 2px rgba(0,0,0,0.2)",
  },
  text: {
    bg: "linear-gradient(180deg, rgba(124,58,237,0.18) 0%, rgba(124,58,237,0.08) 100%)",
    bgHover: "linear-gradient(180deg, rgba(139,92,246,0.25) 0%, rgba(124,58,237,0.15) 100%)",
    fg: "#c4b5fd",
    border: "1px solid rgba(139,92,246,0.3)",
    shadow: "0 1px 0 rgba(196,181,253,0.08) inset",
  },
  shape: {
    bg: "linear-gradient(180deg, rgba(220,38,38,0.18) 0%, rgba(220,38,38,0.08) 100%)",
    bgHover: "linear-gradient(180deg, rgba(239,68,68,0.25) 0%, rgba(220,38,38,0.15) 100%)",
    fg: "#fca5a5",
    border: "1px solid rgba(239,68,68,0.3)",
    shadow: "0 1px 0 rgba(252,165,165,0.08) inset",
  },
  exp: {
    bg: "linear-gradient(180deg, #10b981 0%, #059669 100%)",
    bgHover: "linear-gradient(180deg, #34d399 0%, #10b981 100%)",
    fg: "#fff",
    border: "1px solid rgba(52,211,153,0.5)",
    shadow: "0 1px 0 rgba(255,255,255,0.15) inset, 0 1px 2px rgba(0,0,0,0.3)",
  },
};

const sizes: Record<Size, { h: number; padX: number; font: number; gap: number }> = {
  xs: { h: 22, padX: 8, font: 11, gap: 5 },
  sm: { h: 26, padX: 10, font: 11.5, gap: 6 },
  md: { h: 30, padX: 12, font: 12.5, gap: 7 },
  lg: { h: 34, padX: 16, font: 13, gap: 8 },
};

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  iconRight?: IconName;
  kbd?: string;
  children?: ReactNode;
  style?: CSSProperties;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", icon, iconRight, kbd, children, disabled, style, className, ...rest },
  ref,
) {
  const v = variants[variant];
  const sz = sizes[size];

  // Per-instance CSS vars let us swap gradient on :hover via pure CSS without
  // generating a JIT class per variant.
  const cssVars = {
    "--btn-bg": v.bg,
    "--btn-bg-hover": v.bgHover,
    height: `${sz.h}px`,
    padding: `0 ${sz.padX}px`,
    fontSize: `${sz.font}px`,
    color: v.fg,
    border: v.border,
    boxShadow: v.shadow,
    background: "var(--btn-bg)",
    gap: `${sz.gap}px`,
    transition:
      "background 120ms cubic-bezier(0.2,0,0,1), box-shadow 100ms, transform 60ms",
    ...style,
  } as CSSProperties;

  return (
    <button
      ref={ref}
      disabled={disabled}
      className={[
        "inline-flex items-center font-medium leading-none whitespace-nowrap rounded-[5px] cursor-pointer",
        "tracking-[0.005em]",
        "hover:[background:var(--btn-bg-hover)]",
        "active:translate-y-[0.5px] active:shadow-[inset_0_1px_2px_rgba(0,0,0,0.25)]",
        "disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:[background:var(--btn-bg)]",
        className ?? "",
      ].join(" ")}
      style={cssVars}
      {...rest}
    >
      {icon && <Icon name={icon} size={Math.round(sz.font + 1)} />}
      {children}
      {iconRight && <Icon name={iconRight} size={Math.round(sz.font + 1)} />}
      {kbd && (
        <span
          className="ml-1 px-1 text-[9px] rounded-sm border border-white/10 bg-black/25 text-white/60"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          {kbd}
        </span>
      )}
    </button>
  );
});
