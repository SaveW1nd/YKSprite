import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sessionsTable } from './schema.js';
import { eq, sql } from 'drizzle-orm';
import type { Cookie } from 'playwright';

type DatabaseClientOptions = {
  databasePath?: string;
  legacySessionPath?: string;
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const defaultDatabasePath = () =>
  process.env.VITEST ? ':memory:' : path.resolve(process.cwd(), 'data', 'yksprite.db');

const defaultLegacySessionPath = () => path.join(homedir(), '.yksprite', 'session', 'cookies.json');

const normalizePath = (databasePath: string) => {
  if (databasePath === ':memory:') {
    return databasePath;
  }

  mkdirSync(path.dirname(databasePath), { recursive: true });
  return databasePath;
};

const applyMigrations = (sqlite: Database.Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      origin TEXT NOT NULL,
      cookies_json TEXT NOT NULL,
      cookie_count INTEGER NOT NULL,
      saved_at TEXT NOT NULL,
      current_url TEXT,
      page_title TEXT,
      mode TEXT,
      is_active INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      last_error TEXT,
      attempt INTEGER NOT NULL,
      payload_summary TEXT NOT NULL,
      source_ref TEXT
    );

    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY NOT NULL,
      level TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      time TEXT NOT NULL,
      task_id TEXT,
      event_type TEXT
    );

    CREATE TABLE IF NOT EXISTS runtime_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connected INTEGER NOT NULL,
      logged_in INTEGER NOT NULL,
      course_title TEXT,
      lesson_state TEXT NOT NULL,
      checkin_available INTEGER NOT NULL,
      question_detected INTEGER NOT NULL,
      current_url TEXT,
      page_title TEXT,
      scanned_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id TEXT NOT NULL,
      course_title TEXT,
      type TEXT NOT NULL,
      body TEXT NOT NULL,
      slide_index INTEGER,
      source TEXT NOT NULL,
      detected_at TEXT NOT NULL,
      runtime_snapshot_id INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_options (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      option_key TEXT NOT NULL,
      option_value TEXT NOT NULL,
      sort_order INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ocr_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_image TEXT,
      confidence_note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS draft_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      ocr_result_id INTEGER,
      draft TEXT NOT NULL,
      reasoning_summary TEXT NOT NULL,
      confidence TEXT NOT NULL,
      generated_at TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS answer_confirmations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      draft_answer_id INTEGER NOT NULL,
      confirmed_value TEXT NOT NULL,
      confirmed_at TEXT NOT NULL,
      note TEXT
    );
  `);
};

const importLegacySession = (
  db: ReturnType<typeof drizzle>,
  legacySessionPath: string,
  sqlitePath: string
) => {
  const existing = db.select().from(sessionsTable).limit(1).all();
  if (existing.length > 0 || !existsSync(legacySessionPath) || sqlitePath === ':memory:') {
    return;
  }

  const raw = readFileSync(legacySessionPath, 'utf8');
  const parsed = JSON.parse(raw) as { cookies: Cookie[]; savedAt?: string; origin?: string };
  if (!Array.isArray(parsed.cookies) || parsed.cookies.length === 0) {
    return;
  }

  db.update(sessionsTable).set({ isActive: false }).run();
  db.insert(sessionsTable).values({
    source: 'legacy-cookie-file',
    origin: parsed.origin ?? 'www.yuketang.cn',
    cookiesJson: JSON.stringify(parsed.cookies),
    cookieCount: parsed.cookies.length,
    savedAt: parsed.savedAt ?? new Date().toISOString(),
    currentUrl: null,
    pageTitle: null,
    mode: null,
    isActive: true
  }).run();
};

export const createDatabaseClient = (options: DatabaseClientOptions = {}) => {
  const sqlitePath = normalizePath(options.databasePath ?? defaultDatabasePath());
  const sqlite = new Database(sqlitePath);
  const db = drizzle(sqlite);

  applyMigrations(sqlite);
  importLegacySession(db, options.legacySessionPath ?? defaultLegacySessionPath(), sqlitePath);

  return {
    sqlite,
    db,
    path: sqlitePath,
    close: () => sqlite.close()
  };
};
