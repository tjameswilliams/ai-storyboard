import { useEffect, useState } from "react";
import { useStore } from "../../store";

function formatAge(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.floor((Date.now() - then) / 60_000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export function StyleguideBrowser() {
  const styleguides = useStore((s) => s.styleguides);
  const loadStyleguides = useStore((s) => s.loadStyleguides);
  const loadStyleguide = useStore((s) => s.loadStyleguide);
  const createStyleguide = useStore((s) => s.createStyleguide);
  const deleteStyleguide = useStore((s) => s.deleteStyleguide);
  const activeStyleguideId = useStore((s) => s.activeStyleguideId);

  const [newName, setNewName] = useState("");

  useEffect(() => {
    loadStyleguides();
  }, [loadStyleguides]);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    const sg = await createStyleguide(name);
    setNewName("");
    await loadStyleguide(sg.id);
  };

  return (
    <div className="flex-1 flex flex-col p-3 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold text-zinc-400 text-xs uppercase tracking-wider">
          Styleguides
        </div>
      </div>

      <div className="flex gap-1 mb-3">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="New styleguide..."
          className="flex-1 bg-zinc-800 text-zinc-200 text-xs px-2 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleCreate}
          className="text-xs px-2 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
        >
          +
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-1">
        {styleguides.length === 0 && (
          <div className="text-zinc-600 text-[11px] px-2 py-3 italic">
            No styleguides yet. Create one to start building your brand kit.
          </div>
        )}
        {styleguides.map((sg) => {
          const isActive = activeStyleguideId === sg.id;
          return (
            <div
              key={sg.id}
              className={`flex items-start justify-between px-2 py-1.5 rounded cursor-pointer text-xs group ${
                isActive
                  ? "bg-zinc-700 text-white"
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              }`}
              onClick={() => loadStyleguide(sg.id)}
            >
              <div className="flex-1 min-w-0">
                <div className="truncate">{sg.name}</div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-1.5 mt-0.5">
                  <span>{formatAge(sg.updatedAt)}</span>
                  {sg.attachedProjectCount !== undefined && sg.attachedProjectCount > 0 && (
                    <span className="px-1 rounded bg-blue-900/40 text-blue-300">
                      {sg.attachedProjectCount} project{sg.attachedProjectCount === 1 ? "" : "s"}
                    </span>
                  )}
                </div>
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm(`Delete styleguide "${sg.name}"? This cannot be undone.`)) {
                    deleteStyleguide(sg.id);
                  }
                }}
                className="text-zinc-500 hover:text-red-400 ml-1 opacity-0 group-hover:opacity-100"
              >
                x
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
