import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Icon, type IconName } from "./Icon";

type Size = "sm" | "md" | "lg";

const dim: Record<Size, number> = { sm: 24, md: 28, lg: 32 };

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style" | "title"> {
  icon: IconName;
  size?: Size;
  active?: boolean;
  tooltip?: string;
  style?: CSSProperties;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, size = "md", active, tooltip, className, style, ...rest },
  ref,
) {
  const px = dim[size];
  const iconSize = Math.round(px * 0.55);

  return (
    <button
      ref={ref}
      title={tooltip}
      aria-label={tooltip}
      className={[
        "inline-flex items-center justify-center rounded-[5px] transition-colors duration-[120ms] cursor-pointer",
        active
          ? "text-fg-1 border border-border-strong shadow-[0_1px_0_rgba(255,255,255,0.05)_inset] [background:linear-gradient(180deg,#38383f_0%,#2d2d33_100%)]"
          : "text-fg-muted hover:text-fg-2 hover:bg-zinc-700/50 border border-transparent",
        "disabled:opacity-45 disabled:cursor-not-allowed",
        className ?? "",
      ].join(" ")}
      style={{ width: px, height: px, ...style }}
      {...rest}
    >
      <Icon name={icon} size={iconSize} />
    </button>
  );
});
