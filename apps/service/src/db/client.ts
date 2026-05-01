import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

type DatabaseClientOptions = {
  databasePath?: string;
};

export type DatabaseClient = ReturnType<typeof createDatabaseClient>;

const defaultDatabasePath = () =>
  process.env.VITEST ? ':memory:' : path.resolve(process.cwd(), 'data', 'yksprite.db');

const normalizePath = (databasePath: string) => {
  if (databasePath === ':memory:') {
    return databasePath;
  }

  mkdirSync(path.dirname(databasePath), { recursive: true });
  return databasePath;
};

const applyMigrations = (sqlite: Database.Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS qwen_api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      api_key TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 0,
      last_check_status TEXT NOT NULL DEFAULT 'unchecked',
      last_check_reason TEXT,
      last_checked_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      account_id INTEGER,
      account_user_id TEXT,
      lesson_id TEXT,
      course_title TEXT,
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

    CREATE TABLE IF NOT EXISTS accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      name TEXT,
      monitoring_enabled INTEGER NOT NULL DEFAULT 1,
      active_lesson_enter_delay_ms INTEGER NOT NULL DEFAULT 0,
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

  const ensureColumn = (table: string, name: string, definition: string) => {
    try {
      sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition};`);
    } catch {
      // Column already exists in upgraded databases.
    }
  };

  ensureColumn('qwen_api_keys', 'last_check_status', "TEXT NOT NULL DEFAULT 'unchecked'");
  ensureColumn('qwen_api_keys', 'last_check_reason', 'TEXT');
  ensureColumn('qwen_api_keys', 'last_checked_at', 'TEXT');

  ensureColumn('auto_answer_runs', 'account_id', 'INTEGER');
  ensureColumn('auto_answer_runs', 'account_user_id', 'TEXT');
  ensureColumn('auto_answer_runs', 'course_title', 'TEXT');

  ensureColumn('accounts', 'user_id', 'TEXT');
  ensureColumn('accounts', 'name', 'TEXT');
  ensureColumn('accounts', 'monitoring_enabled', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn('accounts', 'active_lesson_enter_delay_ms', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('accounts', 'cookies_json', 'TEXT');
  ensureColumn('accounts', 'cookie_count', 'INTEGER');
  ensureColumn('accounts', 'session_saved_at', 'TEXT');
  ensureColumn('accounts', 'origin', 'TEXT');
  ensureColumn('accounts', 'current_url', 'TEXT');
  ensureColumn('accounts', 'page_title', 'TEXT');
  ensureColumn('accounts', 'mode', 'TEXT');
};

export const createDatabaseClient = (options: DatabaseClientOptions = {}) => {
  const sqlitePath = normalizePath(options.databasePath ?? defaultDatabasePath());
  const sqlite = new Database(sqlitePath);
  const db = drizzle(sqlite);

  applyMigrations(sqlite);

  return {
    sqlite,
    db,
    path: sqlitePath,
    close: () => sqlite.close()
  };
};
