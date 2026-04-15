import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import type { BrowserController, ExerciseEntry, LessonCandidate, PageSnapshot, SessionState } from '../../apps/service/src/browser/browser-controller';

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

const lessonHomeSnapshot: PageSnapshot = {
  currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
  pageTitle: '高等数学',
  html: '<main><div>课堂 · 上课中</div><div>课堂主页</div></main>'
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

const exerciseEntries: ExerciseEntry[] = [
  {
    entryId: 'timeline-4',
    lessonId: 'lesson-1',
    status: 'unanswered',
    isActive: true,
    pageHint: '第1页',
    remainingHint: '10分钟前',
    thumbnailUrl: 'https://example.com/problem-4.png',
    exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4'
  }
];

const createBrowserController = (
  options: { discoveredLessons?: LessonCandidate[]; inspectSnapshot?: PageSnapshot; listedExercises?: ExerciseEntry[] } = {}
): BrowserController => {
  let currentSnapshot = options.inspectSnapshot ?? snapshot;

  return {
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
    navigate: async (url: string) => {
      currentSnapshot = {
        ...currentSnapshot,
        currentUrl: url
      };

      return {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-14T00:00:00.000Z',
        pageUrl: url,
        lastError: null
      };
    },
    discoverLessons: async () => options.discoveredLessons ?? activeLessons,
    listExerciseEntries: async () => options.listedExercises ?? exerciseEntries,
    inspectPage: async () => currentSnapshot,
    captureScreenshot: async () => ({
      mimeType: 'image/png',
      data: 'ZmFrZS1wbmc='
    }),
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
  };
};

const createVisionAnalysisService = () => ({
  analyzeQuestionImage: async ({ questionId, provider }: { questionId: string; provider?: 'openai' | 'qwen_vl' }) => ({
    id: 1,
    questionId,
    captureId: 1,
    provider: provider ?? 'qwen_vl',
    model: 'qwen-vl-max',
    promptVersion: 'single_choice.v1',
    questionType: 'single_choice',
    questionText: '函数 f(x) 的导数是？',
    options: [
      { key: 'A', value: 'x' },
      { key: 'B', value: '2x' }
    ],
    suggestedAnswer: 'B',
    confidence: 'medium',
    reasoningSummary: '题干与选项能对应到导数结果。',
    rawResponseJson: '{}',
    createdAt: '2026-04-14T00:00:00.000Z'
  })
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

  it('navigates into the unanswered exercise entry when already inside a lesson', async () => {
    const navigatedUrls: string[] = [];
    const browserController = createBrowserController({
      inspectSnapshot: lessonHomeSnapshot
    });
    browserController.navigate = async (url: string) => {
      navigatedUrls.push(url);
      return {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-14T00:00:00.000Z',
        pageUrl: url,
        lastError: null
      };
    };

    const app = buildServiceApp({
      browserController
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/runtime/monitor/start' });

      expect(startResponse.statusCode).toBe(200);
      expect(navigatedUrls).toContain('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4');
    } finally {
      await app.close();
    }
  });

  it('returns unanswered exercise entries from the current lesson timeline', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController(),
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      const response = await app.inject({ method: 'GET', url: '/runtime/exercises' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          entryId: 'timeline-4',
          status: 'unanswered',
          isActive: true
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('marks unanswered exercise entries as done after processing them', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController({
        inspectSnapshot: {
          ...snapshot,
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4'
        }
      }),
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      const response = await app.inject({ method: 'GET', url: '/runtime/exercises' });

      expect(response.statusCode).toBe(200);
      expect(response.json()[0]).toMatchObject({
        entryId: 'timeline-4',
        analysisStatus: 'done'
      });
    } finally {
      await app.close();
    }
  });

  it('prefers the active unanswered exercise over older pending entries', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController({
        inspectSnapshot: {
          ...snapshot,
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13'
        },
        listedExercises: [
          {
            entryId: 'timeline-10',
            lessonId: 'lesson-1',
            status: 'unanswered',
            isActive: false,
            pageHint: '第5页',
            remainingHint: '11分钟前',
            thumbnailUrl: 'https://example.com/problem-10.png',
            exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10'
          },
          {
            entryId: 'timeline-13',
            lessonId: 'lesson-1',
            status: 'unanswered',
            isActive: true,
            pageHint: '第6页',
            remainingHint: '刚刚',
            thumbnailUrl: 'https://example.com/problem-13.png',
            exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13'
          }
        ]
      }),
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      const response = await app.inject({ method: 'GET', url: '/runtime/exercises' });

      expect(response.statusCode).toBe(200);
      const entries = response.json();
      expect(entries.find((entry: { entryId: string }) => entry.entryId === 'timeline-13')).toMatchObject({
        analysisStatus: 'done'
      });
      expect(entries.find((entry: { entryId: string }) => entry.entryId === 'timeline-10')).toMatchObject({
        analysisStatus: 'pending'
      });
    } finally {
      await app.close();
    }
  });

  it('moves to the next unanswered exercise after the active one is already done', async () => {
    const navigatedUrls: string[] = [];
    const browserController = createBrowserController({
      inspectSnapshot: {
        ...snapshot,
        currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13'
      },
      listedExercises: [
        {
          entryId: 'timeline-10',
          lessonId: 'lesson-1',
          status: 'unanswered',
          isActive: false,
          pageHint: '第5页',
          remainingHint: '11分钟前',
          thumbnailUrl: 'https://example.com/problem-10.png',
          exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10',
          analysisStatus: 'pending'
        },
        {
          entryId: 'timeline-13',
          lessonId: 'lesson-1',
          status: 'unanswered',
          isActive: true,
          pageHint: '第6页',
          remainingHint: '刚刚',
          thumbnailUrl: 'https://example.com/problem-13.png',
          exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13',
          analysisStatus: 'done'
        }
      ]
    });

    browserController.navigate = async (url: string) => {
      navigatedUrls.push(url);
      return {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-14T00:00:00.000Z',
        pageUrl: url,
        lastError: null
      };
    };

    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
      expect(navigatedUrls).toContain('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10');
    } finally {
      await app.close();
    }
  });
});
