import { useStore } from "../../store";
import { StyleguideBuilderPane } from "../styleguide/StyleguideBuilderPane";
import { StoryboardGrid } from "./StoryboardGrid";
import { ImageEditorPane } from "../image-editor/ImageEditorPane";
import { ImageViewerModal } from "./ImageViewerModal";

export function StoryboardPane() {
  const activeStyleguideId = useStore((s) => s.activeStyleguideId);
  const project = useStore((s) => s.project);
  const selectedImageId = useStore((s) => s.selectedImageId);

  if (activeStyleguideId) {
    return <StyleguideBuilderPane />;
  }

  if (!project) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950 text-zinc-500 text-sm">
        Create or open a storyboard
      </div>
    );
  }

  return (
    <>
      {selectedImageId ? <ImageEditorPane /> : <StoryboardGrid />}
      <ImageViewerModal />
    </>
  );
}
