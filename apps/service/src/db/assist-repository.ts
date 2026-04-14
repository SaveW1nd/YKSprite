import { desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from './client.js';
import { draftAnswersTable, ocrResultsTable, questionsTable } from './schema.js';
import type { DraftAnswer, OcrResult } from '../assist/assist-types.js';

export class AssistRepository {
  constructor(private readonly database: DatabaseClient) {}

  saveOcrResult(questionRowId: number, result: OcrResult) {
    const insert = this.database.db.insert(ocrResultsTable).values({
      questionRowId,
      text: result.text,
      sourceImage: result.sourceImage,
      confidenceNote: result.confidenceNote,
      createdAt: new Date().toISOString()
    }).run();
    return Number(insert.lastInsertRowid);
  }

  saveDraftAnswer(questionRowId: number, ocrResultId: number | null, draft: DraftAnswer) {
    this.database.db
      .update(draftAnswersTable)
      .set({ isCurrent: false })
      .where(eq(draftAnswersTable.questionRowId, questionRowId))
      .run();

    this.database.db.insert(draftAnswersTable).values({
      questionRowId,
      ocrResultId,
      draft: draft.draft,
      reasoningSummary: draft.reasoningSummary,
      confidence: draft.confidence,
      generatedAt: draft.generatedAt,
      isCurrent: true
    }).run();
  }

  getCurrentDraftByQuestionId(questionId: string) {
    const question = this.database.db.select().from(questionsTable).where(eq(questionsTable.questionId, questionId)).orderBy(desc(questionsTable.detectedAt)).get();
    if (!question) {
      return null;
    }

    const draft = this.database.db
      .select()
      .from(draftAnswersTable)
      .where(eq(draftAnswersTable.questionRowId, question.id))
      .orderBy(desc(draftAnswersTable.generatedAt))
      .get();
    if (!draft) {
      return null;
    }

    return {
      questionId,
      draft: draft.draft,
      reasoningSummary: draft.reasoningSummary,
      confidence: draft.confidence,
      generatedAt: draft.generatedAt
    };
  }
}
