import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      headers: {
        get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null)
      },
      arrayBuffer: async () => Buffer.from('fake-image-payload')
    })
  );
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
    imageUrl: 'https://example.com/problem-10.jpg',
    imageThumbnailUrl: 'https://example.com/problem-10-thumb.jpg',
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
    imageUrl: 'https://example.com/problem-13.jpg',
    imageThumbnailUrl: 'https://example.com/problem-13-thumb.jpg',
    isComplete: false,
    routePath: '/v3/lesson-1/exercise/13'
  }
};

const createBrowserController = (options: {
  solveDelayMs?: number;
  failFirstProblemId?: string;
  initialUrl?: string;
  discoverLessons?: LessonCandidate[];
  inspectPageByUrl?: Record<string, PageSnapshot>;
  runtimeStateByUrl?: Record<string, ExerciseRuntimeState>;
  openCurrentExerciseSequence?: Array<string | null>;
} = {}): BrowserController & {
  submittedPayloads: LessonProblemSubmitPayload[];
} => {
  let currentUrl = options.initialUrl ?? 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1';
  const submitAttempts = new Map<string, number>();
  const submittedPayloads: LessonProblemSubmitPayload[] = [];
  const inspectPageByUrl = options.inspectPageByUrl ?? snapshotsByUrl;
  const runtimeStateByUrl = options.runtimeStateByUrl ?? runtimeStatesByUrl;
  const openCurrentExerciseSequence = [...(options.openCurrentExerciseSequence ?? [])];
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
    discoverLessons: async () => options.discoverLessons ?? [homeLesson],
    listExerciseEntries: async () => entries,
    openCurrentExercise: async () => {
      const nextUrl = openCurrentExerciseSequence.shift() ?? null;
      if (nextUrl) {
        currentUrl = nextUrl;
      }
      return nextUrl;
    },
    inspectPage: async () =>
      inspectPageByUrl[currentUrl] ?? {
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
      return runtimeStateByUrl[url];
    },
    readExerciseRuntimeState: async () => runtimeStateByUrl[currentUrl] ?? null,
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
        questionText: '',
        options: [],
        suggestedAnswer: '',
        confidence: 'low' as const,
        reasoningSummary: '',
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
    const browserController = createBrowserController({
      initialUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10'
    });
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
            totalCount: 1,
            successCount: 1,
            failedCount: 0
          });
        });

      const runsResponse = await app.inject({ method: 'GET', url: '/autoplay/runs' });
      expect(runsResponse.statusCode).toBe(200);
      expect(runsResponse.json()[0]).toMatchObject({
        status: 'succeeded',
        totalCount: 1,
        successCount: 1
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
      expect(detailResponse.json().attempts).toHaveLength(1);
      expect(browserController.submittedPayloads.map((payload) => payload.problemId)).toEqual(['problem-10']);
    } finally {
      await app.close();
    }
  });

  it('retries a failed submit once and then succeeds', async () => {
    const browserController = createBrowserController({
      failFirstProblemId: 'problem-10',
      initialUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10'
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
          successCount: 1,
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
      browserController: createBrowserController({
        initialUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/10'
      }),
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
          totalCount: 1
        });
      });
    } finally {
      await app.close();
    }
  });

  it('opens the current exercise from the lesson page before collecting', async () => {
    const browserController = createBrowserController({
      initialUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
      inspectPageByUrl: {
        ...snapshotsByUrl,
        'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1': {
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          pageTitle: 'test',
          html: '<main><div>课堂主页</div></main>',
          text: '课堂主页'
        }
      },
      openCurrentExerciseSequence: ['https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13']
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(
        async () => {
          const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
          expect(statusResponse.json()).toMatchObject({
            status: 'succeeded',
            totalCount: 1,
            successCount: 1,
            failedCount: 0
          });
        },
        { timeout: 3000 }
      );

      expect(browserController.submittedPayloads.map((payload) => payload.problemId)).toEqual(['problem-13']);
    } finally {
      await app.close();
    }
  });

  it('processes the current exercise directly without relying on the timeline queue', async () => {
    const currentExerciseUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/2';
    const browserController = createBrowserController({
      initialUrl: currentExerciseUrl,
      inspectPageByUrl: {
        ...snapshotsByUrl,
        [currentExerciseUrl]: {
          currentUrl: currentExerciseUrl,
          pageTitle: 'test',
          html: `
            <section class="page-exercise">
              <div class="problem-title">当前题题干</div>
              <div class="option">A</div>
              <div class="option">B</div>
            </section>
          `,
          text: '当前题题干\nA\nB\n提交答案'
        }
      },
      runtimeStateByUrl: {
        ...runtimeStatesByUrl,
        [currentExerciseUrl]: {
          lessonId: 'lesson-1',
          exerciseIndex: '2',
          problemId: 'problem-2',
          problemType: 1,
          pageIndex: 2,
          questionText: '当前题题干',
          options: [
            { key: 'A', value: 'A' },
            { key: 'B', value: 'B' }
          ],
          imageUrl: null,
          imageThumbnailUrl: null,
          isComplete: false,
          routePath: '/v3/lesson-1/exercise/2'
        }
      }
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 1,
          successCount: 1,
          failedCount: 0
        });
      });

      expect(browserController.submittedPayloads).toHaveLength(1);
      expect(browserController.submittedPayloads[0]).toMatchObject({
        problemId: 'problem-2'
      });
    } finally {
      await app.close();
    }
  });

  it('processes the current subjective page without relying on the timeline queue', async () => {
    const currentSubjectiveUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/2';
    const browserController = createBrowserController({
      initialUrl: currentSubjectiveUrl,
      inspectPageByUrl: {
        ...snapshotsByUrl,
        [currentSubjectiveUrl]: {
          currentUrl: currentSubjectiveUrl,
          pageTitle: 'test',
          html: `
            <section class="page-subjective">
              <div class="subjective-inner">
                <div class="problem-tag">主观题</div>
                <div class="submission__text">
                  <textarea class="submission-textarea" placeholder="请输入答案"></textarea>
                </div>
                <div class="submit-btn">提交答案</div>
              </div>
            </section>
          `,
          text: '主观题\n请简述牛顿第一定律\n请输入答案\n提交答案'
        }
      },
      runtimeStateByUrl: {
        ...runtimeStatesByUrl,
        [currentSubjectiveUrl]: {
          lessonId: 'lesson-1',
          exerciseIndex: '2',
          problemId: 'problem-2-subjective',
          problemType: 5,
          pageIndex: 2,
          questionText: '请简述牛顿第一定律',
          options: [],
          imageUrl: 'https://example.com/problem-2-subjective.jpg',
          imageThumbnailUrl: 'https://example.com/problem-2-subjective-thumb.jpg',
          isComplete: false,
          routePath: '/v3/lesson-1/subjective/2'
        }
      }
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService()
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 1,
          successCount: 1,
          failedCount: 0
        });
      });

      expect(browserController.submittedPayloads).toHaveLength(1);
      expect(browserController.submittedPayloads[0]).toMatchObject({
        problemId: 'problem-2-subjective',
        problemType: 5
      });
    } finally {
      await app.close();
    }
  });

  it('does not auto-submit when the AI returns an empty subjective answer', async () => {
    const currentSubjectiveUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/3';
    const browserController = createBrowserController({
      initialUrl: currentSubjectiveUrl,
      inspectPageByUrl: {
        ...snapshotsByUrl,
        [currentSubjectiveUrl]: {
          currentUrl: currentSubjectiveUrl,
          pageTitle: 'test',
          html: `
            <section class="page-subjective">
              <div class="subjective-inner">
                <div class="problem-tag">主观题</div>
                <div class="submission__text">
                  <textarea class="submission-textarea" placeholder="请输入答案"></textarea>
                </div>
                <div class="submit-btn">提交答案</div>
              </div>
            </section>
          `,
          text: '主观题\n请输入答案\n提交答案'
        }
      },
      runtimeStateByUrl: {
        ...runtimeStatesByUrl,
        [currentSubjectiveUrl]: {
          lessonId: 'lesson-1',
          exerciseIndex: '3',
          problemId: 'problem-3-subjective',
          problemType: 5,
          pageIndex: 3,
          questionText: '',
          options: [],
          imageUrl: 'https://example.com/problem-3-subjective.jpg',
          imageThumbnailUrl: 'https://example.com/problem-3-subjective-thumb.jpg',
          isComplete: false,
          routePath: '/v3/lesson-1/subjective/3'
        }
      }
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: createVisionAnalysisService({ nullForQuestionId: 'subjective-3' })
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 1,
          successCount: 0,
          failedCount: 1
        });
      });

      expect(browserController.submittedPayloads).toHaveLength(0);
    } finally {
      await app.close();
    }
  });

  it('uses runtime problemType mapping instead of extracted HTML type when selecting the AI prompt', async () => {
    const currentExerciseUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20';
    const browserController = createBrowserController({
      initialUrl: currentExerciseUrl,
      inspectPageByUrl: {
        ...snapshotsByUrl,
        [currentExerciseUrl]: {
          currentUrl: currentExerciseUrl,
          pageTitle: 'test',
          html: `
            <section class="page-exercise">
              <div class="problem-title">请选择abc</div>
              <div class="option">A</div>
              <div class="option">B</div>
              <div class="option">C</div>
              <div class="option">D</div>
            </section>
          `,
          text: '请选择abc\nA\nB\nC\nD\n提交答案'
        }
      },
      runtimeStateByUrl: {
        ...runtimeStatesByUrl,
        [currentExerciseUrl]: {
          lessonId: 'lesson-1',
          exerciseIndex: '20',
          problemId: 'problem-20-multi',
          problemType: 2,
          pageIndex: 20,
          questionText: '',
          options: [
            { key: 'A', value: 'A' },
            { key: 'B', value: 'B' },
            { key: 'C', value: 'C' },
            { key: 'D', value: 'D' }
          ],
          imageUrl: 'https://example.com/problem-20-multi.jpg',
          imageThumbnailUrl: 'https://example.com/problem-20-multi-thumb.jpg',
          isComplete: false,
          routePath: '/v3/lesson-1/exercise/20'
        }
      }
    });
    const app = buildServiceApp({
      browserController,
      visionAnalysisService: {
        analyzeQuestionImage: async ({ questionId }) => ({
          id: 1,
          questionId,
          captureId: 1,
          provider: 'openai' as const,
          model: 'gpt-4.1-mini',
          promptVersion: 'multiple_choice.v1',
          questionType: 'multiple_choice' as const,
          questionText: '请选择abc',
          options: [
            { key: 'A', value: 'A' },
            { key: 'B', value: 'B' },
            { key: 'C', value: 'C' },
            { key: 'D', value: 'D' }
          ],
          suggestedAnswer: ['A', 'B', 'C'],
          confidence: 'medium' as const,
          reasoningSummary: '题干直接要求选择 abc。',
          rawResponseJson: '{}',
          createdAt: '2026-04-15T00:00:00.000Z'
        })
      }
    });

    try {
      const startResponse = await app.inject({ method: 'POST', url: '/autoplay/start' });
      expect(startResponse.statusCode).toBe(200);

      await vi.waitFor(async () => {
        const statusResponse = await app.inject({ method: 'GET', url: '/autoplay/status' });
        expect(statusResponse.json()).toMatchObject({
          status: 'succeeded',
          totalCount: 1,
          successCount: 1,
          failedCount: 0
        });
      });

      expect(browserController.submittedPayloads).toHaveLength(1);
      expect(browserController.submittedPayloads[0]).toMatchObject({
        problemId: 'problem-20-multi',
        problemType: 2,
        result: ['A', 'B', 'C']
      });
    } finally {
      await app.close();
    }
  });
});
