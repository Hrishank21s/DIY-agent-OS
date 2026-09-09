import { DatabaseSync, type StatementSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface Db {
  db: DatabaseSync;
  close(): void;
}

let _instance: Db | null = null;

export function getDb(): Db {
  if (_instance) return _instance;
  const dataDir = config.dataDir;
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = config.dbPath;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec('PRAGMA synchronous = NORMAL');

  migrate(db);

  _instance = { db, close: () => { try { db.close(); } catch {} } };
  return _instance;
}

function migrate(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const migrationsDir = path.join(__dirname, '..', '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (db.prepare('SELECT name FROM _migrations').all() as { name: string }[]).map(r => r.name),
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    db.exec('BEGIN');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO _migrations (name) VALUES (?)').run(file);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      console.error(`Migration failed: ${file}`, err);
      throw err;
    }
  }
}

export function clearDbSingleton(): void {
  if (_instance) {
    try { _instance.close(); } catch {}
    _instance = null;
  }
}

/**
 * Cast a row returned by node:sqlite (Record<string, SQLOutputValue>)
 * into a strongly-typed row.
 */
export function asRow<T>(v: unknown): T {
  return v as T;
}

export type { StatementSync };
