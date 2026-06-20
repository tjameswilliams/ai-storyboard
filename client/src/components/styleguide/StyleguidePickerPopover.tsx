import { useEffect, useRef, useState } from "react";
import { useStore } from "../../store";

export function StyleguidePickerButton() {
  const project = useStore((s) => s.project);
  const projectStyleguides = useStore((s) => s.projectStyleguides);
  const loadProjectStyleguides = useStore((s) => s.loadProjectStyleguides);
  const loadStyleguide = useStore((s) => s.loadStyleguide);
  const detachStyleguide = useStore((s) => s.detachStyleguide);
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (project) loadProjectStyleguides();
  }, [project?.id]);

  if (!project) return null;

  return (
    <div className="flex items-center gap-1.5">
      <button
        ref={btnRef}
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 border border-zinc-700"
        title="Attach styleguides to this project"
      >
        Styleguides
        {projectStyleguides.length > 0 && (
          <span className="ml-1 text-blue-400">({projectStyleguides.length})</span>
        )}
      </button>
      {projectStyleguides.map((sg) => (
        <span
          key={sg.id}
          className="group inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-900/40 text-blue-300 cursor-pointer hover:bg-blue-900/60"
          title="Click to open this styleguide"
          onClick={() => loadStyleguide(sg.id)}
        >
          {sg.name}
          <button
            onClick={(e) => {
              e.stopPropagation();
              detachStyleguide(sg.id);
            }}
            className="text-blue-400 hover:text-red-400 opacity-60 group-hover:opacity-100"
            title="Detach from project"
          >
            x
          </button>
        </span>
      ))}
      {open && <StyleguidePickerPopover onClose={() => setOpen(false)} anchorRef={btnRef} />}
    </div>
  );
}

function StyleguidePickerPopover({
  onClose,
  anchorRef,
}: {
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const styleguides = useStore((s) => s.styleguides);
  const loadStyleguides = useStore((s) => s.loadStyleguides);
  const projectStyleguides = useStore((s) => s.projectStyleguides);
  const attachStyleguide = useStore((s) => s.attachStyleguide);
  const detachStyleguide = useStore((s) => s.detachStyleguide);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadStyleguides();
  }, [loadStyleguides]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current || !anchorRef.current) return;
      if (ref.current.contains(e.target as Node) || anchorRef.current.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose, anchorRef]);

  const attachedIds = new Set(projectStyleguides.map((s) => s.id));

  return (
    <div
      ref={ref}
      className="absolute top-10 right-4 z-50 w-72 bg-zinc-900 border border-zinc-700 rounded shadow-xl py-1 text-xs"
    >
      <div className="px-3 py-2 text-zinc-500 text-[10px] uppercase tracking-wider border-b border-zinc-800">
        Attach styleguides
      </div>
      {styleguides.length === 0 ? (
        <div className="px-3 py-4 text-zinc-500 text-center italic">
          No styleguides yet. Create one from the Styleguides tab in the sidebar.
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          {styleguides.map((sg) => {
            const attached = attachedIds.has(sg.id);
            return (
              <label
                key={sg.id}
                className="flex items-start gap-2 px-3 py-2 hover:bg-zinc-800 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={attached}
                  onChange={() => {
                    if (attached) detachStyleguide(sg.id);
                    else attachStyleguide(sg.id);
                  }}
                  className="mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-zinc-200 truncate">{sg.name}</div>
                  {sg.description && (
                    <div className="text-[10px] text-zinc-500 truncate">{sg.description}</div>
                  )}
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
