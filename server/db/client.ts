import * as schema from "./schema";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { getDbPath, getMigrationsDir } from "../lib/config";

function resolveMigrationsFolder(): string {
  const configured = getMigrationsDir();
  if (configured) return configured;
  const thisDir = dirname(fileURLToPath(import.meta.url));
  return resolve(thisDir, "../..", "drizzle");
}

const migrationsFolder = resolveMigrationsFolder();
const isBun = typeof globalThis.Bun !== "undefined";

let sqlite: any;
let db: any;

if (isBun) {
  const { Database } = await import("bun:sqlite");
  const { drizzle } = await import("drizzle-orm/bun-sqlite");
  const { migrate } = await import("drizzle-orm/bun-sqlite/migrator");

  sqlite = new Database(getDbPath(), { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
} else {
  const BetterSqlite3 = (await import("better-sqlite3")).default;
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const { migrate } = await import("drizzle-orm/better-sqlite3/migrator");

  sqlite = new BetterSqlite3(getDbPath(), { fileMustExist: false });
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
}

export { sqlite, db, schema };
