import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;
  const dbPath = process.env.MVP_SQLITE_PATH || './data/audiator.db';
  const resolvedPath = path.resolve(process.cwd(), dbPath);
  const dir = path.dirname(resolvedPath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function initTables(): void {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'active',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at TEXT
    );

    CREATE TABLE IF NOT EXISTS session_events (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sequence_index INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      actor TEXT NOT NULL,
      text TEXT,
      payload_json TEXT,
      started_at_ms INTEGER,
      ended_at_ms INTEGER,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );

    CREATE INDEX IF NOT EXISTS idx_session_events_session
    ON session_events(session_id, sequence_index);

    CREATE TABLE IF NOT EXISTS recordings (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      analysis_json TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
}
