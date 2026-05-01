import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const schemaMetaTable = sqliteTable('schema_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
});

export const apiProviderConfigsTable = sqliteTable('api_provider_configs', {
  provider: text('provider').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  model: text('model'),
  updatedAt: text('updated_at').notNull()
});

export const qwenApiKeysTable = sqliteTable('qwen_api_keys', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  apiKey: text('api_key').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
});

export const sessionsTable = sqliteTable('sessions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  source: text('source').notNull(),
  origin: text('origin').notNull(),
  cookiesJson: text('cookies_json').notNull(),
  cookieCount: integer('cookie_count').notNull(),
  savedAt: text('saved_at').notNull(),
  currentUrl: text('current_url'),
  pageTitle: text('page_title'),
  mode: text('mode'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(false)
});

export const tasksTable = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  status: text('status').notNull(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  lastError: text('last_error'),
  attempt: integer('attempt').notNull(),
  payloadSummary: text('payload_summary').notNull(),
  sourceRef: text('source_ref')
});

export const autoAnswerRunsTable = sqliteTable('auto_answer_runs', {
  id: text('id').primaryKey(),
  status: text('status').notNull(),
  lessonId: text('lesson_id'),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  totalCount: integer('total_count').notNull(),
  collectedCount: integer('collected_count').notNull(),
  solvedCount: integer('solved_count').notNull(),
  successCount: integer('success_count').notNull(),
  failedCount: integer('failed_count').notNull(),
  lastError: text('last_error')
});

export const autoAnswerAttemptsTable = sqliteTable('auto_answer_attempts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  questionRowId: integer('question_row_id'),
  exerciseEntryId: text('exercise_entry_id').notNull(),
  problemId: text('problem_id').notNull(),
  problemType: integer('problem_type').notNull(),
  provider: text('provider'),
  model: text('model'),
  answerJson: text('answer_json'),
  confidence: text('confidence'),
  reasoningSummary: text('reasoning_summary'),
  collectStatus: text('collect_status').notNull(),
  solveStatus: text('solve_status').notNull(),
  submitStatus: text('submit_status').notNull(),
  submitAttempt: integer('submit_attempt').notNull(),
  submitResponseJson: text('submit_response_json'),
  submittedAt: text('submitted_at'),
  lastError: text('last_error')
});

export const eventsTable = sqliteTable('events', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  time: text('time').notNull(),
  taskId: text('task_id'),
  eventType: text('event_type')
});

export const runtimeSnapshotsTable = sqliteTable('runtime_snapshots', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  connected: integer('connected', { mode: 'boolean' }).notNull(),
  loggedIn: integer('logged_in', { mode: 'boolean' }).notNull(),
  courseTitle: text('course_title'),
  lessonState: text('lesson_state').notNull(),
  checkinAvailable: integer('checkin_available', { mode: 'boolean' }).notNull(),
  questionDetected: integer('question_detected', { mode: 'boolean' }).notNull(),
  currentUrl: text('current_url'),
  pageTitle: text('page_title'),
  scannedAt: text('scanned_at').notNull()
});

export const questionsTable = sqliteTable('questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionId: text('question_id').notNull(),
  courseTitle: text('course_title'),
  type: text('type').notNull(),
  body: text('body').notNull(),
  slideIndex: integer('slide_index'),
  source: text('source').notNull(),
  detectedAt: text('detected_at').notNull(),
  runtimeSnapshotId: integer('runtime_snapshot_id').notNull()
});

export const questionOptionsTable = sqliteTable('question_options', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  optionKey: text('option_key').notNull(),
  optionValue: text('option_value').notNull(),
  sortOrder: integer('sort_order').notNull()
});

export const runtimeExercisesTable = sqliteTable('runtime_exercises', {
  id: text('id').primaryKey(),
  lessonId: text('lesson_id'),
  entryId: text('entry_id').notNull(),
  status: text('status').notNull(),
  analysisStatus: text('analysis_status').notNull(),
  isActive: integer('is_active', { mode: 'boolean' }).notNull(),
  pageHint: text('page_hint'),
  remainingHint: text('remaining_hint'),
  thumbnailUrl: text('thumbnail_url'),
  exerciseUrl: text('exercise_url'),
  updatedAt: text('updated_at').notNull(),
  lastProcessedAt: text('last_processed_at'),
  lastError: text('last_error')
});

export const ocrResultsTable = sqliteTable('ocr_results', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  text: text('text').notNull(),
  sourceImage: text('source_image'),
  confidenceNote: text('confidence_note').notNull(),
  createdAt: text('created_at').notNull()
});

export const questionCapturesTable = sqliteTable('question_captures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  sourceType: text('source_type').notNull(),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type').notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256'),
  createdAt: text('created_at').notNull()
});

export const visionAnalysesTable = sqliteTable('vision_analyses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  captureId: integer('capture_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  questionType: text('question_type').notNull(),
  questionText: text('question_text').notNull(),
  optionsJson: text('options_json').notNull(),
  suggestedAnswerJson: text('suggested_answer_json'),
  confidence: text('confidence').notNull(),
  reasoningSummary: text('reasoning_summary').notNull(),
  rawResponseJson: text('raw_response_json').notNull(),
  createdAt: text('created_at').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true)
});

export const draftAnswersTable = sqliteTable('draft_answers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  ocrResultId: integer('ocr_result_id'),
  draft: text('draft').notNull(),
  reasoningSummary: text('reasoning_summary').notNull(),
  confidence: text('confidence').notNull(),
  generatedAt: text('generated_at').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true)
});

export const answerConfirmationsTable = sqliteTable('answer_confirmations', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  draftAnswerId: integer('draft_answer_id').notNull(),
  confirmedValue: text('confirmed_value').notNull(),
  confirmedAt: text('confirmed_at').notNull(),
  note: text('note')
});

export const accountsTable = sqliteTable('accounts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: text('user_id'),
  name: text('name'),
  monitoringEnabled: integer('monitoring_enabled', { mode: 'boolean' }).notNull().default(true),
  activeLessonEnterDelayMs: integer('active_lesson_enter_delay_ms').notNull().default(0),
  accountKey: text('account_key').notNull(),
  platform: text('platform').notNull(),
  status: text('status').notNull(),
  lastCheckedAt: text('last_checked_at'),
  lastErrorReason: text('last_error_reason'),
  note: text('note'),
  cookiesJson: text('cookies_json'),
  cookieCount: integer('cookie_count'),
  sessionSavedAt: text('session_saved_at'),
  origin: text('origin'),
  currentUrl: text('current_url'),
  pageTitle: text('page_title'),
  mode: text('mode'),
  createdAt: text('created_at').notNull()
});
