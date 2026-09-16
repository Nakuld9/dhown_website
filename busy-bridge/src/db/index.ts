import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { SCHEMA_SQL } from './schema';

export type Db = Database.Database;

/**
 * Open (and migrate) the bridge database.
 *
 * The schema is idempotent — every statement is CREATE ... IF NOT EXISTS — so
 * opening an existing database is also the migration step.
 */
export function openDatabase(databasePath: string): Db {
  if (databasePath !== ':memory:') {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  }
  const db = new Database(databasePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // Wait rather than fail when the worker and an API request collide.
  db.pragma('busy_timeout = 5000');
  db.exec(SCHEMA_SQL);
  applyColumnMigrations(db);
  return db;
}

/**
 * Columns added after the first release.
 *
 * CREATE TABLE IF NOT EXISTS does nothing to a table that already exists, so
 * a database created by an earlier version would silently lack these. SQLite
 * has no ADD COLUMN IF NOT EXISTS, hence the table_info check.
 */
function applyColumnMigrations(db: Db): void {
  const additions: Array<{ table: string; column: string; definition: string }> = [
    { table: 'busy_sync_queue', column: 'error_details', definition: 'TEXT' },
  ];
  for (const { table, column, definition } of additions) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (columns.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

/**
 * Timestamp in SQLite's text format, to millisecond precision:
 * "YYYY-MM-DD HH:MM:SS.mmm".
 *
 * The milliseconds are load-bearing. Truncating to whole seconds makes any
 * backoff shorter than a second round down to "due now", so the retry engine
 * re-claims a job it was supposed to hold — the delay silently disappears.
 *
 * Mixing this with the schema's own datetime('now') defaults (which have no
 * fractional part) is safe: the format is fixed-width up to the seconds, so
 * lexicographic comparison still orders the two correctly.
 */
export function isoToSqlite(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 23);
}

export function now(): string {
  return isoToSqlite(new Date());
}
