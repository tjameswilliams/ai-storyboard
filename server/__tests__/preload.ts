// Test preload (referenced by bunfig.toml). Point the data dir at a fresh
// throwaway directory BEFORE anything imports the db client, so tests run
// against an isolated SQLite file and never touch the real app database.
import { configure } from "../lib/config";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const dataDir = mkdtempSync(join(tmpdir(), "asb-test-"));
const thisDir = dirname(fileURLToPath(import.meta.url));
const migrationsDir = resolve(thisDir, "../..", "drizzle");

configure({ dataDir, migrationsDir });
