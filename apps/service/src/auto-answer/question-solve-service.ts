import type { AssistRepository } from '../db/assist-repository.js';
import type { VisionAnalysisServiceLike } from '../assist/vision-analysis-service.js';
import type { SolvedAnswer } from './auto-answer-types.js';

const stringifyAnswer = (value: string[] | string | Record<string, unknown>) => JSON.stringify(value);

const normalizeSingleChoice = (suggestedAnswer: string | string[] | null, fallback: string | null) => {
  if (Array.isArray(suggestedAnswer)) {
    return [String(suggestedAnswer[0] ?? fallback ?? '').trim()].filter(Boolean);
  }

  const value = String(suggestedAnswer ?? fallback ?? '').trim();
  return value ? [value] : [];
};

const normalizeMultipleChoice = (suggestedAnswer: string | string[] | null, fallback: string | null) => {
  const raw = Array.isArray(suggestedAnswer)
    ? suggestedAnswer
    : typeof suggestedAnswer === 'string'
      ? suggestedAnswer.split(/[\s,，、]+/)
      : fallback
        ? [fallback]
        : [];

  return [...new Set(raw.map((value) => String(value).trim()).filter(Boolean))].sort();
};

const normalizeFillIn = (suggestedAnswer: string | string[] | null, fallbackText: string) => {
  if (Array.isArray(suggestedAnswer)) {
    return suggestedAnswer.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof suggestedAnswer === 'string' && suggestedAnswer.trim()) {
    return suggestedAnswer
      .split(/\r?\n|[;；]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return fallbackText ? [fallbackText] : ['待确认'];
};

const normalizeSubjective = (suggestedAnswer: string | string[] | null, fallbackText: string) => {
  if (Array.isArray(suggestedAnswer)) {
    const joined = suggestedAnswer.map((value) => String(value).trim()).filter(Boolean).join('\n');
    return joined || fallbackText || '待确认';
  }

  if (typeof suggestedAnswer === 'string' && suggestedAnswer.trim()) {
    return suggestedAnswer.trim();
  }

  return fallbackText || '待确认';
};

export class QuestionSolveService {
  constructor(
    private readonly assistRepository: AssistRepository,
    private readonly visionAnalysisService: VisionAnalysisServiceLike
  ) {}

  async solveQuestion(questionId: string): Promise<SolvedAnswer> {
    const analysis =
      this.assistRepository.getCurrentAnalysisByQuestionId(questionId) ??
      (await this.visionAnalysisService.analyzeQuestionImage({ questionId }));
    const fallbackOption = analysis.options[0]?.key ?? null;
    const fallbackText = analysis.questionText.trim() || analysis.reasoningSummary.trim();

    let submitPayloadResult: string[] | string | Record<string, unknown>;
    switch (analysis.questionType) {
      case 'multiple_choice':
        submitPayloadResult = normalizeMultipleChoice(analysis.suggestedAnswer, fallbackOption);
        break;
      case 'fill_in':
        submitPayloadResult = normalizeFillIn(analysis.suggestedAnswer, fallbackText);
        break;
      case 'subjective':
        submitPayloadResult = normalizeSubjective(analysis.suggestedAnswer, fallbackText);
        break;
      case 'single_choice':
      default:
        submitPayloadResult = normalizeSingleChoice(analysis.suggestedAnswer, fallbackOption);
        break;
    }

    return {
      provider: analysis.provider,
      model: analysis.model,
      confidence: analysis.confidence,
      reasoningSummary: analysis.reasoningSummary,
      answerJson: stringifyAnswer(submitPayloadResult),
      submitPayloadResult,
      rawResponseJson: analysis.rawResponseJson
    };
  }
}
