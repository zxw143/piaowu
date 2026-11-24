import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function openDatabase(filename = process.env.APP_DB || 'data/tickets.sqlite') {
  if (filename !== ':memory:') {
    filename = resolve(filename);
    mkdirSync(dirname(filename), { recursive: true });
  }
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS staff (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tickets (
      id INTEGER PRIMARY KEY,
      guest TEXT NOT NULL,
      note TEXT NOT NULL,
      issue_key TEXT NOT NULL UNIQUE,
      link_token TEXT NOT NULL UNIQUE,
      code TEXT NOT NULL UNIQUE,
      issued_at TEXT NOT NULL,
      redeemed_at TEXT,
      redeemed_by INTEGER REFERENCES staff(id)
    );
  `);
  return db;
}
