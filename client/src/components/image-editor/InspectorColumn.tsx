import { LayoutMetaPanel } from "./LayoutMetaPanel";
import { RegionInspector } from "./RegionInspector";
import { JsonLayoutEditor } from "./JsonLayoutEditor";
import type { StoryboardImage } from "../../types";

export function InspectorColumn({ image }: { image: StoryboardImage }) {
  return (
    <div className="w-[320px] shrink-0 border-l border-zinc-800 bg-zinc-900 overflow-y-auto">
      <LayoutMetaPanel image={image} />
      <RegionInspector image={image} />
      <JsonLayoutEditor image={image} />
    </div>
  );
}
