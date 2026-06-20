import type { CSSProperties } from "react";

const paths = {
  play: "M6 4l14 8-14 8z",
  pause: "M7 4h3v16H7zM14 4h3v16h-3z",
  stop: "M6 6h12v12H6z",
  skipBack: "M19 4l-12 8 12 8zM5 4v16",
  skipFwd: "M5 4l12 8-12 8zM19 4v16",
  text: "M5 6h14M5 6V5M19 6V5M12 6v14",
  shape: "M4 4h16v16H4z M4 10h16M10 4v16",
  export: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 001 1h14a1 1 0 001-1v-3",
  plus: "M12 5v14M5 12h14",
  minus: "M5 12h14",
  attach: "M21 11.5l-9 9a5 5 0 11-7-7l9-9a3.5 3.5 0 015 5l-9 9a2 2 0 11-3-3l8-8",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4z",
  plan: "M9 4h6a1 1 0 011 1v1h2a2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h2V5a1 1 0 011-1zM9 13l2 2 4-4",
  copy: "M9 9h10v10H9zM5 5h10v4M5 5v10h4",
  caret: "M9 6l6 6-6 6",
  caretD: "M6 9l6 6 6-6",
  caretU: "M6 15l6-6 6 6",
  x: "M6 6l12 12M18 6l-12 12",
  check: "M5 12l5 5 9-12",
  folder: "M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  film: "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM3 8h18M3 16h18M8 3v18M16 3v18",
  music: "M9 18V5l12-2v13M9 18a3 3 0 11-3-3 3 3 0 013 3zM21 16a3 3 0 11-3-3 3 3 0 013 3z",
  image: "M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2zM8.5 11a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM21 15l-5-5L5 21",
  type: "M5 5h14M12 5v14M9 19h6",
  sparkle: "M12 3l1.7 5 5 1.7-5 1.7L12 17l-1.7-5-5-1.7 5-1.7zM19 16l.85 2.5L22 19l-2.5.85L19 22l-.85-2.5L16 19l2.5-.85z",
  wand: "M15 4l5 5L7 22l-5-5zM14 5l5 5M3 4l1 1M19 19l1 1M3 19l1-1M19 4l1 1",
  mic: "M12 2a3 3 0 00-3 3v6a3 3 0 006 0V5a3 3 0 00-3-3zM5 11a7 7 0 0014 0M12 18v3M9 21h6",
  search: "M11 11m-7 0a7 7 0 1014 0a7 7 0 10-14 0M21 21l-4-4",
  settings:
    "M12 9a3 3 0 100 6 3 3 0 000-6zM19 12a7 7 0 00-.1-1.2l2.1-1.6-2-3.4-2.5 1a7 7 0 00-2-1.2L14 3h-4l-.5 2.6a7 7 0 00-2 1.2l-2.5-1-2 3.4 2.1 1.6A7 7 0 005 12a7 7 0 00.1 1.2l-2.1 1.6 2 3.4 2.5-1a7 7 0 002 1.2L10 21h4l.5-2.6a7 7 0 002-1.2l2.5 1 2-3.4-2.1-1.6c.1-.4.1-.8.1-1.2z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  more_v: "M12 5h.01M12 12h.01M12 19h.01",
  zoom_in: "M21 21l-4.3-4.3M11 8v6M8 11h6M11 4a7 7 0 110 14 7 7 0 010-14z",
  zoom_out: "M21 21l-4.3-4.3M8 11h6M11 4a7 7 0 110 14 7 7 0 010-14z",
  scissors: "M6 4a3 3 0 100 6 3 3 0 000-6zM6 14a3 3 0 100 6 3 3 0 000-6zM8 9l12 12M8 15L20 3",
  speed: "M12 14l4-4M5 19A8 8 0 1119 9.6M12 6V4M5 12H3M19 12h-2",
  layers: "M12 3l9 5-9 5-9-5zM3 12l9 5 9-5M3 17l9 5 9-5",
  bell: "M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9zM10 21a2 2 0 004 0",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 22a8 8 0 0116 0",
  users: "M16 14a4 4 0 100-8 4 4 0 000 8zM7 10a3 3 0 100-6 3 3 0 000 6zM3 18a4 4 0 014-4M9 22a7 7 0 0114 0",
  download: "M12 3v12m0 0l-4-4m4 4l4-4M4 17v3a1 1 0 001 1h14a1 1 0 001-1v-3",
  link: "M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1",
  globe: "M12 22a10 10 0 100-20 10 10 0 000 20zM2 12h20M12 2a14 14 0 010 20M12 2a14 14 0 000 20",
  command:
    "M9 9V6a3 3 0 00-3-3h0a3 3 0 00-3 3v0a3 3 0 003 3h12a3 3 0 003-3v0a3 3 0 00-3-3h0a3 3 0 00-3 3v3M9 9v6M15 9v6M9 15v3a3 3 0 01-3 3h0a3 3 0 01-3-3v0a3 3 0 013-3h12a3 3 0 013 3v0a3 3 0 01-3 3h0a3 3 0 01-3-3v-3M9 15h6",
  history: "M3 9a9 9 0 119 9M3 9V4M3 9h5M12 8v4l3 2",
  brain: "M12 4a3 3 0 00-3 3v1a3 3 0 00-3 3v0a3 3 0 003 3v1a3 3 0 003 3M12 4a3 3 0 013 3v1a3 3 0 013 3v0a3 3 0 01-3 3v1a3 3 0 01-3 3M12 4v16",
  chip: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3M6 6h12v12H6z",
  loader: "M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83",
  thumbsUp: "M7 22V11M2 13v7a2 2 0 002 2h13a3 3 0 002.83-2L22 12a2 2 0 00-2-2.6h-6L15 5a2.5 2.5 0 00-2.5-3L7 11",
  thumbsDown: "M17 2v11M22 11V4a2 2 0 00-2-2H7a3 3 0 00-2.83 2L2 12a2 2 0 002 2.6h6L9 19a2.5 2.5 0 002.5 3L17 13",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
} as const;

export type IconName = keyof typeof paths;

export interface IconProps {
  name: IconName;
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

export function Icon({ name, size = 14, className, style, strokeWidth = 1.75 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}
