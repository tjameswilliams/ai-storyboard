#!/usr/bin/env bun
/**
 * Copy a single project-independent table between two AI Video Editor data
 * directories. Pairs with the AVE_DATA_DIR override in electron/main.ts so
 * a second isolated instance can pick up the first instance's settings or
 * ComfyUI workflow definitions without re-importing each one by hand.
 *
 *   bun scripts/sync-table.ts --table workflows --from "$HOME/Library/Application Support/AI Video Editor" --to "$HOME/.ave-b"
 *   bun scripts/sync-table.ts --table settings  --from "$HOME/Library/Application Support/AI Video Editor" --to "$HOME/.ave-b"
 *
 * Pass either the data dir or the data.db path itself for --from / --to.
 * Existing rows in --to with the same primary key are overwritten (INSERT
 * OR REPLACE), so re-running the sync is safe and idempotent. Other tables
 * are untouched.
 *
 * Allowed tables are restricted to project-independent ones (no FK chains
 * that would dangle on a fresh DB). Adding more is intentional — bulk-
 * copying a table with FK refs (clips → tracks → projects) would orphan
 * rows on the destination unless the parent rows happen to exist.
 */
// Use bun:sqlite to match the project's runtime — better-sqlite3's native
// addon doesn't load under Bun (oven-sh/bun#4290), and the script is run via
// `bun scripts/...` per package.json shortcuts.
import { Database } from "bun:sqlite";
import { existsSync, statSync } from "fs";
import { resolve, join } from "path";

const ALLOWED_TABLES = ["workflows", "settings"] as const;
type AllowedTable = typeof ALLOWED_TABLES[number];

interface Args {
  from: string;
  to: string;
  table: AllowedTable;
  dryRun: boolean;
}

function parseArgs(argv: string[]): Args {
  let from = "";
  let to = "";
  let table: string = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") from = argv[++i] ?? "";
    else if (a === "--to") to = argv[++i] ?? "";
    else if (a === "--table") table = argv[++i] ?? "";
    else if (a === "--dry-run") dryRun = true;
    else if (a === "-h" || a === "--help") {
      printUsage();
      process.exit(0);
    }
  }
  if (!from || !to || !table) {
    printUsage();
    process.exit(1);
  }
  if (!ALLOWED_TABLES.includes(table as AllowedTable)) {
    console.error(`Unsupported --table "${table}". Allowed: ${ALLOWED_TABLES.join(", ")}.`);
    process.exit(1);
  }
  return { from, to, table: table as AllowedTable, dryRun };
}

function printUsage() {
  console.log(`Usage: bun scripts/sync-table.ts --table <name> --from <dir-or-db> --to <dir-or-db> [--dry-run]

Allowed tables: ${ALLOWED_TABLES.join(", ")}

Copies all rows from the source table into the destination, replacing rows
with the same primary key. Other tables are not touched.`);
}

function resolveDbPath(input: string): string {
  const abs = resolve(input);
  if (!existsSync(abs)) {
    throw new Error(`Path does not exist: ${abs}`);
  }
  // If they passed a directory, look for data.db inside it.
  if (statSync(abs).isDirectory()) {
    const candidate = join(abs, "data.db");
    if (!existsSync(candidate)) {
      throw new Error(`No data.db found inside ${abs} — pass the file directly or the dir that contains it.`);
    }
    return candidate;
  }
  return abs;
}

function main() {
  const { from, to, table, dryRun } = parseArgs(process.argv.slice(2));
  const srcPath = resolveDbPath(from);
  const dstPath = resolveDbPath(to);

  if (resolve(srcPath) === resolve(dstPath)) {
    console.error("Source and destination resolve to the same file — nothing to do.");
    process.exit(1);
  }

  const db = new Database(dstPath);
  try {
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");

    // Attach source first so prepared statements against src.<table> compile.
    // Single-quote the path to survive spaces (default macOS userData lives
    // under "Application Support").
    db.exec(`ATTACH DATABASE '${srcPath.replace(/'/g, "''")}' AS src`);

    // `table` is allowlisted above, so direct interpolation into SQL is safe.
    const srcCount = (db.prepare(`SELECT count(*) as n FROM src.${table}`).get() as { n: number }).n;
    const dstBefore = (db.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number }).n;

    console.log(`Table: ${table}`);
    console.log(`Source: ${srcPath} (${srcCount} row${srcCount === 1 ? "" : "s"})`);
    console.log(`Destination: ${dstPath} (${dstBefore} row${dstBefore === 1 ? "" : "s"} before sync)`);

    if (dryRun) {
      console.log("\n--dry-run: no changes written.");
      return;
    }

    // INSERT OR REPLACE matches on the table's primary key, so existing rows
    // with the same key are overwritten and unrelated destination rows are
    // preserved. Wrapped in a transaction so a failure mid-copy doesn't
    // leave the destination half-written.
    const tx = db.transaction(() => {
      db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM src.${table}`);
    });
    tx();

    const dstAfter = (db.prepare(`SELECT count(*) as n FROM ${table}`).get() as { n: number }).n;
    const added = dstAfter - dstBefore;
    const overwritten = srcCount - added;
    console.log(`\nSynced: ${added} new, ${overwritten} overwritten. Destination now has ${dstAfter}.`);
  } finally {
    try { db.exec("DETACH DATABASE src"); } catch { /* not attached */ }
    db.close();
  }
}

main();
