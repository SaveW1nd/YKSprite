import { rmSync } from 'node:fs';
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
  openCurrentExercise: async () => null,
  inspectPage: async () => snapshot,
  captureScreenshot: async () => screenshot,
  ensureExercisePageReady: async (url: string) => ({
    lessonId: 'lesson-1',
    exerciseIndex: url.split('/').pop() ?? '1',
    problemId: 'problem-1',
    problemType: 1,
    pageIndex: 1,
    questionText: '函数 f(x) 的导数是？',
    options: [
      { key: 'A', value: 'x' },
      { key: 'B', value: '2x' }
    ],
    imageUrl: null,
    imageThumbnailUrl: null,
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

const createVisionAnalysisService = () => ({
  analyzeQuestionImage: async ({ questionId, provider }: { questionId: string; provider?: 'openai' | 'qwen_vl' }) => ({
    id: 1,
    questionId,
    captureId: 1,
    provider: provider ?? 'qwen_vl',
    model: provider === 'openai' ? 'gpt-4.1-mini' : 'qwen-vl-max',
    promptVersion: 'single_choice.v1',
    question_type: 'single_choice',
    question_text: '你确定来上课了吗',
    options: provider === 'openai'
      ? [
          { key: 'A', value: '确定来了' },
          { key: 'B', value: '不知道啊' }
        ]
      : ['A. 确定来了', 'B. 不知道啊'],
    suggested_answer: 'A',
    confidence: 'medium',
    reasoning_summary: '截图中能识别出题干与选项，A 更符合语义。',
    rawResponseJson: '{}',
    createdAt: '2026-04-14T00:00:00.000Z'
  })
});

describe('assist and automation routes', () => {
  it('returns OCR, draft answer, tasks, and events', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController(),
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      const ocrResponse = await app.inject({ method: 'POST', url: '/assist/ocr' });
      const ocrPayload = ocrResponse.json();
      const draftResponse = await app.inject({ method: 'POST', url: '/assist/draft-answer' });
      const draftGetResponse = await app.inject({ method: 'GET', url: '/assist/draft/q-1' });
      const captureResponse = await app.inject({ method: 'GET', url: '/assist/capture/q-1' });
      const analysisResponse = await app.inject({ method: 'GET', url: '/assist/analysis/q-1' });
      const reanalyzeResponse = await app.inject({
        method: 'POST',
        url: '/assist/analyze-image',
        payload: { questionId: 'q-1', provider: 'openai' }
      });
      const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });
      const eventsResponse = await app.inject({ method: 'GET', url: '/events' });

      expect(ocrResponse.statusCode).toBe(200);
      expect(ocrPayload).toMatchObject({
        sourceImage: expect.stringContaining('data:image/png;base64,'),
        savedImagePath: expect.stringContaining('/data/captures/'),
        confidenceNote: 'screenshot-captured-html-fallback'
      });

      expect(captureResponse.statusCode).toBe(200);
      expect(captureResponse.json()).toMatchObject({
        questionId: 'q-1',
        filePath: expect.stringContaining('/data/captures/')
      });
      expect(captureResponse.json().filePath).toBe(ocrPayload.savedImagePath);

      expect(analysisResponse.statusCode).toBe(200);
      expect(analysisResponse.json()).toMatchObject({
        provider: 'qwen_vl',
        questionType: 'single_choice',
        questionText: '你确定来上课了吗',
        suggestedAnswer: 'A',
        confidence: 'medium',
        reasoningSummary: expect.any(String),
        options: [
          { key: 'A', value: '确定来了' },
          { key: 'B', value: '不知道啊' }
        ]
      });

      expect(reanalyzeResponse.statusCode).toBe(200);
      expect(reanalyzeResponse.json()).toMatchObject({
        provider: 'openai',
        suggestedAnswer: 'A'
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
      rmSync('/Users/savewind/Documents/github/YKSprite/data/captures', { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
