import { test, expect } from "bun:test";
import { db, schema } from "../db/client";
import { eq } from "drizzle-orm";
import {
  persistUserMessage,
  beginAssistantMessage,
  finalizeAssistantMessage,
  upsertMessage,
  clearConversation,
  reconcileStreamingMessages,
} from "../lib/chatPersistence";
import { seedProject, seedImage } from "./helpers";
import { newId } from "../lib/nanoid";

test("user + assistant messages persist to the project table", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const uid = newId();
  await persistUserMessage(ref, { id: uid, role: "user", content: "hello" });

  const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  expect(rows).toHaveLength(1);
  expect(rows[0].content).toBe("hello");
  expect(rows[0].status).toBe("complete");
});

test("image-scoped messages land in image_chat_messages, not chat_messages", async () => {
  const projectId = await seedProject();
  const imageId = await seedImage(projectId);
  const ref = { scope: "image" as const, id: imageId };
  await persistUserMessage(ref, { id: newId(), role: "user", content: "frame chat" });

  const imgRows = await db.select().from(schema.imageChatMessages).where(eq(schema.imageChatMessages.imageId, imageId));
  expect(imgRows).toHaveLength(1);
  expect(imgRows[0].content).toBe("frame chat");
});

test("streaming placeholder is upserted then finalized under the same id", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const aid = newId();

  await beginAssistantMessage(ref, aid);
  let [row] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, aid));
  expect(row.status).toBe("streaming");
  expect(row.content).toBe("");

  await finalizeAssistantMessage(ref, {
    id: aid,
    content: "final answer",
    thinking: "hmm",
    toolCalls: [{ id: "t1", name: "x", arguments: {}, result: {}, status: "executed" }],
    segments: [{ type: "text", content: "final answer" }],
  });

  const rows = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, projectId));
  expect(rows).toHaveLength(1); // upsert, not a second insert
  [row] = rows;
  expect(row.status).toBe("complete");
  expect(row.content).toBe("final answer");
  expect(row.thinking).toBe("hmm");
  expect(JSON.parse(row.toolCalls!)).toHaveLength(1);
  expect(JSON.parse(row.segments!)[0].content).toBe("final answer");
});

test("clearConversation removes only that conversation's rows", async () => {
  const p1 = await seedProject();
  const p2 = await seedProject();
  await persistUserMessage({ scope: "project", id: p1 }, { id: newId(), role: "user", content: "a" });
  await persistUserMessage({ scope: "project", id: p2 }, { id: newId(), role: "user", content: "b" });

  await clearConversation({ scope: "project", id: p1 });

  expect(await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, p1))).toHaveLength(0);
  expect(await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.projectId, p2))).toHaveLength(1);
});

test("reconcileStreamingMessages flips orphaned streaming rows to complete", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const aid = newId();
  await beginAssistantMessage(ref, aid); // leaves a 'streaming' row

  const touched = await reconcileStreamingMessages();
  expect(touched).toBeGreaterThanOrEqual(1);

  const [row] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, aid));
  expect(row.status).toBe("complete");
});

test("upsertMessage serializes non-string toolCalls/segments and passes strings through", async () => {
  const projectId = await seedProject();
  const ref = { scope: "project" as const, id: projectId };
  const aid = newId();
  await upsertMessage(ref, {
    id: aid, role: "assistant", content: "x",
    toolCalls: '[{"already":"json"}]', // string passes through untouched
    segments: [{ type: "text", content: "x" }], // object gets stringified
  });
  const [row] = await db.select().from(schema.chatMessages).where(eq(schema.chatMessages.id, aid));
  expect(row.toolCalls).toBe('[{"already":"json"}]');
  expect(JSON.parse(row.segments!)[0].type).toBe("text");
});
