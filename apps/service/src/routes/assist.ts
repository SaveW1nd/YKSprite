import type { FastifyInstance } from 'fastify';
import type { BrowserController } from '../browser/browser-controller.js';
import type { AutomationStore } from '../automation/automation-store.js';
import type { AssistRepository } from '../db/assist-repository.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import type { VisionAnalysisServiceLike } from '../assist/vision-analysis-service.js';
import { extractQuestionsFromHtml } from '../runtime/question-extractor.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';
import { buildDraftAnswer } from '../assist/draft-answer-service.js';
import { extractOcrResult } from '../assist/ocr-service.js';

export const registerAssistRoutes = (
  app: FastifyInstance,
  browserController: BrowserController,
  automationStore: AutomationStore,
  runtimeRepository: RuntimeRepository,
  assistRepository: AssistRepository,
  visionAnalysisService: VisionAnalysisServiceLike
) => {
  const persistReturnedAnalysisIfNeeded = (
    analysis: Awaited<ReturnType<VisionAnalysisServiceLike['analyzeQuestionImage']>>,
    force = false
  ) => {
    const existing = assistRepository.getCurrentAnalysisByQuestionId(analysis.questionId);
    if (existing && !force) {
      return existing;
    }

    const question = assistRepository.getQuestionByQuestionId(analysis.questionId);
    const capture = assistRepository.getLatestCaptureByQuestionId(analysis.questionId);
    if (!question || !capture) {
      return analysis;
    }

    assistRepository.saveVisionAnalysis({
      questionRowId: question.id,
      captureId: capture.id,
      provider: analysis.provider,
      model: analysis.model,
      promptVersion: analysis.promptVersion,
      questionType: analysis.questionType,
      questionText: analysis.questionText,
      options: analysis.options,
      suggestedAnswer: analysis.suggestedAnswer,
      confidence: analysis.confidence,
      reasoningSummary: analysis.reasoningSummary,
      rawResponseJson: analysis.rawResponseJson
    });

    return assistRepository.getCurrentAnalysisByQuestionId(analysis.questionId) ?? analysis;
  };

  app.post('/assist/ocr', async () => {
    return automationStore.executeTask('ocr_extract', 'Extract OCR text from current page', async () => {
      const snapshot = await browserController.inspectPage();
      const runtimeStatus = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle, snapshot.text ?? null);
      runtimeRepository.saveSnapshot(runtimeStatus, questions);
      const currentQuestion = runtimeRepository.getCurrentQuestion();
      const screenshot = await browserController.captureScreenshot();
      const result = extractOcrResult(snapshot, screenshot);
      if (currentQuestion) {
        assistRepository.saveOcrResult(currentQuestion.id, result);
        if (result.savedImagePath) {
          assistRepository.saveQuestionCapture({
            questionRowId: currentQuestion.id,
            sourceType: 'runtime_question',
            filePath: result.savedImagePath,
            mimeType: screenshot?.mimeType ?? 'image/png',
            width: null,
            height: null,
            sha256: null
          });

          try {
            const analysis = await visionAnalysisService.analyzeQuestionImage({
              questionId: currentQuestion.questionId
            });
            persistReturnedAnalysisIfNeeded(analysis);
          } catch {
            // Best-effort auto analysis. Manual analyze endpoint can retry later.
          }
        }
      }
      return result;
    });
  });

  app.post('/assist/draft-answer', async () => {
    return automationStore.executeTask('draft_generate', 'Generate draft answer from current question', async () => {
      const snapshot = await browserController.inspectPage();
      const runtimeStatus = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle, snapshot.text ?? null);
      runtimeRepository.saveSnapshot(runtimeStatus, questions);
      const currentQuestion = runtimeRepository.getCurrentQuestion();
      if (!currentQuestion) {
        throw new Error('No question detected on the current page');
      }

      const screenshot = await browserController.captureScreenshot();
      const ocr = extractOcrResult(snapshot, screenshot);
      const ocrId = assistRepository.saveOcrResult(currentQuestion.id, ocr);
      const draft = buildDraftAnswer(currentQuestion, ocr.text);
      assistRepository.saveDraftAnswer(currentQuestion.id, ocrId, draft);
      return draft;
    });
  });

  app.get('/assist/draft/:questionId', async (request) => {
    const questionId = (request.params as { questionId: string }).questionId;
    return assistRepository.getCurrentDraftByQuestionId(questionId);
  });

  app.get('/assist/capture/:questionId', async (request) => {
    const questionId = (request.params as { questionId: string }).questionId;
    return assistRepository.getLatestCaptureByQuestionId(questionId);
  });

  app.get('/assist/analysis/:questionId', async (request) => {
    const questionId = (request.params as { questionId: string }).questionId;
    return assistRepository.getCurrentAnalysisByQuestionId(questionId);
  });

  app.post('/assist/analyze-image', async (request) => {
    const body = request.body as { questionId: string; provider?: 'openai' | 'qwen_vl' };
    const analysis = await visionAnalysisService.analyzeQuestionImage(body);
    return persistReturnedAnalysisIfNeeded(analysis, true);
  });
};
