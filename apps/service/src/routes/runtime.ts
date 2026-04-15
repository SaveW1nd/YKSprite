import type { FastifyInstance } from 'fastify';
import type { AutomationStore } from '../automation/automation-store.js';
import type { BrowserController } from '../browser/browser-controller.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import type { RuntimeMonitor } from '../runtime/runtime-monitor.js';
import { extractQuestionsFromHtml } from '../runtime/question-extractor.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';

export const registerRuntimeRoutes = (
  app: FastifyInstance,
  browserController: BrowserController,
  runtimeRepository: RuntimeRepository,
  automationStore: AutomationStore,
  runtimeMonitor: RuntimeMonitor
) => {
  app.get('/runtime/status', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle, snapshot.text ?? null);
    runtimeRepository.saveSnapshot(status, questions);
    return status;
  });

  app.get('/runtime/questions', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle, snapshot.text ?? null);
    runtimeRepository.saveSnapshot(status, questions);
    return runtimeRepository.listQuestions();
  });

  app.get('/runtime/questions/current', async () => {
    const snapshot = await browserController.inspectPage();
    const status = probeRuntimeStatus(snapshot);
    const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle, snapshot.text ?? null);
    runtimeRepository.saveSnapshot(status, questions);
    return runtimeRepository.getCurrentQuestion();
  });

  app.post('/runtime/scan', async () => {
    return automationStore.executeTask('runtime_scan', 'Scan current lesson page', async () => {
      const snapshot = await browserController.inspectPage();
      const status = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle, snapshot.text ?? null);
      runtimeRepository.saveSnapshot(status, questions);
      return {
        status,
        questions: runtimeRepository.listQuestions(),
        currentQuestion: runtimeRepository.getCurrentQuestion()
      };
    });
  });

  app.get('/runtime/monitor', async () => {
    return runtimeMonitor.getStatus();
  });

  app.post('/runtime/monitor/start', async () => {
    return runtimeMonitor.start();
  });

  app.post('/runtime/monitor/stop', async () => {
    return runtimeMonitor.stop();
  });
};
