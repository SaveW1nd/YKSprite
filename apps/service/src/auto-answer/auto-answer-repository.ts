import { desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db/client.js';
import {
  accountsTable,
  autoAnswerAttemptsTable,
  autoAnswerRunsTable,
  questionCapturesTable,
  questionsTable
} from '../db/schema.js';
import type { AutoAnswerAttemptRecord, AutoAnswerRunRecord } from './auto-answer-types.js';

export type AnswerHistoryItem = {
  id: string;
  runId: string;
  account: {
    id: number | null;
    name: string;
    userId: string | null;
    platform: string | null;
  };
  courseTitle: string | null;
  lessonId: string | null;
  problemId: string;
  problemType: number;
  questionText: string | null;
  answerJson: string | null;
  submitStatus: string;
  submittedAt: string | null;
  lastError: string | null;
  capture: {
    id: number;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: string;
  } | null;
};

export type AnswerCaptureFile = {
  id: number;
  filePath: string;
  mimeType: string;
};

export class AutoAnswerRepository {
  constructor(private readonly database: DatabaseClient) {}

  listRuns() {
    return this.database.db
      .select()
      .from(autoAnswerRunsTable)
      .orderBy(desc(autoAnswerRunsTable.startedAt))
      .all() as AutoAnswerRunRecord[];
  }

  listAnswerHistory(limit = 100): AnswerHistoryItem[] {
    const attempts = this.database.db
      .select()
      .from(autoAnswerAttemptsTable)
      .orderBy(desc(autoAnswerAttemptsTable.submittedAt), desc(autoAnswerAttemptsTable.id))
      .limit(limit)
      .all();
    const runs = new Map(this.database.db.select().from(autoAnswerRunsTable).all().map((run) => [run.id, run]));
    const accounts = this.database.db.select().from(accountsTable).all();
    const accountsById = new Map(accounts.map((account) => [account.id, account]));
    const questions = new Map(this.database.db.select().from(questionsTable).all().map((question) => [question.id, question]));
    const latestCapturesByQuestionRowId = new Map<number, typeof questionCapturesTable.$inferSelect>();

    for (const capture of this.database.db
      .select()
      .from(questionCapturesTable)
      .orderBy(desc(questionCapturesTable.createdAt), desc(questionCapturesTable.id))
      .all()) {
      if (!latestCapturesByQuestionRowId.has(capture.questionRowId)) {
        latestCapturesByQuestionRowId.set(capture.questionRowId, capture);
      }
    }

    return attempts.map((attempt): AnswerHistoryItem => {
      const run = runs.get(attempt.runId) ?? null;
      const inferredAccount = run?.accountId ? accountsById.get(run.accountId) ?? null : accounts.length === 1 ? accounts[0] : null;
      const question = attempt.questionRowId ? questions.get(attempt.questionRowId) ?? null : null;
      const capture = attempt.questionRowId ? latestCapturesByQuestionRowId.get(attempt.questionRowId) ?? null : null;

      return {
        id: attempt.id,
        runId: attempt.runId,
        account: {
          id: inferredAccount?.id ?? null,
          name: inferredAccount?.name || inferredAccount?.accountKey || run?.accountUserId || '未知账号',
          userId: inferredAccount?.userId ?? run?.accountUserId ?? null,
          platform: inferredAccount?.platform ?? null
        },
        courseTitle: question?.courseTitle ?? run?.courseTitle ?? null,
        lessonId: run?.lessonId ?? null,
        problemId: attempt.problemId,
        problemType: attempt.problemType,
        questionText: question?.body ?? null,
        answerJson: attempt.answerJson,
        submitStatus: attempt.submitStatus,
        submittedAt: attempt.submittedAt,
        lastError: attempt.lastError,
        capture: capture
          ? {
              id: capture.id,
              url: `/api/answers/captures/${capture.id}`,
              mimeType: capture.mimeType,
              width: capture.width,
              height: capture.height,
              createdAt: capture.createdAt
            }
          : null
      };
    });
  }

  getAnswerCaptureFile(captureId: number): AnswerCaptureFile | null {
    const capture = this.database.db
      .select()
      .from(questionCapturesTable)
      .where(eq(questionCapturesTable.id, captureId))
      .get();

    if (!capture) {
      return null;
    }

    return {
      id: capture.id,
      filePath: capture.filePath,
      mimeType: capture.mimeType
    };
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
