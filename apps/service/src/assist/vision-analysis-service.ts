import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { formatVisionPrompt, type Problem } from '@yksprite/core';
import type { AssistRepository } from '../db/assist-repository.js';
import type { VisionAnalysis } from './assist-types.js';
import { analyzeWithOpenAI } from './providers/openai-provider.js';
import { analyzeWithQwenVl } from './providers/qwen-vl-provider.js';

type AnalysisProvider = 'openai' | 'qwen_vl';

type AnalysisResultShape = {
  question_type: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  question_text: string;
  options: Array<{ key: string; value: string }>;
  suggested_answer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoning_summary: string;
};

export type VisionAnalysisServiceLike = {
  analyzeQuestionImage(input: {
    questionId: string;
    provider?: AnalysisProvider;
  }): Promise<VisionAnalysis>;
};

const promptTypeForQuestion = (type: string) => (type === 'multiple_choice' ? 'multiple_choice' : 'single_choice');

const defaultProvider = () => (process.env.VISION_DEFAULT_PROVIDER === 'openai' ? 'openai' : 'qwen_vl');

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

export class VisionAnalysisService implements VisionAnalysisServiceLike {
  constructor(
    private readonly repository: AssistRepository,
    private readonly promptDir = path.resolve(process.cwd(), 'apps/service/prompts/vision')
  ) {}

  async analyzeQuestionImage(input: {
    questionId: string;
    provider?: AnalysisProvider;
  }): Promise<VisionAnalysis> {
    const capture = this.repository.getLatestCaptureByQuestionId(input.questionId);
    if (!capture) {
      throw new Error('No saved capture for the requested question');
    }

    const question = this.repository.getQuestionByQuestionId(input.questionId);
    if (!question) {
      throw new Error('Question not found');
    }

    const provider = input.provider ?? defaultProvider();
    const promptType = promptTypeForQuestion(question.type);
    const template = await readFile(path.join(this.promptDir, `${promptType}.txt`), 'utf8');
    const prompt = formatVisionPrompt(template, buildProblemHint(question));

    const response =
      provider === 'openai'
        ? await analyzeWithOpenAI({ imagePath: capture.filePath, prompt })
        : await analyzeWithQwenVl({ imagePath: capture.filePath, prompt });

    const parsed = JSON.parse(response.content) as AnalysisResultShape;

    const analysisId = this.repository.saveVisionAnalysis({
      questionRowId: question.id,
      captureId: capture.id,
      provider,
      model: provider === 'openai' ? process.env.OPENAI_MODEL ?? 'gpt-4.1-mini' : process.env.QWEN_VL_MODEL ?? 'qwen-vl-max',
      promptVersion: `${promptType}.v1`,
      questionType: parsed.question_type,
      questionText: parsed.question_text,
      options: parsed.options,
      suggestedAnswer: parsed.suggested_answer,
      confidence: parsed.confidence,
      reasoningSummary: parsed.reasoning_summary,
      rawResponseJson: response.rawResponseJson
    });

    const saved = this.repository.getCurrentAnalysisByQuestionId(input.questionId);
    if (!saved) {
      throw new Error(`Analysis ${analysisId} was not persisted`);
    }

    return saved;
  }
}
