import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import type {
  BrowserController,
  BrowserStatus,
  ExerciseEntry,
  ExerciseRuntimeState,
  LessonCandidate,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult,
  PageSnapshot,
  ScreenshotPayload,
  SessionState
} from '../../apps/service/src/browser/browser-controller';

afterEach(() => {
  vi.restoreAllMocks();
});

const runningStatus: BrowserStatus = {
  status: 'running',
  engine: 'chromium',
  headless: true,
  mode: 'headless',
  startedAt: '2026-04-15T00:00:00.000Z',
  pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10',
  lastError: null
};

const sessionState: SessionState = {
  hasSession: true,
  savedAt: '2026-04-15T00:00:00.000Z',
  origin: 'www.yuketang.cn',
  cookieCount: 3,
  currentUrl: runningStatus.pageUrl,
  pageTitle: 'test',
  mode: 'headless'
};

const homeLesson: LessonCandidate = {
  id: 'lesson-1',
  courseTitle: 'test',
  lessonTitle: '第 1 讲',
  lessonState: 'in_class',
  href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
};

const entries: ExerciseEntry[] = [
  {
    entryId: 'timeline-10',
    lessonId: 'lesson-1',
    status: 'unanswered',
    isActive: false,
    pageHint: '第5页',
    remainingHint: '10分钟前',
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
];

const snapshotsByUrl: Record<string, PageSnapshot> = {
  'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10': {
    currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10',
    pageTitle: 'test',
    html: `
      <section class="page-exercise">
        <div class="problem-title">10 题题干</div>
        <div class="option">A</div>
        <div class="option">B</div>
      </section>
    `,
    text: '10 题题干\nA\nB\n提交答案'
  },
  'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13': {
    currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13',
    pageTitle: 'test',
    html: `
      <section class="page-exercise">
        <div class="problem-title">13 题题干</div>
        <div class="option">A</div>
        <div class="option">B</div>
      </section>
    `,
    text: '13 题题干\nA\nB\n提交答案'
  }
};

const runtimeStatesByUrl: Record<string, ExerciseRuntimeState> = {
  'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10': {
    lessonId: 'lesson-1',
    exerciseIndex: '10',
    problemId: 'problem-10',
    problemType: 1,
    pageIndex: 5,
    questionText: '10 题题干',
    options: [
      { key: 'A', value: 'A' },
      { key: 'B', value: 'B' }
    ],
    isComplete: false,
    routePath: '/v3/lesson-1/exercise/10'
  },
  'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13': {
    lessonId: 'lesson-1',
    exerciseIndex: '13',
    problemId: 'problem-13',
    problemType: 1,
    pageIndex: 6,
    questionText: '13 题题干',
    options: [
      { key: 'A', value: 'A' },
      { key: 'B', value: 'B' }
    ],
    isComplete: false,
    routePath: '/v3/lesson-1/exercise/13'
  }
};

const createBrowserController = (options: {
  solveDelayMs?: number;
  failFirstProblemId?: string;
} = {}): BrowserController & {
  submittedPayloads: LessonProblemSubmitPayload[];
} => {
  let currentUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1';
  const submitAttempts = new Map<string, number>();
  const submittedPayloads: LessonProblemSubmitPayload[] = [];
  const screenshot: ScreenshotPayload = {
    mimeType: 'image/png',
    data: 'ZmFrZS1wbmc='
  };

  const submitResult = (payload: LessonProblemSubmitPayload): LessonProblemSubmitResult => ({
    ok: true,
    code: 0,
    message: 'OK',
    responseJson: { code: 0, msg: 'OK', data: { problemId: payload.problemId } }
  });

  return {
    submittedPayloads,
    getStatus: () => ({
      ...runningStatus,
      pageUrl: currentUrl
    }),
    start: async () => ({
      ...runningStatus,
      pageUrl: currentUrl
    }),
    startLogin: async () => ({
      ...runningStatus,
      mode: 'visible-login',
      pageUrl: currentUrl
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
    navigateHome: async () => {
      currentUrl = 'https://www.yuketang.cn/v2/web/index';
      return {
        ...runningStatus,
        pageUrl: currentUrl
      };
    },
    navigate: async (url: string) => {
      currentUrl = url;
      return {
        ...runningStatus,
        pageUrl: currentUrl
      };
    },
    discoverLessons: async () => [homeLesson],
    listExerciseEntries: async () => entries,
    inspectPage: async () =>
      snapshotsByUrl[currentUrl] ?? {
        currentUrl,
        pageTitle: 'test',
        html: '<main><div>课堂主页</div></main>',
        text: '课堂主页'
      },
    captureScreenshot: async () => {
      if (options.solveDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.solveDelayMs));
      }
      return screenshot;
    },
    ensureExercisePageReady: async (url: string) => {
      currentUrl = url;
      return runtimeStatesByUrl[url];
    },
    readExerciseRuntimeState: async () => runtimeStatesByUrl[currentUrl] ?? null,
    submitLessonProblem: async (payload: LessonProblemSubmitPayload) => {
      submittedPayloads.push(payload);
      const attempts = (submitAttempts.get(payload.problemId) ?? 0) + 1;
      submitAttempts.set(payload.problemId, attempts);
      if (options.failFirstProblemId === payload.problemId && attempts === 1) {
        return {
          ok: false,
          code: 50001,
          message: 'temporary failure',
          responseJson: { code: 50001, msg: 'temporary failure' }
        };
      }
      return submitResult(payload);
    }
  };
};

const createVisionAnalysisService = (options: {
  delayMs?: number;
  nullForQuestionId?: string;
} = {}) => ({
  analyzeQuestionImage: async ({ questionId }: { questionId: string }) => {
    if (options.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    if (options.nullForQuestionId === questionId) {
      return {
        id: 1,
        questionId,
        captureId: 1,
        provider: 'openai' as const,
        model: 'gpt-4.1-mini',
        promptVersion: 'subjective.v1',
        questionType: 'subjective' as const,
        questionText: questionId,
        options: [],
        suggestedAnswer: null,
        confidence: 'low' as const,
        reasoningSummary: '无法可靠判断，按策略仍需自动提交。',
        rawResponseJson: '{}',
        createdAt: '2026-04-15T00:00:00.000Z'
      };
    }

    return {
      id: 1,
      questionId,
      captureId: 1,
      provider: 'openai' as const,
      model: 'gpt-4.1-mini',
      promptVersion: 'single_choice.v1',
      questionType: 'single_choice' as const,
      questionText: questionId,
      options: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' }
      ],
      suggestedAnswer: 'B',
      confidence: 'medium' as const,
      reasoningSummary: '答案为 B。',
      rawResponseJson: '{}',
      createdAt: '2026-04-15T00:00:00.000Z'
    };
  }
});

describe('autoplay routes', () => {
  it('starts a run, processes unanswered exercises, and stores run history', async () => {
    const browserController = createBrowserController();
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.statusCode).toBe(200);
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 2,
          successCount: 2,
          failedCount: 0
        });
      });

      const runsResponse = await app.inject({ method: 'GET', url: '/autoplay/runs' });
      expect(runsResponse.statusCode).toBe(200);
      expect(runsResponse.json()[0]).toMatchObject({
        status: 'succeeded',
        totalCount: 2,
        successCount: 2
      });

      const runId = runsResponse.json()[0].id;
      const detailResponse = await app.inject({ method: 'GET', url: `/autoplay/runs/${runId}` });
      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json()).toMatchObject({
        run: {
          id: runId,
          status: 'succeeded'
        }
      });
      expect(detailResponse.json().attempts).toHaveLength(2);
      expect(browserController.submittedPayloads.map((payload) => payload.problemId)).toEqual(['problem-10', 'problem-13']);
    } finally {
      await app.close();
    }
  });

  it('retries a failed submit once and then succeeds', async () => {
    const browserController = createBrowserController({
      failFirstProblemId: 'problem-10'
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      await app.inject({ method: 'POST', url: '/autoplay/start' });

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          successCount: 2,
          failedCount: 0
        });
      });

      expect(browserController.submittedPayloads.filter((payload) => payload.problemId === 'problem-10')).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it('reports running status while solves are in progress and does not start a second run concurrently', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController(),
      visionAnalysisService: createVisionAnalysisService({ delayMs: 200 })
    });

    try {
      const firstStart = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(firstStart.statusCode).toBe(200);

      const statusWhileRunning = await app.inject({ method: 'GET', url: '/autoplay/status' });
      expect(statusWhileRunning.statusCode).toBe(200);
      expect(statusWhileRunning.json()).toMatchObject({
        status: 'running'
      });

      const secondStart = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(secondStart.statusCode).toBe(200);
      expect(secondStart.json()).toMatchObject({
        status: 'running'
      });

      await vi.waitFor(async () => {
        const finalStatus = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(finalStatus.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 2
        });
      });
    } finally {
      await app.close();
    }
  });
});
