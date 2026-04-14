import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import type { BrowserController, PageSnapshot, ScreenshotPayload, SessionState } from '../../apps/service/src/browser/browser-controller';

const snapshot: PageSnapshot = {
  currentUrl: 'https://www.yuketang.cn/lesson/123',
  pageTitle: '高等数学 - 雨课堂',
  html: `
    <main>
      <h1>高等数学</h1>
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

const screenshot: ScreenshotPayload = {
  mimeType: 'image/png',
  data: 'ZmFrZS1wbmc='
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

const createBrowserController = (): BrowserController => ({
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
  navigate: async (url: string) => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: url,
    lastError: null
  }),
  inspectPage: async () => snapshot,
  captureScreenshot: async () => screenshot
});

describe('assist and automation routes', () => {
  it('returns OCR, draft answer, tasks, and events', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController()
    });

    try {
      const ocrResponse = await app.inject({ method: 'POST', url: '/assist/ocr' });
      const draftResponse = await app.inject({ method: 'POST', url: '/assist/draft-answer' });
      const draftGetResponse = await app.inject({ method: 'GET', url: '/assist/draft/q-1' });
      const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });
      const eventsResponse = await app.inject({ method: 'GET', url: '/events' });

      expect(ocrResponse.statusCode).toBe(200);
      expect(ocrResponse.json()).toMatchObject({
        sourceImage: expect.stringContaining('data:image/png;base64,'),
        confidenceNote: 'screenshot-captured-html-fallback'
      });

      expect(draftResponse.statusCode).toBe(200);
      expect(draftResponse.json()).toMatchObject({
        questionId: 'q-1',
        confidence: 'medium'
      });

      expect(draftGetResponse.statusCode).toBe(200);
      expect(draftGetResponse.json()).toMatchObject({
        questionId: 'q-1'
      });

      expect(tasksResponse.statusCode).toBe(200);
      expect(tasksResponse.json()[0]).toMatchObject({
        type: 'draft_generate'
      });

      expect(eventsResponse.statusCode).toBe(200);
      expect(eventsResponse.json()[0]).toMatchObject({
        level: 'info'
      });
    } finally {
      await app.close();
    }
  });
});
