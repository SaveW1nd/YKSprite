import { describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { accountsTable } from '../../apps/service/src/db/schema';
import { buildServiceApp } from '../../apps/service/src/app';
import type {
  BrowserController,
  BrowserDebugState,
  BrowserStatus,
  DetectedQuestionEvent,
  ExerciseEntry,
  ExerciseRuntimeState,
  LessonCandidate,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult,
  PageSnapshot,
  ScreenshotPayload,
  SessionState
} from '../../apps/service/src/browser/browser-controller';

const runningStatus: BrowserStatus = {
  status: 'running',
  engine: 'chromium',
  headless: true,
  mode: 'headless',
  startedAt: '2026-04-16T00:00:00.000Z',
  pageUrl: 'https://www.yuketang.cn/v2/web/index',
  lastError: null
};

const idleStatus: BrowserStatus = {
  status: 'idle',
  engine: 'chromium',
  headless: true,
  mode: null,
  startedAt: null,
  pageUrl: null,
  lastError: null
};

const createController = (sessionState: SessionState) => {
  let status = idleStatus;
  let detectionEnabled = false;

  const controller: BrowserController & {
    startSpy: ReturnType<typeof vi.fn>;
  } = {
    startSpy: vi.fn(),
    getStatus: () => status,
    start: async () => {
      controller.startSpy();
      status = runningStatus;
      return status;
    },
    stop: async () => {
      status = idleStatus;
      return status;
    },
    getSessionState: async () => sessionState,
    saveSession: async () => sessionState,
    navigateHome: async () => runningStatus,
    navigate: async (url: string) => ({
      ...runningStatus,
      pageUrl: url
    }),
    discoverLessons: async (): Promise<LessonCandidate[]> => [],
    listExerciseEntries: async (): Promise<ExerciseEntry[]> => [],
    openCurrentExercise: async () => null,
    inspectPage: async (): Promise<PageSnapshot> => ({
      currentUrl: status.pageUrl,
      pageTitle: '雨课堂',
      html: '<main></main>',
      text: ''
    }),
    getDebugState: async (): Promise<BrowserDebugState> => ({
      snapshot: {
        currentUrl: status.pageUrl,
        pageTitle: '雨课堂',
        html: '<main></main>',
        text: ''
      },
      network: [],
      runtime: {
        hasVue: false,
        routeName: null,
        routePath: null,
        storeStateKeys: [],
        interestingState: {}
      }
    }),
    captureScreenshot: async (): Promise<ScreenshotPayload> => null,
    ensureExercisePageReady: async (): Promise<ExerciseRuntimeState> => ({
      lessonId: 'lesson-1',
      exerciseIndex: '1',
      problemId: 'problem-1',
      problemType: 1,
      pageIndex: 1,
      questionText: '示例题目',
      options: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/v3/lesson-1/exercise/1'
    }),
    readExerciseRuntimeState: async () => null,
    startQuestionDetection: async (_onEvent: (event: DetectedQuestionEvent) => void | Promise<void>) => {
      detectionEnabled = true;
    },
    stopQuestionDetection: async () => {
      detectionEnabled = false;
    },
    submitLessonProblem: async (_payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult> => ({
      ok: true,
      code: 0,
      message: 'OK',
      responseJson: { code: 0, msg: 'OK' }
    })
  };

  return {
    controller,
    isQuestionDetectionEnabled: () => detectionEnabled
  };
};

describe('service bootstrap', () => {
  it('starts account monitor workers without starting the app-level controller and removes /browser routes', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    databaseClient.db.insert(accountsTable).values({
      userId: 'user-1',
      name: 'test',
      monitoringEnabled: true,
      accountKey: 'user-1',
      platform: 'Yuketang',
      status: 'healthy',
      lastCheckedAt: null,
      lastErrorReason: null,
      note: null,
      cookiesJson: JSON.stringify([
        {
          name: 'sessionid',
          value: 'cookie',
          domain: '.yuketang.cn',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        }
      ]),
      cookieCount: 1,
      sessionSavedAt: '2026-04-16T00:00:00.000Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'headless',
      createdAt: '2026-04-16T00:00:00.000Z'
    }).run();

    const { controller, isQuestionDetectionEnabled } = createController({
      hasSession: true,
      savedAt: '2026-04-16T00:00:00.000Z',
      origin: 'www.yuketang.cn',
      cookieCount: 3,
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'headless'
    });
    const accountWorkerController = createController({
      hasSession: true,
      savedAt: '2026-04-16T00:00:00.000Z',
      origin: 'www.yuketang.cn',
      cookieCount: 1,
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'headless'
    });

    const app = buildServiceApp({
      databaseClient,
      browserController: controller,
      accountMonitorControllerFactory: () => accountWorkerController.controller
    });

    try {
      await app.bootstrapSavedSessionAutomation();

      const browserResponse = await app.inject({ method: 'GET', url: '/browser' });
      const autoplayStatusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
      const autoplayStartResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      const autoplayMonitorStatusResponse = await app.inject({ method: 'GET', url: '/autoplay/monitor/status' });
      const autoplayMonitorStartResponse = await app.inject({ method: 'POST', url: '/autoplay/monitor/start' });

      expect(controller.startSpy).not.toHaveBeenCalled();
      expect(accountWorkerController.controller.startSpy).toHaveBeenCalledTimes(1);
      expect(isQuestionDetectionEnabled()).toBe(false);
      expect(accountWorkerController.isQuestionDetectionEnabled()).toBe(true);
      expect(browserResponse.statusCode).toBe(404);
      expect(autoplayStatusResponse.statusCode).toBe(404);
      expect(autoplayStartResponse.statusCode).toBe(404);
      expect(autoplayMonitorStatusResponse.statusCode).toBe(404);
      expect(autoplayMonitorStartResponse.statusCode).toBe(404);
    } finally {
      await app.close();
      databaseClient.close();
    }
  });

  it('does nothing when there is no saved session', async () => {
    const { controller, isQuestionDetectionEnabled } = createController({
      hasSession: false,
      savedAt: null,
      origin: null,
      cookieCount: 0,
      currentUrl: null,
      pageTitle: null,
      mode: null
    });
    const app = buildServiceApp({
      browserController: controller
    });

    try {
      await app.bootstrapSavedSessionAutomation();

      const browserResponse = await app.inject({ method: 'GET', url: '/browser' });
      const autoplayStatusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
      const autoplayMonitorStatusResponse = await app.inject({ method: 'GET', url: '/autoplay/monitor/status' });

      expect(controller.startSpy).not.toHaveBeenCalled();
      expect(isQuestionDetectionEnabled()).toBe(false);
      expect(browserResponse.statusCode).toBe(404);
      expect(autoplayStatusResponse.statusCode).toBe(404);
      expect(autoplayMonitorStatusResponse.statusCode).toBe(404);
    } finally {
      await app.close();
    }
  });
});
