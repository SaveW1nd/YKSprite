import type { DatabaseClient } from './client.js';
import { questionOptionsTable, questionsTable, runtimeExercisesTable, runtimeSnapshotsTable } from './schema.js';
import type { ExerciseQueueEntry, QuestionRecord, RuntimeStatus } from '../runtime/runtime-types.js';
import { desc, eq, sql } from 'drizzle-orm';

export class RuntimeRepository {
  constructor(private readonly database: DatabaseClient) {}

  saveSnapshot(status: RuntimeStatus, questions: QuestionRecord[]) {
    const result = this.database.db.insert(runtimeSnapshotsTable).values({
      connected: status.connected,
      loggedIn: status.loggedIn,
      courseTitle: status.courseTitle,
      lessonState: status.lessonState,
      checkinAvailable: status.checkinAvailable,
      questionDetected: status.questionDetected,
      currentUrl: status.currentUrl,
      pageTitle: status.pageTitle,
      scannedAt: status.lastScannedAt ?? new Date().toISOString()
    }).run();

    const runtimeSnapshotId = Number(result.lastInsertRowid);

    for (const question of questions) {
      const questionResult = this.database.db.insert(questionsTable).values({
        questionId: question.questionId,
        courseTitle: question.courseTitle,
        type: question.type,
        body: question.body,
        slideIndex: question.slideIndex,
        source: question.source,
        detectedAt: question.detectedAt,
        runtimeSnapshotId
      }).run();

      const questionRowId = Number(questionResult.lastInsertRowid);

      if (question.options.length > 0) {
        this.database.db.insert(questionOptionsTable).values(
          question.options.map((option, index) => ({
            questionRowId,
            optionKey: option.key,
            optionValue: option.value,
            sortOrder: index
          }))
        ).run();
      }
    }

    return runtimeSnapshotId;
  }

  listQuestions() {
    const latestSnapshot = this.database.db
      .select()
      .from(runtimeSnapshotsTable)
      .orderBy(desc(runtimeSnapshotsTable.scannedAt))
      .all()[0];
    if (!latestSnapshot) {
      return [];
    }

    const rows = this.database.db
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.runtimeSnapshotId, latestSnapshot.id))
      .orderBy(desc(questionsTable.detectedAt))
      .all();
    return rows.map((row): QuestionRecord & { id: number; runtimeSnapshotId: number } => ({
      ...row,
      source: row.source as QuestionRecord['source'],
      options: this.database.db
        .select()
        .from(questionOptionsTable)
        .where(eq(questionOptionsTable.questionRowId, row.id))
        .all()
        .map((option) => ({ key: option.optionKey, value: option.optionValue }))
    }));
  }

  getCurrentQuestion() {
    const latestSnapshot = this.database.db
      .select()
      .from(runtimeSnapshotsTable)
      .orderBy(desc(runtimeSnapshotsTable.scannedAt))
      .all()[0];
    if (!latestSnapshot) {
      return null;
    }

    const row = this.database.db
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.runtimeSnapshotId, latestSnapshot.id))
      .orderBy(desc(questionsTable.detectedAt))
      .all()[0];
    if (!row) {
      return null;
    }

    return {
      ...row,
      source: row.source as QuestionRecord['source'],
      options: this.database.db
        .select()
        .from(questionOptionsTable)
        .where(eq(questionOptionsTable.questionRowId, row.id))
        .all()
        .map((option) => ({ key: option.optionKey, value: option.optionValue }))
    };
  }

  updateQuestionType(questionRowId: number, type: string) {
    this.database.db
      .update(questionsTable)
      .set({ type })
      .where(eq(questionsTable.id, questionRowId))
      .run();
  }

  replaceExerciseEntries(lessonId: string | null, entries: ExerciseQueueEntry[]) {
    const updatedAt = new Date().toISOString();
    const existing = this.listExerciseEntries().reduce<Record<string, ExerciseQueueEntry>>((acc, entry) => {
      acc[`${entry.lessonId ?? 'none'}:${entry.entryId}`] = entry;
      return acc;
    }, {});

    if (lessonId) {
      this.database.db.delete(runtimeExercisesTable).where(eq(runtimeExercisesTable.lessonId, lessonId)).run();
    } else {
      this.database.db.delete(runtimeExercisesTable).where(sql`${runtimeExercisesTable.lessonId} is null`).run();
    }

    if (entries.length === 0) {
      return;
    }

    this.database.db.insert(runtimeExercisesTable).values(
      entries.map((entry) => ({
        id: `${entry.lessonId ?? 'none'}:${entry.entryId}`,
        lessonId: entry.lessonId,
        entryId: entry.entryId,
        status: entry.status,
        analysisStatus:
          existing[`${entry.lessonId ?? 'none'}:${entry.entryId}`]?.analysisStatus ??
          entry.analysisStatus ??
          'pending',
        isActive: entry.isActive,
        pageHint: entry.pageHint,
        remainingHint: entry.remainingHint,
        thumbnailUrl: entry.thumbnailUrl,
        exerciseUrl: entry.exerciseUrl,
        updatedAt,
        lastProcessedAt: existing[`${entry.lessonId ?? 'none'}:${entry.entryId}`]?.lastProcessedAt ?? null,
        lastError: existing[`${entry.lessonId ?? 'none'}:${entry.entryId}`]?.lastError ?? null
      }))
    ).run();
  }

  updateExerciseProcessingState(
    lessonId: string | null,
    entryId: string,
    input: {
      analysisStatus: 'pending' | 'processing' | 'done' | 'failed';
      lastProcessedAt?: string | null;
      lastError?: string | null;
    }
  ) {
    this.database.db
      .update(runtimeExercisesTable)
      .set({
        analysisStatus: input.analysisStatus,
        lastProcessedAt: input.lastProcessedAt ?? null,
        lastError: input.lastError ?? null,
        updatedAt: new Date().toISOString()
      })
      .where(eq(runtimeExercisesTable.id, `${lessonId ?? 'none'}:${entryId}`))
      .run();
  }

  listExerciseEntries(): ExerciseQueueEntry[] {
    return this.database.db
      .select()
      .from(runtimeExercisesTable)
      .orderBy(desc(runtimeExercisesTable.updatedAt), runtimeExercisesTable.entryId)
      .all()
      .map((row) => ({
        entryId: row.entryId,
        lessonId: row.lessonId,
        status: row.status as ExerciseQueueEntry['status'],
        analysisStatus: row.analysisStatus as ExerciseQueueEntry['analysisStatus'],
        isActive: row.isActive,
        pageHint: row.pageHint,
        remainingHint: row.remainingHint,
        thumbnailUrl: row.thumbnailUrl,
        exerciseUrl: row.exerciseUrl,
        updatedAt: row.updatedAt,
        lastProcessedAt: row.lastProcessedAt,
        lastError: row.lastError
      }));
  }
}
