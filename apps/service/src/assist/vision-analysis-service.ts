import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatVisionPrompt, type Problem } from '@yksprite/core';
import type { AssistRepository } from '../db/assist-repository.js';
import type { VisionAnalysis } from './assist-types.js';
import { analyzeWithQwenVl } from './providers/qwen-vl-provider.js';
import { normalizeAiErrorMessage } from './ai-error-message.js';
import { resolveProjectPath } from '../project-paths.js';
import type { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';
import type { ApiConfigService } from '../api-config/api-config-service.js';

type AnalysisResultShape = {
  question_type: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  question_text: string;
  options: Array<{ key: string; value: string }> | string[];
  suggested_answer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoning_summary: string;
};

type RawVisionAnalysis =
  | AnalysisResultShape
  | {
      id?: number;
      questionId: string;
      captureId: number;
      provider: 'openai' | 'qwen_vl';
      model: string;
      promptVersion: string;
      question_type?: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
      questionType?: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
      question_text?: string;
      questionText?: string;
      options: Array<{ key: string; value: string }> | string[];
      suggested_answer?: string | string[] | null;
      suggestedAnswer?: string | string[] | null;
      confidence: 'low' | 'medium' | 'high' | string;
      reasoning_summary?: string;
      reasoningSummary?: string;
      rawResponseJson: string;
      createdAt?: string;
    };

export type VisionAnalysisServiceLike = {
  analyzeQuestionImage(input: {
    questionId: string;
    provider?: 'qwen_vl' | 'openai';
  }): Promise<VisionAnalysis>;
};

const promptTypeForQuestion = (type: string) => {
  if (type === 'multiple_choice') return 'multiple_choice';
  if (type === 'fill_in') return 'fill_in';
  if (type === 'subjective') return 'subjective';
  return 'single_choice';
};

const buildProblemHint = (analysisSource: {
  type: string;
  body: string;
  options: Array<{ key: string; value: string }>;
}): Problem => ({
  id: 'vision-current',
  type: (analysisSource.type === 'multiple_choice' ? 'multiple_choice' : 'single_choice') as Problem['type'],
  body: analysisSource.body,
  options: analysisSource.options
});

const normalizeOptions = (options: Array<{ key: string; value: string }> | string[]) =>
  options.map((option) => {
    if (typeof option !== 'string') {
      return option;
    }

    const match = option.match(/^([A-Z])[\.\s、:：-]*(.*)$/);
    if (!match) {
      return {
        key: option,
        value: option
      };
    }

    return {
      key: match[1],
      value: match[2] || match[1]
    };
  });

const normalizeConfidence = (confidence: string): 'low' | 'medium' | 'high' =>
  confidence === 'high' || confidence === 'medium' ? confidence : 'low';

export const normalizeVisionAnalysis = (
  raw: RawVisionAnalysis,
  context: {
    questionId: string;
    captureId: number;
    provider: 'openai' | 'qwen_vl';
    model: string;
    promptVersion: string;
  }
) => ({
  questionId: 'questionId' in raw && raw.questionId ? raw.questionId : context.questionId,
  captureId: 'captureId' in raw && raw.captureId ? raw.captureId : context.captureId,
  provider: 'provider' in raw && raw.provider ? raw.provider : context.provider,
  model: 'model' in raw && raw.model ? raw.model : context.model,
  promptVersion: 'promptVersion' in raw && raw.promptVersion ? raw.promptVersion : context.promptVersion,
  questionType: ('questionType' in raw && raw.questionType) || ('question_type' in raw && raw.question_type) || 'single_choice',
  questionText: ('questionText' in raw && raw.questionText) || ('question_text' in raw && raw.question_text) || '',
  options: normalizeOptions(raw.options),
  suggestedAnswer: ('suggestedAnswer' in raw && raw.suggestedAnswer !== undefined ? raw.suggestedAnswer : undefined) ?? ('suggested_answer' in raw ? raw.suggested_answer : null) ?? null,
  confidence: normalizeConfidence(raw.confidence),
  reasoningSummary: ('reasoningSummary' in raw && raw.reasoningSummary) || ('reasoning_summary' in raw && raw.reasoning_summary) || '',
  rawResponseJson: 'rawResponseJson' in raw ? raw.rawResponseJson : '{}',
  createdAt: 'createdAt' in raw && raw.createdAt ? raw.createdAt : new Date().toISOString()
});

export class VisionAnalysisService implements VisionAnalysisServiceLike {
  private static readonly defaultPromptDir = resolveProjectPath(import.meta.url, 'apps/service/prompts/vision');

  constructor(
    private readonly repository: AssistRepository,
    private readonly promptDir = VisionAnalysisService.defaultPromptDir,
    private readonly traceStore: AutoplayDebugTraceStore | null = null,
    private readonly apiConfigService: ApiConfigService | null = null
  ) {}

  async analyzeQuestionImage(input: {
    questionId: string;
    provider?: 'qwen_vl' | 'openai';
  }): Promise<VisionAnalysis> {
    const capture = this.repository.getLatestCaptureByQuestionId(input.questionId);
    if (!capture) {
      throw new Error('No saved capture for the requested question');
    }

    const question = this.repository.getQuestionByQuestionId(input.questionId);
    if (!question) {
      throw new Error('Question not found');
    }

    const provider = 'qwen_vl' as const;
    const providerConfig = this.apiConfigService?.getActiveQwenRuntimeConfig() ?? {
      apiKey: null,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen3-vl-flash-2026-01-22'
    };
    const promptType = promptTypeForQuestion(question.type);
    const template = await readFile(path.join(this.promptDir, `${promptType}.txt`), 'utf8');
    const prompt = formatVisionPrompt(template, buildProblemHint(question));
    this.traceStore?.record('ai_prompt', `Prepared AI prompt for ${input.questionId}`, {
      questionId: input.questionId,
      provider,
      promptType,
      prompt
    });
    this.traceStore?.record('ai_request_started', `Sent AI request for ${input.questionId}`, {
      questionId: input.questionId,
      provider,
      promptType
    });

    let response;
    try {
      response = await analyzeWithQwenVl({ imagePath: capture.filePath, prompt, config: providerConfig });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown AI request failure';
      const displayReason = normalizeAiErrorMessage(reason, provider);
      this.traceStore?.record('ai_request_failed', displayReason, {
        questionId: input.questionId,
        provider,
        promptType,
        reason
      });
      console.error('[vision-analysis] Qwen request failed', {
        questionId: input.questionId,
        provider,
        reason: displayReason
      });
      throw error;
    }
    this.traceStore?.record('ai_response', `Received AI response for ${input.questionId}`, {
      questionId: input.questionId,
      provider,
      promptType,
      rawResponseJson: response.rawResponseJson,
      content: response.content
    });

    const parsed = normalizeVisionAnalysis(JSON.parse(response.content) as AnalysisResultShape, {
      questionId: input.questionId,
      captureId: capture.id,
      provider,
      model: providerConfig.model,
      promptVersion: `${promptType}.v1`
    });

    const analysisId = this.repository.saveVisionAnalysis({
      questionRowId: question.id,
      captureId: capture.id,
      provider: parsed.provider,
      model: parsed.model,
      promptVersion: parsed.promptVersion,
      questionType: parsed.questionType,
      questionText: parsed.questionText,
      options: parsed.options,
      suggestedAnswer: parsed.suggestedAnswer,
      confidence: parsed.confidence,
      reasoningSummary: parsed.reasoningSummary,
      rawResponseJson: response.rawResponseJson
    });

    const saved = this.repository.getCurrentAnalysisByQuestionId(input.questionId);
    if (!saved) {
      throw new Error(`Analysis ${analysisId} was not persisted`);
    }

    return saved;
  }
}
