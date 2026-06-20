import { useState, useEffect } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { json } from "@codemirror/lang-json";
import { lintGutter } from "@codemirror/lint";
import { useStore } from "../../store";
import type { StoryboardImage, Layout } from "../../types";

export function JsonLayoutEditor({ image }: { image: StoryboardImage }) {
  const patchImageLayout = useStore((s) => s.patchImageLayout);
  const jsonError = useStore((s) => s.jsonError);
  const setJsonError = useStore((s) => s.setJsonError);
  const selectedImageId = useStore((s) => s.selectedImageId);

  const [focused, setFocused] = useState(false);
  const [localDraft, setLocalDraft] = useState("");

  // Reset local draft when the selected image changes so the editor re-derives
  // from the store for the newly-focused frame.
  useEffect(() => {
    setLocalDraft("");
    setFocused(false);
    setJsonError(null);
  }, [selectedImageId, setJsonError]);

  const derived = JSON.stringify(image.layout, null, 2);
  const value = focused ? localDraft : derived;

  const handleChange = (next: string) => {
    if (!focused) return; // store is the owner when not focused
    setLocalDraft(next);
    try {
      const parsed = JSON.parse(next) as Layout;
      setJsonError(null);
      patchImageLayout(image.id, parsed);
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON");
    }
  };

  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">Raw layout JSON</div>
      <div className="rounded border border-zinc-700 overflow-hidden">
        <CodeMirror
          value={value}
          height="260px"
          theme="dark"
          extensions={[json(), lintGutter()]}
          basicSetup={{ lineNumbers: true, foldGutter: true }}
          onFocus={() => {
            setLocalDraft(derived);
            setFocused(true);
          }}
          onBlur={() => {
            setFocused(false);
            setLocalDraft("");
            setJsonError(null);
          }}
          onChange={handleChange}
        />
      </div>
      {jsonError && <div className="text-[10px] text-red-400">{jsonError}</div>}
    </div>
  );
}
