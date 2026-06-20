import { useStore } from "../../store";
import { MarkdownTab } from "./MarkdownTab";
import { BrandAssetsTab } from "./BrandAssetsTab";

export function StyleguideBuilderPane() {
  const sg = useStore((s) => s.activeStyleguide);
  const tab = useStore((s) => s.styleguideBuilderTab);
  const setTab = useStore((s) => s.setStyleguideBuilderTab);

  if (!sg) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500 text-sm">
        Loading styleguide...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-zinc-950">
      {/* Header */}
      <div className="h-12 px-4 flex items-center gap-3 border-b border-zinc-800 shrink-0 bg-zinc-900">
        <div className="font-medium text-zinc-200 truncate">{sg.name}</div>
        {sg.attachedProjects && sg.attachedProjects.length > 0 && (
          <div className="text-[10px] text-zinc-500">
            Attached to {sg.attachedProjects.length} project{sg.attachedProjects.length === 1 ? "" : "s"}
          </div>
        )}
      </div>

      {/* Sub-tab bar */}
      <div className="flex border-b border-zinc-800 shrink-0 bg-zinc-900">
        {(["markdown", "assets"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium capitalize ${
              tab === t
                ? "text-zinc-200 border-b-2 border-blue-500"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t === "assets" ? "Brand Assets" : t}
          </button>
        ))}
      </div>

      {/* Tab body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {tab === "assets" ? <BrandAssetsTab /> : <MarkdownTab />}
      </div>
    </div>
  );
}
