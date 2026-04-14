import type { FastifyInstance } from 'fastify';
import type { BrowserController } from '../browser/browser-controller.js';
import type { AutomationStore } from '../automation/automation-store.js';
import type { AssistRepository } from '../db/assist-repository.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import { extractQuestionsFromHtml } from '../runtime/question-extractor.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';
import { buildDraftAnswer } from '../assist/draft-answer-service.js';
import { extractOcrResult } from '../assist/ocr-service.js';

export const registerAssistRoutes = (
  app: FastifyInstance,
  browserController: BrowserController,
  automationStore: AutomationStore,
  runtimeRepository: RuntimeRepository,
  assistRepository: AssistRepository
) => {
  app.post('/assist/ocr', async () => {
    return automationStore.executeTask('ocr_extract', 'Extract OCR text from current page', async () => {
      const snapshot = await browserController.inspectPage();
      const runtimeStatus = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle);
      runtimeRepository.saveSnapshot(runtimeStatus, questions);
      const currentQuestion = runtimeRepository.getCurrentQuestion();
      const screenshot = await browserController.captureScreenshot();
      const result = extractOcrResult(snapshot, screenshot);
      if (currentQuestion) {
        assistRepository.saveOcrResult(currentQuestion.id, result);
      }
      return result;
    });
  });

  app.post('/assist/draft-answer', async () => {
    return automationStore.executeTask('draft_generate', 'Generate draft answer from current question', async () => {
      const snapshot = await browserController.inspectPage();
      const runtimeStatus = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle);
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
};
