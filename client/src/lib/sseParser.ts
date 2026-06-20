export interface SSECallbacks {
  onEvent: (data: Record<string, unknown>) => void | Promise<void>;
  onError?: (error: Error) => void;
}

export async function parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  callbacks: SSECallbacks
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice(6).trim();
        if (!data) continue;

        try {
          const parsed = JSON.parse(data);
          await callbacks.onEvent(parsed);
        } catch {}
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // User stopped
    } else if (callbacks.onError) {
      callbacks.onError(e instanceof Error ? e : new Error(String(e)));
    }
  }
}
