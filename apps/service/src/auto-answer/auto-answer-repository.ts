import { desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db/client.js';
import { autoAnswerAttemptsTable, autoAnswerRunsTable } from '../db/schema.js';
import type { AutoAnswerAttemptRecord, AutoAnswerRunRecord } from './auto-answer-types.js';

export class AutoAnswerRepository {
  constructor(private readonly database: DatabaseClient) {}

  listRuns() {
    return this.database.db
      .select()
      .from(autoAnswerRunsTable)
      .orderBy(desc(autoAnswerRunsTable.startedAt))
      .all() as AutoAnswerRunRecord[];
  }

  getRun(id: string) {
    return this.database.db
      .select()
      .from(autoAnswerRunsTable)
      .where(eq(autoAnswerRunsTable.id, id))
      .get() as AutoAnswerRunRecord | undefined;
  }

  upsertRun(run: AutoAnswerRunRecord) {
    this.database.db.insert(autoAnswerRunsTable).values(run).onConflictDoUpdate({
      target: autoAnswerRunsTable.id,
      set: run
    }).run();
  }

  listAttemptsByRunId(runId: string) {
    return this.database.db
      .select()
      .from(autoAnswerAttemptsTable)
      .where(eq(autoAnswerAttemptsTable.runId, runId))
      .orderBy(autoAnswerAttemptsTable.exerciseEntryId)
      .all() as AutoAnswerAttemptRecord[];
  }

  getAttempt(id: string) {
    return this.database.db
      .select()
      .from(autoAnswerAttemptsTable)
      .where(eq(autoAnswerAttemptsTable.id, id))
      .get() as AutoAnswerAttemptRecord | undefined;
  }

  findLatestSuccessfulAttemptForProblem(lessonId: string, problemId: string) {
    const attempts = this.database.db
      .select()
      .from(autoAnswerAttemptsTable)
      .orderBy(desc(autoAnswerAttemptsTable.submittedAt), desc(autoAnswerAttemptsTable.id))
      .all() as AutoAnswerAttemptRecord[];

    const runsById = new Map(
      this.database.db
        .select()
        .from(autoAnswerRunsTable)
        .all()
        .map((run) => [run.id, run])
    );

    return (
      attempts.find((attempt) => {
        if (attempt.problemId !== problemId) {
          return false;
        }
        if (!['submitted', 'already_completed'].includes(attempt.submitStatus)) {
          return false;
        }
        const run = runsById.get(attempt.runId);
        return run?.lessonId === lessonId;
      }) ?? null
    );
  }

  upsertAttempt(attempt: AutoAnswerAttemptRecord) {
    this.database.db.insert(autoAnswerAttemptsTable).values(attempt).onConflictDoUpdate({
      target: autoAnswerAttemptsTable.id,
      set: attempt
    }).run();
  }
}
