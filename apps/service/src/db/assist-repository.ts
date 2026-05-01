import { desc, eq } from 'drizzle-orm';
import type { DatabaseClient } from './client.js';
import { questionCapturesTable, questionOptionsTable, questionsTable, visionAnalysesTable } from './schema.js';
import type { QuestionCapture, QuestionCaptureRecord, VisionAnalysis, VisionAnalysisRecord } from '../assist/assist-types.js';

export class AssistRepository {
  constructor(private readonly database: DatabaseClient) {}

  private listQuestionRowsByQuestionId(questionId: string) {
    return this.database.db
      .select()
      .from(questionsTable)
      .where(eq(questionsTable.questionId, questionId))
      .orderBy(desc(questionsTable.detectedAt))
      .all();
  }

  getQuestionByQuestionId(questionId: string) {
    const question = this.listQuestionRowsByQuestionId(questionId)[0];

    if (!question) {
      return null;
    }

    return {
      id: question.id,
      questionId: question.questionId,
      courseTitle: question.courseTitle,
      type: question.type,
      body: question.body,
      options: this.database.db
        .select()
        .from(questionOptionsTable)
        .where(eq(questionOptionsTable.questionRowId, question.id))
        .all()
        .map((option) => ({
          key: option.optionKey,
          value: option.optionValue
        }))
    };
  }

  saveQuestionCapture(input: QuestionCaptureRecord) {
    const insert = this.database.db.insert(questionCapturesTable).values({
      ...input,
      createdAt: new Date().toISOString()
    }).run();

    return Number(insert.lastInsertRowid);
  }

  saveVisionAnalysis(input: VisionAnalysisRecord) {
    this.database.db
      .update(visionAnalysesTable)
      .set({ isCurrent: false })
      .where(eq(visionAnalysesTable.questionRowId, input.questionRowId))
      .run();

    const insert = this.database.db.insert(visionAnalysesTable).values({
      questionRowId: input.questionRowId,
      captureId: input.captureId,
      provider: input.provider,
      model: input.model,
      promptVersion: input.promptVersion,
      questionType: input.questionType,
      questionText: input.questionText,
      optionsJson: JSON.stringify(input.options),
      suggestedAnswerJson: input.suggestedAnswer ? JSON.stringify(input.suggestedAnswer) : null,
      confidence: input.confidence,
      reasoningSummary: input.reasoningSummary,
      rawResponseJson: input.rawResponseJson,
      createdAt: new Date().toISOString(),
      isCurrent: true
    }).run();

    return Number(insert.lastInsertRowid);
  }

  getLatestCaptureByQuestionId(questionId: string): QuestionCapture | null {
    for (const question of this.listQuestionRowsByQuestionId(questionId)) {
      const capture = this.database.db
        .select()
        .from(questionCapturesTable)
        .where(eq(questionCapturesTable.questionRowId, question.id))
        .orderBy(desc(questionCapturesTable.createdAt))
        .get();

      if (!capture) {
        continue;
      }

      return {
        id: capture.id,
        questionId,
        filePath: capture.filePath,
        mimeType: capture.mimeType,
        width: capture.width,
        height: capture.height,
        sha256: capture.sha256,
        createdAt: capture.createdAt
      };
    }

    return null;
  }

  getCurrentAnalysisByQuestionId(questionId: string): VisionAnalysis | null {
    for (const question of this.listQuestionRowsByQuestionId(questionId)) {
      const analysis = this.database.db
        .select()
        .from(visionAnalysesTable)
        .where(eq(visionAnalysesTable.questionRowId, question.id))
        .orderBy(desc(visionAnalysesTable.createdAt))
        .get();

      if (!analysis) {
        continue;
      }

      return {
        id: analysis.id,
        questionId,
        captureId: analysis.captureId,
        provider: analysis.provider as VisionAnalysis['provider'],
        model: analysis.model,
        promptVersion: analysis.promptVersion,
        questionType: analysis.questionType as VisionAnalysis['questionType'],
        questionText: analysis.questionText,
        options: JSON.parse(analysis.optionsJson),
        suggestedAnswer: analysis.suggestedAnswerJson ? JSON.parse(analysis.suggestedAnswerJson) : null,
        confidence: analysis.confidence as VisionAnalysis['confidence'],
        reasoningSummary: analysis.reasoningSummary,
        rawResponseJson: analysis.rawResponseJson,
        createdAt: analysis.createdAt
      };
    }

    return null;
  }
}
