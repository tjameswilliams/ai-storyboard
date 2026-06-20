import { useState, useEffect, useCallback } from "react";
import { AutoTextarea } from "./ui/AutoTextarea";
import { useStore } from "../store";
import { WorkflowCheckboxDropdown } from "./comfy/WorkflowCheckboxDropdown";

const TABS = [
  { id: "llm", label: "LLM" },
  { id: "embeddings", label: "Embeddings" },
  { id: "web", label: "Web" },
  { id: "comfyui", label: "ComfyUI" },
] as const;

type TabId = typeof TABS[number]["id"];

export function SettingsModal() {
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const setShowSettings = useStore((s) => s.setShowSettings);
  const [tab, setTab] = useState<TabId>("llm");

  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl || "http://localhost:11434/v1");
  const [apiKey, setApiKey] = useState(settings.apiKey || "");
  const [model, setModel] = useState(settings.model || "llama3.2");
  const [temperature, setTemperature] = useState(settings.temperature || "0.7");
  const [contextWindow, setContextWindow] = useState(settings.contextWindow || "128000");
  const [embeddingApiBaseUrl, setEmbeddingApiBaseUrl] = useState(settings.embeddingApiBaseUrl || "");
  const [embeddingApiKey, setEmbeddingApiKey] = useState(settings.embeddingApiKey || "");
  const [embeddingModel, setEmbeddingModel] = useState(settings.embeddingModel || "text-embedding-3-small");
  const [braveSearchApiKey, setBraveSearchApiKey] = useState(settings.braveSearchApiKey || "");
  const [googleSearchApiKey, setGoogleSearchApiKey] = useState(settings.googleSearchApiKey || "");
  const [googleSearchCx, setGoogleSearchCx] = useState(settings.googleSearchCx || "");

  useEffect(() => {
    setApiBaseUrl(settings.apiBaseUrl || "http://localhost:11434/v1");
    setApiKey(settings.apiKey || "");
    setModel(settings.model || "llama3.2");
    setTemperature(settings.temperature || "0.7");
    setContextWindow(settings.contextWindow || "128000");
    setEmbeddingApiBaseUrl(settings.embeddingApiBaseUrl || "");
    setEmbeddingApiKey(settings.embeddingApiKey || "");
    setEmbeddingModel(settings.embeddingModel || "text-embedding-3-small");
    setBraveSearchApiKey(settings.braveSearchApiKey || "");
    setGoogleSearchApiKey(settings.googleSearchApiKey || "");
    setGoogleSearchCx(settings.googleSearchCx || "");
  }, [settings]);

  const handleSave = async () => {
    await updateSettings({ apiBaseUrl, apiKey, model, temperature, contextWindow, embeddingApiBaseUrl, embeddingApiKey, embeddingModel, braveSearchApiKey, googleSearchApiKey, googleSearchCx });
    setShowSettings(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-[440px] max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 pt-5 pb-0">
          <h2 className="text-lg font-semibold text-zinc-200 mb-3">Settings</h2>

          {/* Tabs */}
          <div className="flex gap-1 border-b border-zinc-700">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs rounded-t transition-colors ${
                  tab === t.id
                    ? "bg-zinc-800 text-zinc-200 border-b-2 border-blue-500"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "llm" && (
            <div className="space-y-3">
              <Field label="API Base URL" value={apiBaseUrl} onChange={setApiBaseUrl} />
              <Field label="API Key" value={apiKey} onChange={setApiKey} type="password" />
              <Field label="Model" value={model} onChange={setModel} />
              <Field label="Temperature" value={temperature} onChange={setTemperature} />
              <Field label="Context Window" value={contextWindow} onChange={setContextWindow} />
            </div>
          )}

          {tab === "embeddings" && (
            <div className="space-y-3">
              <p className="text-[10px] text-zinc-500 mb-1">For semantic search across generated image prompts. Leave URL blank to use the main LLM API.</p>
              <Field label="Embedding API URL" value={embeddingApiBaseUrl} onChange={setEmbeddingApiBaseUrl} />
              <Field label="Embedding API Key" value={embeddingApiKey} onChange={setEmbeddingApiKey} type="password" />
              <Field label="Embedding Model" value={embeddingModel} onChange={setEmbeddingModel} />
            </div>
          )}

          {tab === "web" && (
            <div className="space-y-3">
              <p className="text-[10px] text-zinc-500 mb-1">Configure the web_search tool used by the AI for research and finding stock imagery. Brave is recommended (free tier: 2000 queries/month at <a href="https://brave.com/search/api/" target="_blank" rel="noreferrer" className="underline">brave.com/search/api/</a>). Falls back to DuckDuckGo if none are set — may hit CAPTCHA under heavy use.</p>
              <Field label="Brave Search API Key" value={braveSearchApiKey} onChange={setBraveSearchApiKey} type="password" />
              <div className="pt-2 border-t border-zinc-800">
                <p className="text-[10px] text-zinc-500 mb-2">Or use Google Custom Search (requires an API key and a Custom Search Engine ID).</p>
                <div className="space-y-2">
                  <Field label="Google Search API Key" value={googleSearchApiKey} onChange={setGoogleSearchApiKey} type="password" />
                  <Field label="Google Search CX (engine ID)" value={googleSearchCx} onChange={setGoogleSearchCx} />
                </div>
              </div>
            </div>
          )}

          {tab === "comfyui" && <ComfyUISettings />}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800">
          <button onClick={() => setShowSettings(false)} className="text-xs px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300">
            Cancel
          </button>
          <button onClick={handleSave} className="text-xs px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white">
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label, type = "text", value, onChange, placeholder,
}: {
  label: string; type?: string; value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-zinc-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}

function ComfyUISettings() {
  const workflows = useStore((s) => s.workflows);
  const loadingWorkflows = useStore((s) => s.loadingWorkflows);
  const loadWorkflows = useStore((s) => s.loadWorkflows);
  const toggleWorkflow = useStore((s) => s.toggleWorkflow);
  const [url, setUrl] = useState("http://localhost:8188");
  const [testResult, setTestResult] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/plugins/comfyui/config").then((r) => r.json()).then((c) => {
      if (c.baseUrl) setUrl(c.baseUrl);
    }).catch(() => {});
    loadWorkflows();
  }, [loadWorkflows]);

  const handleSaveUrl = async () => {
    await fetch("/api/plugins/comfyui/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseUrl: url }),
    });
  };

  const handleTest = async () => {
    setTestResult("Testing...");
    try {
      const res = await fetch("/api/plugins/comfyui/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: url }),
      });
      const data = await res.json();
      setTestResult(data.success ? "Connected!" : "Connection failed");
    } catch { setTestResult("Connection failed"); }
    setTimeout(() => setTestResult(null), 3000);
  };

  const handleUploadWorkflow = async () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setUploading(true);
      try {
        const text = await file.text();
        const analysisRes = await fetch("/api/plugins/comfyui/analyze-workflow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ workflowJson: text }),
        });
        const analysis = await analysisRes.json();

        await fetch("/api/plugins/comfyui/workflows", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name.replace(/\.json$/, ""),
            workflowType: analysis.suggestedType,
            workflowJson: text,
            promptNodeId: analysis.promptNodeId,
            outputNodeId: analysis.outputNodeId,
            imageInputNodeId: analysis.imageInputNodeId,
            defaultCfg: analysis.cfg,
            isDefault: workflows.length === 0,
          }),
        });
        loadWorkflows();
      } catch (err) {
        console.error("Workflow upload failed:", err);
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleDeleteWorkflow = async (id: string) => {
    await fetch(`/api/plugins/comfyui/workflows/${id}`, { method: "DELETE" });
    loadWorkflows();
  };

  const handleToggleWorkflow = async (id: string, enabled: boolean) => {
    await toggleWorkflow(id, enabled);
  };

  const handleSetDefault = async (id: string) => {
    await fetch(`/api/plugins/comfyui/workflows/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    loadWorkflows();
  };

  const typeColors: Record<string, string> = {
    t2i: "bg-blue-600/30 text-blue-300",
    i2i: "bg-purple-600/30 text-purple-300",
    t2v: "bg-green-600/30 text-green-300",
    i2v: "bg-orange-600/30 text-orange-300",
    t2m: "bg-pink-600/30 text-pink-300",
    tts: "bg-teal-600/30 text-teal-300",
    ia2v: "bg-cyan-600/30 text-cyan-300",
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-zinc-400 mb-1">ComfyUI Server URL</label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={handleSaveUrl}
            placeholder="http://localhost:8188"
            className="flex-1 bg-zinc-800 text-zinc-200 text-xs px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500"
          />
          <button onClick={handleTest} className="text-[10px] px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 shrink-0">
            Test
          </button>
        </div>
        {testResult && (
          <div className={`text-[10px] mt-1 ${testResult === "Connected!" ? "text-green-400" : testResult === "Testing..." ? "text-zinc-400" : "text-red-400"}`}>
            {testResult}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-zinc-400">Workflows</span>
        <div className="flex items-center gap-2">
          <WorkflowCheckboxDropdown
            workflows={workflows}
            loading={loadingWorkflows}
            onToggle={handleToggleWorkflow}
            buttonClassName="flex items-center gap-1.5 rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-700"
          />
          <button
            onClick={handleUploadWorkflow}
            disabled={uploading}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-600/80 hover:bg-blue-500 text-white disabled:opacity-50"
          >
            {uploading ? "Uploading..." : "+ Upload JSON"}
          </button>
        </div>
      </div>

      {workflows.length === 0 ? (
        <div className="text-[10px] text-zinc-600 text-center py-3 bg-zinc-800/30 rounded">
          No workflows configured. Upload a ComfyUI workflow JSON to get started.
        </div>
      ) : (
        <div className="space-y-1.5">
          {workflows.map((wf) => (
            <div key={wf.id} className="bg-zinc-800/50 rounded px-2 py-1.5">
              <div className="flex items-center gap-2">
                <span className={`text-[9px] px-1.5 py-0.5 rounded shrink-0 ${typeColors[wf.workflowType] || "bg-zinc-700 text-zinc-400"}`}>
                  {wf.workflowType}
                </span>
                <span className="text-[10px] text-zinc-300 flex-1 truncate">{wf.name}</span>
                <button
                  onClick={() => setEditingId(editingId === wf.id ? null : wf.id)}
                  className="text-[9px] text-zinc-500 hover:text-zinc-300"
                >
                  {editingId === wf.id ? "done" : "edit"}
                </button>
                {wf.isDefault ? (
                  <span className="text-[9px] text-yellow-400">default</span>
                ) : (
                  <button onClick={() => handleSetDefault(wf.id)} className="text-[9px] text-zinc-500 hover:text-zinc-300">
                    set default
                  </button>
                )}
                <button onClick={() => handleDeleteWorkflow(wf.id)} className="text-[9px] text-red-400 hover:text-red-300">
                  x
                </button>
              </div>
              {wf.description && editingId !== wf.id && (
                <div className="text-[9px] text-zinc-500 mt-1 ml-1">{wf.description}</div>
              )}
              {editingId === wf.id && (
                <WorkflowEditor
                  wfId={wf.id}
                  initial={{ ...wf, description: wf.description || "", postfix: wf.postfix || "", overrideBaseUrl: wf.overrideBaseUrl || "" }}
                  onSaved={loadWorkflows}
                />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WorkflowEditor({ wfId, initial, onSaved }: {
  wfId: string;
  initial: { name: string; description: string; workflowType: string; postfix?: string; overrideBaseUrl?: string; trimEndFrames?: number | null };
  onSaved: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [workflowType, setWorkflowType] = useState(initial.workflowType);
  const [postfix, setPostfix] = useState(initial.postfix || "");
  const [overrideBaseUrl, setOverrideBaseUrl] = useState(initial.overrideBaseUrl || "");
  const [trimEndFrames, setTrimEndFrames] = useState<number>(initial.trimEndFrames ?? 0);
  const isVideoType = workflowType === "t2v" || workflowType === "i2v" || workflowType === "ia2v" || workflowType === "fflf";
  const [showJson, setShowJson] = useState(false);
  const [jsonValue, setJsonValue] = useState<string>("");
  const [jsonLoading, setJsonLoading] = useState(false);
  const [jsonSaving, setJsonSaving] = useState(false);
  const [jsonStatus, setJsonStatus] = useState<string | null>(null);

  const saveField = useCallback(async (data: Record<string, unknown>) => {
    await fetch(`/api/plugins/comfyui/workflows/${wfId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    onSaved();
  }, [wfId, onSaved]);

  const analyzeAndSaveJson = useCallback(async (jsonStr: string) => {
    const analysisRes = await fetch("/api/plugins/comfyui/analyze-workflow", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workflowJson: jsonStr }),
    });
    const analysis = await analysisRes.json();
    const res = await fetch(`/api/plugins/comfyui/workflows/${wfId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workflowJson: jsonStr,
        promptNodeId: analysis.promptNodeId,
        outputNodeId: analysis.outputNodeId,
        imageInputNodeId: analysis.imageInputNodeId,
        defaultCfg: analysis.cfg,
      }),
    });
    if (!res.ok) throw new Error("Save failed");
    onSaved();
  }, [wfId, onSaved]);

  const handleToggleJson = async () => {
    if (showJson) {
      setShowJson(false);
      return;
    }
    setJsonLoading(true);
    try {
      const res = await fetch(`/api/plugins/comfyui/workflows/${wfId}?t=${Date.now()}`);
      const wf = await res.json();
      setJsonValue(JSON.stringify(JSON.parse(wf.workflowJson || "{}"), null, 2));
      setShowJson(true);
      setJsonStatus(null);
    } catch {
      setJsonValue("{}");
      setShowJson(true);
    } finally {
      setJsonLoading(false);
    }
  };

  const handleSaveJson = async () => {
    setJsonStatus(null);
    try {
      JSON.parse(jsonValue);
    } catch {
      setJsonStatus("Invalid JSON");
      return;
    }
    setJsonSaving(true);
    try {
      await analyzeAndSaveJson(jsonValue);
      setJsonStatus("Saved");
      setTimeout(() => setJsonStatus((s) => s === "Saved" ? null : s), 2000);
    } catch {
      setJsonStatus("Save failed");
    } finally {
      setJsonSaving(false);
    }
  };

  const handleReplaceJson = () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".json";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        JSON.parse(text);
        await analyzeAndSaveJson(text);
        if (showJson) {
          setJsonValue(JSON.stringify(JSON.parse(text), null, 2));
        }
        setJsonStatus("Replaced");
        setTimeout(() => setJsonStatus((s) => s === "Replaced" ? null : s), 2000);
      } catch (err) {
        setJsonStatus("Replace failed");
      }
    };
    input.click();
  };

  const inputCls = "w-full bg-zinc-900 text-zinc-200 text-[10px] px-1.5 py-1 rounded border border-zinc-700 focus:outline-none focus:border-blue-500";

  return (
    <div className="mt-2 space-y-1.5">
      <div>
        <label className="text-[9px] text-zinc-500 block mb-0.5">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => saveField({ name })}
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-[9px] text-zinc-500 block mb-0.5">Description (shown to AI agent)</label>
        <AutoTextarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => saveField({ description })}
          rows={2}
          placeholder="e.g., Best for cinematic 5-second clips at 720p."
          className={`${inputCls} resize-none`}
        />
      </div>
      <div>
        <label className="text-[9px] text-zinc-500 block mb-0.5">Type</label>
        <select
          value={workflowType}
          onChange={(e) => { setWorkflowType(e.target.value); saveField({ workflowType: e.target.value }); }}
          className={inputCls}
        >
          <option value="t2v">Text to Video (t2v)</option>
          <option value="i2v">Image to Video (i2v)</option>
          <option value="fflf">First Frame + Last Frame to Video (fflf)</option>
          <option value="t2i">Text to Image (t2i)</option>
          <option value="i2i">Image to Image (i2i)</option>
          <option value="t2m">Text to Music (t2m)</option>
          <option value="tts">Text to Speech (tts)</option>
          <option value="ia2v">Image+Audio to Video (ia2v)</option>
        </select>
      </div>
      <div>
        <label className="text-[9px] text-zinc-500 block mb-0.5">Prompt Postfix</label>
        <input
          type="text"
          value={postfix}
          onChange={(e) => setPostfix(e.target.value)}
          onBlur={() => saveField({ postfix })}
          placeholder="Style suffix appended to all prompts"
          className={inputCls}
        />
      </div>
      <div>
        <label className="text-[9px] text-zinc-500 block mb-0.5">Override Server URL (optional)</label>
        <input
          type="text"
          value={overrideBaseUrl}
          onChange={(e) => setOverrideBaseUrl(e.target.value)}
          onBlur={() => saveField({ overrideBaseUrl: overrideBaseUrl.trim() || null })}
          placeholder="Leave blank to use the global ComfyUI URL"
          className={inputCls}
        />
      </div>
      {isVideoType && (
        <div>
          <label className="text-[9px] text-zinc-500 block mb-0.5">Trim End Frames</label>
          <input
            type="number"
            min={0}
            value={trimEndFrames}
            onChange={(e) => setTrimEndFrames(Math.max(0, parseInt(e.target.value) || 0))}
            onBlur={() => saveField({ trimEndFrames })}
            placeholder="0"
            className={inputCls}
          />
          <div className="text-[9px] text-zinc-600 mt-0.5">Drops the last N frames after generation. Useful for models that produce garbage frames at the tail.</div>
        </div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleReplaceJson}
          className="text-[9px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
        >
          Replace JSON File
        </button>
        <button
          onClick={handleToggleJson}
          disabled={jsonLoading}
          className="text-[9px] px-2 py-1 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
        >
          {jsonLoading ? "Loading..." : showJson ? "Hide JSON" : "Edit JSON"}
        </button>
        {jsonStatus && (
          <span className={`text-[9px] ${jsonStatus === "Saved" || jsonStatus === "Replaced" ? "text-green-400" : "text-red-400"}`}>
            {jsonStatus}
          </span>
        )}
      </div>
      {showJson && (
        <div className="mt-1.5">
          <AutoTextarea
            value={jsonValue}
            onChange={(e) => { setJsonValue(e.target.value); setJsonStatus(null); }}
            spellCheck={false}
            rows={16}
            className="w-full bg-zinc-950 text-zinc-300 text-[10px] font-mono px-2 py-1.5 rounded border border-zinc-700 focus:outline-none focus:border-blue-500 resize-y"
          />
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={handleSaveJson}
              disabled={jsonSaving}
              className="text-[9px] px-2 py-1 rounded bg-blue-600/80 hover:bg-blue-500 text-white disabled:opacity-50"
            >
              {jsonSaving ? "Saving..." : "Save JSON"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

