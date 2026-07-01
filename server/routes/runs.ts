import { Hono } from "hono";
import { registry } from "../lib/agentRuns";

const app = new Hono();

/**
 * Active (still-running) runs, optionally scoped to one project. Drives the
 * client's status badges — including for projects/frames not currently in view.
 */
app.get("/runs/active", (c) => {
  const projectId = c.req.query("projectId") ?? undefined;
  return c.json({ runs: registry.listActive(projectId) });
});

/**
 * Subscribe (SSE) to a run's event stream. Replays buffered events past
 * `cursor`, then live-tails until the run finishes. Disconnecting here does NOT
 * cancel the run — that's the whole point; switching away leaves it running.
 */
app.get("/runs/:runId/stream", (c) => {
  const runId = c.req.param("runId");
  const run = registry.get(runId);
  if (!run) {
    // Disposed or never existed — the client should fall back to a DB reload.
    return c.json({ error: "run not found", disposed: true }, 404);
  }
  const cursor = parseInt(c.req.query("cursor") || "0", 10) || 0;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* already closed */ }
      };
      const send = (ev: { type: string; data: Record<string, unknown> }, seq: number) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ seq, type: ev.type, ...ev.data })}\n\n`));
        } catch {
          closed = true;
        }
        if (ev.type === "done" || ev.type === "error") close();
      };

      const unsub = run.subscribe(cursor, (ev) => send(ev, ev.seq));

      // If the run was already terminal, subscribe() replayed the terminal
      // event and send() closed the stream. Otherwise wait for live events.
      if (run.isTerminal() && !closed) close();

      // Client navigated away / closed the tab: stop forwarding, but leave the
      // run alive to keep working in the background.
      c.req.raw.signal.addEventListener("abort", () => { unsub(); close(); }, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
});

/** Cancel a run (the chat "Stop" button). */
app.post("/runs/:runId/cancel", (c) => {
  const runId = c.req.param("runId");
  const run = registry.get(runId);
  if (!run) return c.json({ error: "run not found" }, 404);
  run.cancel();
  return c.json({ ok: true });
});

export default app;
