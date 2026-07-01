/**
 * Build a fake `streamChat` for agent-loop tests. Each "turn" describes one LLM
 * response; successive loop iterations consume successive turns. Responses are
 * real SSE ReadableStreams shaped like OpenAI chat.completions chunks.
 */
export interface FakeTurn {
  content?: string;
  thinking?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> | string }>;
  finishReason?: "stop" | "tool_calls";
}

function sse(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

function turnToStream(turn: FakeTurn): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const chunks: string[] = [];
  if (turn.thinking) chunks.push(sse({ choices: [{ delta: { reasoning_content: turn.thinking } }] }));
  if (turn.content) chunks.push(sse({ choices: [{ delta: { content: turn.content } }] }));
  if (turn.toolCalls) {
    turn.toolCalls.forEach((tc, index) => {
      chunks.push(sse({ choices: [{ delta: { tool_calls: [{
        index, id: tc.id, type: "function",
        function: { name: tc.name, arguments: typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments) },
      }] } }] }));
    });
  }
  const finish = turn.finishReason ?? (turn.toolCalls ? "tool_calls" : "stop");
  chunks.push(sse({ choices: [{ delta: {}, finish_reason: finish }] }));
  chunks.push("data: [DONE]\n\n");

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
}

export function fakeLLM(turns: FakeTurn[]) {
  let i = 0;
  const calls: unknown[][] = [];
  const fn = async (conversation: unknown[]): Promise<Response> => {
    calls.push(conversation);
    const turn = turns[Math.min(i, turns.length - 1)];
    i++;
    return new Response(turnToStream(turn), { status: 200 });
  };
  // `calls` grows by one per invocation; read calls.length for the count.
  return Object.assign(fn, { calls });
}
