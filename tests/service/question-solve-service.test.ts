import { describe, expect, it } from 'vitest';
import { QuestionSolveService } from '../../apps/service/src/auto-answer/question-solve-service';

const createAssistRepository = (analysis: {
  questionType: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  suggestedAnswer: string | string[] | null;
  questionText?: string;
  options?: Array<{ key: string; value: string }>;
  confidence?: 'low' | 'medium' | 'high';
}) => ({
  getCurrentAnalysisByQuestionId: () => ({
    id: 1,
    questionId: 'q-1',
    captureId: 1,
    provider: 'openai' as const,
    model: 'gpt-4.1-mini',
    promptVersion: `${analysis.questionType}.v1`,
    questionType: analysis.questionType,
    questionText: analysis.questionText ?? '默认题干',
    options: analysis.options ?? [],
    suggestedAnswer: analysis.suggestedAnswer,
    confidence: analysis.confidence ?? 'medium',
    reasoningSummary: '测试推理',
    rawResponseJson: '{}',
    createdAt: '2026-04-15T00:00:00.000Z'
  })
});

const noopVisionService = {
  analyzeQuestionImage: async () => {
    throw new Error('should not be called');
  }
};

describe('QuestionSolveService', () => {
  it('normalizes single choice answers into one-letter arrays', async () => {
    const service = new QuestionSolveService(
      createAssistRepository({
        questionType: 'single_choice',
        suggestedAnswer: 'B',
        options: [
          { key: 'A', value: 'A' },
          { key: 'B', value: 'B' }
        ]
      }) as never,
      noopVisionService
    );

    await expect(service.solveQuestion('q-1')).resolves.toMatchObject({
      submitPayloadResult: ['B']
    });
  });

  it('sorts and deduplicates multiple choice answers', async () => {
    const service = new QuestionSolveService(
      createAssistRepository({
        questionType: 'multiple_choice',
        suggestedAnswer: ['C', 'A', 'A']
      }) as never,
      noopVisionService
    );

    await expect(service.solveQuestion('q-1')).resolves.toMatchObject({
      submitPayloadResult: ['A', 'C']
    });
  });

  it('converts fill-in suggestions to string arrays', async () => {
    const service = new QuestionSolveService(
      createAssistRepository({
        questionType: 'fill_in',
        suggestedAnswer: '第一空；第二空'
      }) as never,
      noopVisionService
    );

    await expect(service.solveQuestion('q-1')).resolves.toMatchObject({
      submitPayloadResult: ['第一空', '第二空']
    });
  });

  it('falls back to a subjective text answer when the model returns no explicit answer', async () => {
    const service = new QuestionSolveService(
      createAssistRepository({
        questionType: 'subjective',
        suggestedAnswer: null,
        questionText: '请简述你的看法'
      }) as never,
      noopVisionService
    );

    await expect(service.solveQuestion('q-1')).resolves.toMatchObject({
      submitPayloadResult: '请简述你的看法'
    });
  });
});
