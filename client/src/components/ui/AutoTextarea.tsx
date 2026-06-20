import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Optional pixel cap; beyond it the textarea stops growing and scrolls. */
  maxHeight?: number;
};

/**
 * A textarea that grows to fit its content. Resizes on input and whenever the
 * controlled `value` changes (so external resets shrink it back). Honors an
 * optional `maxHeight` (px) after which it scrolls. Any `min-height` set via
 * className/style still applies as the floor (CSS min-height beats the inline
 * height we set).
 */
export const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(function AutoTextarea(
  { maxHeight, onInput, style, className, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => innerRef.current as HTMLTextAreaElement, []);

  const resize = () => {
    const el = innerRef.current;
    if (!el) return;
    el.style.height = "auto";
    const target = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${target}px`;
    el.style.overflowY = maxHeight && el.scrollHeight > maxHeight ? "auto" : "hidden";
  };

  // Resize on mount and whenever the controlled value changes.
  useLayoutEffect(resize, [rest.value]);

  return (
    <textarea
      ref={innerRef}
      className={className}
      style={{ resize: "none", overflowY: "hidden", ...style }}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      {...rest}
    />
  );
});
