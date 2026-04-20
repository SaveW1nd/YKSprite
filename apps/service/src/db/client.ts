import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sessionsTable } from './schema.js';
import { eq, sql } from 'drizzle-orm';
import type { BrowserCookie } from '../browser/browser-controller.js';

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

    CREATE TABLE IF NOT EXISTS api_provider_configs (
      provider TEXT PRIMARY KEY NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      api_key TEXT,
      base_url TEXT,
      model TEXT,
      updated_at TEXT NOT NULL
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

    CREATE TABLE IF NOT EXISTS auto_answer_runs (
      id TEXT PRIMARY KEY NOT NULL,
      status TEXT NOT NULL,
      lesson_id TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_count INTEGER NOT NULL,
      collected_count INTEGER NOT NULL,
      solved_count INTEGER NOT NULL,
      success_count INTEGER NOT NULL,
      failed_count INTEGER NOT NULL,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS auto_answer_attempts (
      id TEXT PRIMARY KEY NOT NULL,
      run_id TEXT NOT NULL,
      question_row_id INTEGER,
      exercise_entry_id TEXT NOT NULL,
      problem_id TEXT NOT NULL,
      problem_type INTEGER NOT NULL,
      provider TEXT,
      model TEXT,
      answer_json TEXT,
      confidence TEXT,
      reasoning_summary TEXT,
      collect_status TEXT NOT NULL,
      solve_status TEXT NOT NULL,
      submit_status TEXT NOT NULL,
      submit_attempt INTEGER NOT NULL,
      submit_response_json TEXT,
      submitted_at TEXT,
      last_error TEXT
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

    CREATE TABLE IF NOT EXISTS runtime_exercises (
      id TEXT PRIMARY KEY NOT NULL,
      lesson_id TEXT,
      entry_id TEXT NOT NULL,
      status TEXT NOT NULL,
      analysis_status TEXT NOT NULL,
      is_active INTEGER NOT NULL,
      page_hint TEXT,
      remaining_hint TEXT,
      thumbnail_url TEXT,
      exercise_url TEXT,
      updated_at TEXT NOT NULL,
      last_processed_at TEXT,
      last_error TEXT
    );

    CREATE TABLE IF NOT EXISTS ocr_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      source_image TEXT,
      confidence_note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS question_captures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      source_type TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      sha256 TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vision_analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_row_id INTEGER NOT NULL,
      capture_id INTEGER NOT NULL,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_version TEXT NOT NULL,
      question_type TEXT NOT NULL,
      question_text TEXT NOT NULL,
      options_json TEXT NOT NULL,
      suggested_answer_json TEXT,
      confidence TEXT NOT NULL,
      reasoning_summary TEXT NOT NULL,
      raw_response_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 1
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

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT,
      monitoring_enabled INTEGER NOT NULL DEFAULT 1,
      account_key TEXT NOT NULL,
      platform TEXT NOT NULL,
      status TEXT NOT NULL,
      last_checked_at TEXT,
      last_error_reason TEXT,
      note TEXT,
      cookies_json TEXT,
      cookie_count INTEGER,
      session_saved_at TEXT,
      origin TEXT,
      current_url TEXT,
      page_title TEXT,
      mode TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const ensureColumn = (name: string, definition: string) => {
    try {
      sqlite.exec(`ALTER TABLE accounts ADD COLUMN ${name} ${definition};`);
    } catch {
      // Column already exists in upgraded databases.
    }
  };

  ensureColumn('user_id', 'TEXT');
  ensureColumn('name', 'TEXT');
  ensureColumn('monitoring_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('cookies_json', 'TEXT');
  ensureColumn('cookie_count', 'INTEGER');
  ensureColumn('session_saved_at', 'TEXT');
  ensureColumn('origin', 'TEXT');
  ensureColumn('current_url', 'TEXT');
  ensureColumn('page_title', 'TEXT');
  ensureColumn('mode', 'TEXT');
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
  const parsed = JSON.parse(raw) as { cookies: BrowserCookie[]; savedAt?: string; origin?: string };
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
