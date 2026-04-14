import type { FastifyInstance } from 'fastify';
import type { BrowserController } from '../browser/browser-controller.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import { extractQuestionsFromHtml } from '../runtime/question-extractor.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';

export const registerRuntimeRoutes = (
  app: FastifyInstance,
  browserController: BrowserController,
  runtimeRepository: RuntimeRepository
) => {
  app.get('/runtime/status', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle);
    runtimeRepository.saveSnapshot(status, questions);
    return status;
  });

  app.get('/runtime/questions', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle);
    runtimeRepository.saveSnapshot(status, questions);
    return runtimeRepository.listQuestions();
  });

  app.get('/runtime/questions/current', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle);
    runtimeRepository.saveSnapshot(status, questions);
    return runtimeRepository.getCurrentQuestion();
  });

  app.post('/runtime/scan', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle);
    runtimeRepository.saveSnapshot(status, questions);
    return {
      status,
      questions: runtimeRepository.listQuestions(),
      currentQuestion: runtimeRepository.getCurrentQuestion()
    };
  });
};
