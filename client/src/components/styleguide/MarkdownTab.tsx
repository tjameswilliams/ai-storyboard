import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CodeMirror from "@uiw/react-codemirror";
import { markdown as mdLang } from "@codemirror/lang-markdown";
import { useStore } from "../../store";

const previewComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-2xl font-bold mb-3 mt-4 first:mt-0 text-zinc-100">{children}</h1>,
  h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-xl font-semibold mb-2 mt-4 text-zinc-100">{children}</h2>,
  h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-base font-semibold mb-2 mt-3 text-zinc-200">{children}</h3>,
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-3 leading-relaxed text-zinc-300">{children}</p>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="list-disc ml-5 mb-3 text-zinc-300">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal ml-5 mb-3 text-zinc-300">{children}</ol>,
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-1">{children}</li>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-zinc-100">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="italic">{children}</em>,
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-zinc-600 pl-3 my-3 text-zinc-400 italic">{children}</blockquote>
  ),
  code: ({ children, className }: { children?: React.ReactNode; className?: string }) => {
    const isBlock = className?.includes("language-");
    return isBlock
      ? <code className="block bg-zinc-900 rounded p-3 my-3 text-xs font-mono overflow-x-auto whitespace-pre text-zinc-200">{children}</code>
      : <code className="bg-zinc-900 rounded px-1.5 py-0.5 text-xs font-mono text-zinc-200">{children}</code>;
  },
  pre: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">{children}</a>
  ),
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="overflow-x-auto mb-3">
      <table className="border-collapse border border-zinc-700 text-sm">{children}</table>
    </div>
  ),
  th: ({ children }: { children?: React.ReactNode }) => <th className="border border-zinc-700 px-2 py-1 bg-zinc-900 text-zinc-200">{children}</th>,
  td: ({ children }: { children?: React.ReactNode }) => <td className="border border-zinc-700 px-2 py-1 text-zinc-300">{children}</td>,
};

export function MarkdownTab() {
  const sg = useStore((s) => s.activeStyleguide);
  const updateStyleguide = useStore((s) => s.updateStyleguide);

  const [draft, setDraft] = useState<string>(sg?.markdown ?? "");
  const [showPreview, setShowPreview] = useState<boolean>(true);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty">("saved");
  const saveTimer = useRef<number | null>(null);
  const lastSyncedId = useRef<string | null>(null);

  // Sync local draft when the active styleguide switches (or first load)
  useEffect(() => {
    if (!sg) return;
    if (lastSyncedId.current !== sg.id) {
      setDraft(sg.markdown ?? "");
      setSaveStatus("saved");
      lastSyncedId.current = sg.id;
    }
  }, [sg?.id, sg?.markdown]);

  // Debounced autosave on change
  const onChange = (value: string) => {
    setDraft(value);
    setSaveStatus("dirty");
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      if (!sg) return;
      setSaveStatus("saving");
      try {
        await updateStyleguide(sg.id, { markdown: value });
        setSaveStatus("saved");
      } catch {
        setSaveStatus("dirty");
      }
    }, 600);
  };

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, []);

  if (!sg) return null;

  return (
    <div className="h-full flex flex-col">
      <div className="h-9 px-3 flex items-center justify-between border-b border-zinc-800 shrink-0 bg-zinc-900">
        <div className="text-[11px] text-zinc-500">
          {saveStatus === "saved" && "All changes saved"}
          {saveStatus === "saving" && "Saving..."}
          {saveStatus === "dirty" && "Unsaved changes"}
        </div>
        <button
          onClick={() => setShowPreview((v) => !v)}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-0.5 rounded hover:bg-zinc-800"
        >
          {showPreview ? "Hide preview" : "Show preview"}
        </button>
      </div>

      <div className="flex-1 min-h-0 flex">
        <div className={`${showPreview ? "w-1/2 border-r border-zinc-800" : "w-full"} overflow-auto`}>
          <CodeMirror
            value={draft}
            height="100%"
            theme="dark"
            extensions={[mdLang()]}
            onChange={onChange}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLine: false,
              highlightActiveLineGutter: false,
            }}
            className="h-full text-sm"
          />
        </div>
        {showPreview && (
          <div className="w-1/2 overflow-auto p-6 bg-zinc-950">
            {draft.trim().length === 0 ? (
              <div className="text-zinc-600 text-sm italic">
                Start writing your brand doc on the left. Describe your voice, colors, typography, logo usage, and any do/don't rules for the LLM to follow when generating video.
              </div>
            ) : (
              <Markdown remarkPlugins={[remarkGfm]} components={previewComponents as never}>{draft}</Markdown>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
