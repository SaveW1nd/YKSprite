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

  upsertAttempt(attempt: AutoAnswerAttemptRecord) {
    this.database.db.insert(autoAnswerAttemptsTable).values(attempt).onConflictDoUpdate({
      target: autoAnswerAttemptsTable.id,
      set: attempt
    }).run();
  }
}
