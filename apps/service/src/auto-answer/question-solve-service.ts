import type { AssistRepository } from '../db/assist-repository.js';
import type { VisionAnalysisServiceLike } from '../assist/vision-analysis-service.js';
import type { SolvedAnswer } from './auto-answer-types.js';

const stringifyAnswer = (value: string[] | string | Record<string, unknown>) => JSON.stringify(value);

const normalizeSingleChoice = (suggestedAnswer: string | string[] | null) => {
  if (Array.isArray(suggestedAnswer)) {
    return [String(suggestedAnswer[0] ?? '').trim()].filter(Boolean);
  }

  const value = String(suggestedAnswer ?? '').trim();
  return value ? [value] : [];
};

const normalizeMultipleChoice = (suggestedAnswer: string | string[] | null) => {
  const raw = Array.isArray(suggestedAnswer)
    ? suggestedAnswer
    : typeof suggestedAnswer === 'string'
      ? suggestedAnswer.split(/[\s,，、]+/)
      : [];

  return [...new Set(raw.map((value) => String(value).trim()).filter(Boolean))].sort();
};

const normalizeFillIn = (suggestedAnswer: string | string[] | null) => {
  if (Array.isArray(suggestedAnswer)) {
    return suggestedAnswer.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof suggestedAnswer === 'string' && suggestedAnswer.trim()) {
    return suggestedAnswer
      .split(/\r?\n|[;；]+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
};

const normalizeSubjective = (suggestedAnswer: string | string[] | null) => {
  if (Array.isArray(suggestedAnswer)) {
    const joined = suggestedAnswer.map((value) => String(value).trim()).filter(Boolean).join('\n');
    return joined;
  }

  if (typeof suggestedAnswer === 'string' && suggestedAnswer.trim()) {
    return suggestedAnswer.trim();
  }

  return '';
};

const buildSubjectivePayload = (content: string) => ({
  content,
  pics: [
    {
      pic: '',
      thumb: ''
    }
  ]
});

const isPayloadSubmittable = (payload: string[] | string | Record<string, unknown>) => {
  if (Array.isArray(payload)) {
    return payload.length > 0;
  }

  if (typeof payload === 'string') {
    return payload.trim().length > 0;
  }

  if (payload && typeof payload === 'object') {
    const content = 'content' in payload && typeof payload.content === 'string' ? payload.content.trim() : '';
    return content.length > 0;
  }

  return false;
};

export class QuestionSolveService {
  constructor(
    private readonly assistRepository: AssistRepository,
    private readonly visionAnalysisService: VisionAnalysisServiceLike
  ) {}

  async solveQuestion(questionId: string): Promise<SolvedAnswer> {
    const sourceQuestion = this.assistRepository.getQuestionByQuestionId(questionId);
    const analysis =
      this.assistRepository.getCurrentAnalysisByQuestionId(questionId) ??
      (await this.visionAnalysisService.analyzeQuestionImage({ questionId }));
    const questionType = sourceQuestion?.type ?? analysis.questionType;

    let submitPayloadResult: string[] | string | Record<string, unknown>;
    switch (questionType) {
      case 'multiple_choice':
        submitPayloadResult = normalizeMultipleChoice(analysis.suggestedAnswer);
        break;
      case 'fill_in':
        submitPayloadResult = normalizeFillIn(analysis.suggestedAnswer);
        break;
      case 'subjective':
        submitPayloadResult = buildSubjectivePayload(normalizeSubjective(analysis.suggestedAnswer));
        break;
      case 'single_choice':
      default:
        submitPayloadResult = normalizeSingleChoice(analysis.suggestedAnswer);
        break;
    }

    return {
      provider: analysis.provider,
      model: analysis.model,
      confidence: analysis.confidence,
      reasoningSummary: analysis.reasoningSummary,
      answerJson: stringifyAnswer(submitPayloadResult),
      submitPayloadResult,
      rawResponseJson: analysis.rawResponseJson,
      isSubmittable: isPayloadSubmittable(submitPayloadResult)
    };
  }
}
