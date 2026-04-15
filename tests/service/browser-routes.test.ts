import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
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
    engine: 'chromium',
    headless: true,
    mode: null,
    startedAt: null,
    pageUrl: null,
    lastError: null
  }),
  start: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: 'about:blank',
    lastError: null
  }),
  startLogin: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'visible-login',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: 'https://www.yuketang.cn/web',
    lastError: null
  }),
  stop: async () => ({
    status: 'idle',
    engine: 'chromium',
    headless: true,
    mode: null,
    startedAt: null,
    pageUrl: null,
    lastError: null
  }),
  getSessionState: async () => idleSessionState,
  saveSession: async () => ({
    ...idleSessionState,
    hasSession: true,
    savedAt: '2026-04-14T00:00:00.000Z',
    origin: 'yuketang.cn',
    cookieCount: 1,
    currentUrl: 'https://www.yuketang.cn',
    pageTitle: '雨课堂',
    mode: 'visible-login'
  }),
  navigate: async (url: string) => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: url,
    lastError: null
  }),
  navigateHome: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: 'https://www.yuketang.cn/v2/web/index',
    lastError: null
  }),
  discoverLessons: async () => [],
  listExerciseEntries: async () => [],
  inspectPage: async () => ({
    currentUrl: 'https://www.yuketang.cn',
    pageTitle: '雨课堂',
    html: '<main></main>'
  }),
  captureScreenshot: async () => null,
  ensureExercisePageReady: async () => ({
    lessonId: 'lesson-1',
    exerciseIndex: '1',
    problemId: 'problem-1',
    problemType: 1,
    pageIndex: 1,
    questionText: '示例题目',
    options: [
      { key: 'A', value: 'A' },
      { key: 'B', value: 'B' }
    ],
    isComplete: false,
    routePath: '/v3/lesson-1/exercise/1'
  }),
  readExerciseRuntimeState: async () => null,
  submitLessonProblem: async () => ({
    ok: true,
    code: 0,
    message: 'OK',
    responseJson: { code: 0, msg: 'OK' }
  })
});

describe('browser routes', () => {
  it('exposes browser status, session, and control endpoints', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController()
    });

    try {
      const statusResponse = await app.inject({ method: 'GET', url: '/browser' });
      const startResponse = await app.inject({ method: 'POST', url: '/browser/start' });
      const loginResponse = await app.inject({ method: 'POST', url: '/browser/login/start' });
      const stopResponse = await app.inject({ method: 'POST', url: '/browser/stop' });
      const sessionResponse = await app.inject({ method: 'GET', url: '/browser/session' });
      const saveResponse = await app.inject({ method: 'POST', url: '/browser/session/save' });
      const navigateResponse = await app.inject({
        method: 'POST',
        url: '/browser/navigate',
        payload: { url: 'https://www.yuketang.cn' }
      });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({ status: 'idle', engine: 'chromium' });

      expect(startResponse.statusCode).toBe(200);
      expect(startResponse.json()).toMatchObject({ status: 'running', pageUrl: 'about:blank' });

      expect(loginResponse.statusCode).toBe(200);
      expect(loginResponse.json()).toMatchObject({ status: 'running', mode: 'visible-login' });

      expect(stopResponse.statusCode).toBe(200);
      expect(stopResponse.json()).toMatchObject({ status: 'idle' });

      expect(sessionResponse.statusCode).toBe(200);
      expect(sessionResponse.json()).toMatchObject({ hasSession: false });

      expect(saveResponse.statusCode).toBe(200);
      expect(saveResponse.json()).toMatchObject({ hasSession: true, cookieCount: 1 });

      expect(navigateResponse.statusCode).toBe(200);
      expect(navigateResponse.json()).toMatchObject({ pageUrl: 'https://www.yuketang.cn' });
    } finally {
      await app.close();
    }
  });
});
