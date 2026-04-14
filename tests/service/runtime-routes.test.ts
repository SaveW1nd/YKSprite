import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import type { BrowserController, LessonCandidate, PageSnapshot, SessionState } from '../../apps/service/src/browser/browser-controller';

const snapshot: PageSnapshot = {
  currentUrl: 'https://www.yuketang.cn/lesson/123',
  pageTitle: '高等数学 - 雨课堂',
  html: `
    <main>
      <h1>高等数学</h1>
      <div>课堂 · 上课中</div>
      <button>立即签到</button>
      <section data-question-id="q-1">
        <div class="question-body">函数 f(x) 的导数是？</div>
        <div>单选题</div>
        <ul>
          <li data-option-key="A">x</li>
          <li data-option-key="B">2x</li>
        </ul>
      </section>
    </main>
  `
};

const sessionState: SessionState = {
  hasSession: true,
  savedAt: '2026-04-14T00:00:00.000Z',
  origin: 'www.yuketang.cn',
  cookieCount: 1,
  currentUrl: snapshot.currentUrl,
  pageTitle: snapshot.pageTitle,
  mode: 'headless'
};

const homeSnapshot: PageSnapshot = {
  currentUrl: 'https://www.yuketang.cn/v2/web/index',
  pageTitle: '雨课堂',
  html: '<main><div>欢迎使用雨课堂</div></main>'
};

const activeLessons: LessonCandidate[] = [
  {
    id: 'lesson-1',
    courseTitle: '高等数学',
    lessonTitle: '第 12 讲',
    lessonState: 'in_class',
    href: snapshot.currentUrl
  }
];

const createBrowserController = (options: { discoveredLessons?: LessonCandidate[]; inspectSnapshot?: PageSnapshot } = {}): BrowserController => ({
  getStatus: () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: snapshot.currentUrl,
    lastError: null
  }),
  start: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: snapshot.currentUrl,
    lastError: null
  }),
  startLogin: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'visible-login',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: snapshot.currentUrl,
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
  getSessionState: async () => sessionState,
  saveSession: async () => sessionState,
  navigateHome: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: homeSnapshot.currentUrl,
    lastError: null
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
  discoverLessons: async () => options.discoveredLessons ?? activeLessons,
  inspectPage: async () => options.inspectSnapshot ?? snapshot
});

describe('runtime routes', () => {
  it('returns runtime status and structured questions', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController()
    });

    try {
      const statusResponse = await app.inject({ method: 'GET', url: '/runtime/status' });
      const questionsResponse = await app.inject({ method: 'GET', url: '/runtime/questions' });
      const currentResponse = await app.inject({ method: 'GET', url: '/runtime/questions/current' });
      const scanResponse = await app.inject({ method: 'POST', url: '/runtime/scan' });
      const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });
      const eventsResponse = await app.inject({ method: 'GET', url: '/events' });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        loggedIn: true,
        courseTitle: '高等数学',
        lessonState: 'in_class',
        checkinAvailable: true,
        questionDetected: true
      });

      expect(questionsResponse.statusCode).toBe(200);
      expect(questionsResponse.json()).toHaveLength(1);

      expect(currentResponse.statusCode).toBe(200);
      expect(currentResponse.json()).toMatchObject({
        questionId: 'q-1',
        body: '函数 f(x) 的导数是？'
      });

      expect(scanResponse.statusCode).toBe(200);
      expect(scanResponse.json()).toMatchObject({
        status: {
          lessonState: 'in_class'
        },
        currentQuestion: {
          questionId: 'q-1'
        }
      });

      expect(tasksResponse.statusCode).toBe(200);
      expect(tasksResponse.json()[0]).toMatchObject({
        type: 'runtime_scan',
        status: 'succeeded'
      });

      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json()[0]).toMatchObject({
        level: 'info',
        title: 'Task runtime_scan succeeded'
      });
    } finally {
      await app.close();
    }
  });

  it('starts the runtime monitor and reports home polling state before a class is found', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController({
        discoveredLessons: [],
        inspectSnapshot: homeSnapshot
      })
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      const statusResponse = await app.inject({ method: 'GET', url: '/runtime/monitor' });
      const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });

      expect(startResponse.statusCode).toBe(200);
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        enabled: true,
        phase: 'home_polling'
      });
      expect(tasksResponse.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('records runtime scan work when the monitor enters an in-progress lesson', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController()
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });
      const eventsResponse = await app.inject({ method: 'GET', url: '/events' });

      expect(startResponse.statusCode).toBe(200);
      expect(tasksResponse.statusCode).toBe(200);
      expect(tasksResponse.json()[0]).toMatchObject({
        type: 'runtime_scan',
        status: 'succeeded'
      });
      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json()[0]).toMatchObject({
        level: 'info',
        title: 'Task runtime_scan succeeded'
      });
    } finally {
      await app.close();
    }
  });
});
