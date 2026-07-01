import { test, expect } from "bun:test";
import { db, schema } from "../db/client";

// Smoke test: importing the db client runs all migrations (incl. 0002) against
// the throwaway test db. If agent_runs or the new status columns are missing,
// these queries throw.
test("migrations apply: agent_runs table exists and is queryable", async () => {
  const rows = await db.select().from(schema.agentRuns);
  expect(Array.isArray(rows)).toBe(true);
});

test("migrations apply: chat_messages has a status column", async () => {
  const rows = await db.select().from(schema.chatMessages);
  expect(Array.isArray(rows)).toBe(true);
});
