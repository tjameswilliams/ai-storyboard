import { api } from "../../api/client";
import { useStore } from "../../store";
import { makeConversationKey } from "../../lib/conversationKey";
import type { StoryboardImage, Project } from "../../types";

const STATUS_STYLE: Record<StoryboardImage["status"], { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "bg-zinc-700/70 text-zinc-300" },
  generating: { label: "Generating…", cls: "bg-blue-600/80 text-white" },
  generated: { label: "Ready", cls: "bg-emerald-600/80 text-white" },
  failed: { label: "Failed", cls: "bg-red-600/80 text-white" },
};

export function StoryboardCell({
  image,
  index,
  project,
  isDragging,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onContextMenu,
}: {
  image: StoryboardImage;
  index: number;
  project: Project;
  isDragging: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const selectImage = useStore((s) => s.selectImage);
  const generatingImageIds = useStore((s) => s.generatingImageIds);
  const isGenerating = image.status === "generating" || generatingImageIds.has(image.id);
  // Is an agent run working this frame's side conversation in the background?
  const agentWorking = useStore(
    (s) => s.activeRuns[makeConversationKey("image", image.id)]?.status === "running",
  );

  const status = STATUS_STYLE[image.status];
  const desc = image.layout.high_level_description?.trim();

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onContextMenu={onContextMenu}
      onClick={() => selectImage(image.id)}
      className={`group relative rounded-lg border bg-zinc-900 overflow-hidden cursor-pointer transition-colors ${
        isDragging ? "opacity-40" : "border-zinc-800 hover:border-zinc-600"
      }`}
    >
      {/* Image area, reserving the project aspect ratio */}
      <div
        className="relative w-full bg-zinc-950"
        style={{ aspectRatio: `${project.width} / ${project.height}` }}
      >
        {image.filePath ? (
          <img
            src={api.mediaUrl(image.filePath)}
            alt={image.name || `Frame ${index + 1}`}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
          />
        ) : (
          <div className="absolute inset-2 rounded-md border border-dashed border-zinc-700 flex items-center justify-center text-[10px] text-zinc-600">
            {isGenerating ? "Generating…" : "No image yet"}
          </div>
        )}

        {/* Order badge */}
        <div className="absolute top-1.5 left-1.5 w-5 h-5 rounded-full bg-black/60 text-white text-[10px] font-semibold flex items-center justify-center">
          {index + 1}
        </div>

        {/* Agent-working indicator: this frame's side chat has a run in flight. */}
        {agentWorking && (
          <div
            className="absolute bottom-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded bg-violet-600/80 text-white text-[9px] font-medium"
            title="Agent is working on this frame"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
            Agent
          </div>
        )}

        {/* Status chip */}
        <div className={`absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${status.cls}`}>
          {isGenerating ? "Generating…" : status.label}
        </div>
      </div>

      {/* Caption */}
      <div className="px-2 py-1.5">
        <div
          className="text-[11px] text-zinc-300 leading-snug"
          style={{
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {desc || <span className="text-zinc-600 italic">Untitled frame</span>}
        </div>
      </div>
    </div>
  );
}
