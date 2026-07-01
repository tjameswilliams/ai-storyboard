/**
 * Reader for an OpenAI-compatible chat.completions SSE stream. Folds the `data:`
 * lines into one assistant turn: accumulated content, thinking, streamed tool
 * calls, and the finish reason.
 *
 * This was previously inlined (and duplicated) inside the project agent loop and
 * the styleguide chat loop. Both now share this one parser, which is pure over
 * its reader — no run, store, or network — so it can be unit-tested directly.
 */

export interface RawToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface StreamedAssistantTurn {
  content: string;
  thinking: string;
  toolCalls: RawToolCall[];
  finishReason: string;
}

export interface ReadStreamOptions {
  /** Stop reading early (cancel / conversation switch). Checked between chunks. */
  aborted?: () => boolean;
  /** Called with each content delta as it arrives (for live streaming). */
  onContent?: (text: string) => void;
  /** Called with each reasoning/thinking delta as it arrives. */
  onThinking?: (text: string) => void;
}

/**
 * Drive `reader` to completion (or abort), returning the assembled turn. Tool
 * calls are streamed by index and their name/arguments concatenated across
 * deltas, matching the OpenAI streaming shape.
 */
export async function readAssistantStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  opts: ReadStreamOptions = {},
): Promise<StreamedAssistantTurn> {
  const aborted = opts.aborted ?? (() => false);
  const decoder = new TextDecoder();
  let buffer = "";
  let content = "";
  let thinking = "";
  let finishReason = "";
  const toolCalls: RawToolCall[] = [];

  while (true) {
    if (aborted()) break;
    let done: boolean | undefined;
    let value: Uint8Array | undefined;
    try {
      ({ done, value } = await reader.read());
    } catch {
      break;
    }
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") continue;
      let parsed: any;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue; // partial/invalid chunk — skip
      }
      const delta = parsed.choices?.[0]?.delta;
      const reason = parsed.choices?.[0]?.finish_reason;
      if (reason) finishReason = reason;
      if (delta?.content) {
        content += delta.content;
        opts.onContent?.(delta.content);
      }
      if (delta?.reasoning_content || delta?.thinking) {
        const t = delta.reasoning_content || delta.thinking;
        thinking += t;
        opts.onThinking?.(t);
      }
      if (delta?.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          while (toolCalls.length <= idx) {
            toolCalls.push({ id: "", type: "function", function: { name: "", arguments: "" } });
          }
          if (tc.id) toolCalls[idx].id = tc.id;
          if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
          if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
        }
      }
    }
  }

  return { content, thinking, toolCalls, finishReason };
}
