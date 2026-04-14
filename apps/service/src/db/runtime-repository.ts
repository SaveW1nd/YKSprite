import type { DatabaseClient } from './client.js';
import { questionOptionsTable, questionsTable, runtimeSnapshotsTable } from './schema.js';
import type { QuestionRecord, RuntimeStatus } from '../runtime/runtime-types.js';
import { desc, eq } from 'drizzle-orm';

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
}
