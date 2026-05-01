import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';
import type { BrowserController, SessionState } from '../../apps/service/src/browser/browser-controller';

const idleSessionState: SessionState = {
  hasSession: false,
  savedAt: null,
  origin: null,
  cookieCount: 0,
  currentUrl: null,
  pageTitle: null,
  mode: null
};

const createBrowserController = (): BrowserController => ({
  getStatus: () => ({
    status: 'idle',
    engine: 'http',
    mode: null,
    startedAt: null,
    pageUrl: null,
    lastError: null
  }),
  start: async () => ({
    status: 'running',
    engine: 'http',
    mode: 'http',
    startedAt: '2026-04-16T00:00:00.000Z',
    pageUrl: 'about:blank',
    lastError: null
  }),
  startLogin: async () => ({
    status: 'running',
    engine: 'http',
    mode: 'http',
    startedAt: '2026-04-16T00:00:00.000Z',
    pageUrl: 'https://www.yuketang.cn/web',
    lastError: null
  }),
  stop: async () => ({
    status: 'idle',
    engine: 'http',
    mode: null,
    startedAt: null,
    pageUrl: null,
    lastError: null
  }),
  getSessionState: async () => idleSessionState,
  saveSession: async () => idleSessionState,
  navigateHome: async () => ({
    status: 'running',
    engine: 'http',
    mode: 'http',
    startedAt: '2026-04-16T00:00:00.000Z',
    pageUrl: 'https://www.yuketang.cn/v2/web/index',
    lastError: null
  }),
  navigate: async (url: string) => ({
    status: 'running',
    engine: 'http',
    mode: 'http',
    startedAt: '2026-04-16T00:00:00.000Z',
    pageUrl: url,
    lastError: null
  }),
  discoverLessons: async () => [],
  listExerciseEntries: async () => [],
  openCurrentExercise: async () => null,
  inspectPage: async () => ({
    currentUrl: 'about:blank',
    pageTitle: '',
    html: '<main></main>',
    text: ''
  }),
  getDebugState: async () => ({
    snapshot: {
      currentUrl: 'about:blank',
      pageTitle: '',
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
  captureScreenshot: async () => null,
  ensureExercisePageReady: async () => ({
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
  startQuestionDetection: async () => undefined,
  stopQuestionDetection: async () => undefined,
  submitLessonProblem: async () => ({
    ok: true,
    code: 0,
    message: 'OK',
    responseJson: { code: 0, msg: 'OK' }
  })
});

describe('autoplay debug trace routes', () => {
  it('returns trace events after the requested cursor', async () => {
    const traceStore = new AutoplayDebugTraceStore();
    traceStore.record('ai_prompt', 'Prepared AI prompt', { prompt: 'hello' });
    traceStore.record('submit_result', 'Submit succeeded', { ok: true });

    const app = buildServiceApp({
      browserController: createBrowserController(),
      debugTraceStore: traceStore
    });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/debug/autoplay-trace?afterId=1&limit=10'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        events: [
          expect.objectContaining({
            id: 2,
            type: 'submit_result',
            message: 'Submit succeeded',
            data: {
              ok: true
            }
          })
        ]
      });
    } finally {
      await app.close();
    }
  });
});
