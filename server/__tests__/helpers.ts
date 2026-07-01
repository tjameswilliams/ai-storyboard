import { db, schema } from "../db/client";
import { newId } from "../lib/nanoid";

/** Insert a minimal project row and return its id. */
export async function seedProject(name = "Test Project"): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.projects).values({
    id, name, createdAt: now, updatedAt: now,
  });
  return id;
}

/** Insert a minimal image (storyboard frame) row under a project, return its id. */
export async function seedImage(projectId: string, order = 0): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.images).values({
    id, projectId, order, createdAt: now, updatedAt: now,
  });
  return id;
}

/** Insert a minimal styleguide row, return its id. */
export async function seedStyleguide(name = "Test Styleguide"): Promise<string> {
  const id = newId();
  const now = new Date().toISOString();
  await db.insert(schema.styleguides).values({
    id, name, createdAt: now, updatedAt: now,
  });
  return id;
}
