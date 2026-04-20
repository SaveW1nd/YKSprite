import { afterEach, describe, expect, it, vi } from 'vitest';
import { AutoplayMonitorService } from '../../apps/service/src/auto-answer/autoplay-monitor-service';
import type { BrowserController } from '../../apps/service/src/browser/browser-controller';

const createBrowserController = (
  discoverLessons: BrowserController['discoverLessons']
): BrowserController => ({
  getStatus: vi.fn(() => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-20T00:00:00.000Z',
    pageUrl: 'https://www.yuketang.cn/v2/web/index',
    lastError: null
  })),
  start: vi.fn(),
  stop: vi.fn(),
  getSessionState: vi.fn(async () => ({
    hasSession: true,
    savedAt: '2026-04-20T00:00:00.000Z',
    origin: 'www.yuketang.cn',
    cookieCount: 2,
    currentUrl: 'https://www.yuketang.cn/v2/web/index',
    pageTitle: '雨课堂',
    mode: 'headless'
  })),
  saveSession: vi.fn(),
  navigateHome: vi.fn(),
  navigate: vi.fn(async (url: string) => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    mode: 'headless',
    startedAt: '2026-04-20T00:00:00.000Z',
    pageUrl: url,
    lastError: null
  })),
  discoverLessons,
  listExerciseEntries: vi.fn(async () => []),
  openCurrentExercise: vi.fn(async () => null),
  inspectPage: vi.fn(async () => ({
    currentUrl: 'https://www.yuketang.cn/v2/web/index',
    pageTitle: '雨课堂',
    html: '<html></html>',
    text: '首页'
  })),
  getDebugState: vi.fn(),
  captureScreenshot: vi.fn(),
  ensureExercisePageReady: vi.fn(),
  readExerciseRuntimeState: vi.fn(async () => null),
  startQuestionDetection: vi.fn(async () => undefined),
  stopQuestionDetection: vi.fn(async () => undefined),
  submitLessonProblem: vi.fn()
}) as unknown as BrowserController;

afterEach(() => {
  vi.useRealTimers();
});

describe('AutoplayMonitorService', () => {
  it('keeps polling lessons and enters the classroom when a lesson becomes active later', async () => {
    vi.useFakeTimers();
    const discoverLessons = vi
      .fn<BrowserController['discoverLessons']>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        }
      ]);
    const browserController = createBrowserController(discoverLessons);
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: 'idle' })),
      start: vi.fn()
    };
    const onLog = vi.fn();
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      intervalMs: 100,
      onLog
    });

    await service.start();

    expect(browserController.navigate).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(100);

    expect(browserController.navigate).toHaveBeenCalledWith('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
    expect(onLog).toHaveBeenCalledWith('成功进入课堂', 'classroom_entered');
  });

  it('does not navigate immediately when the controller defers active lesson entry itself', async () => {
    const browserController = {
      ...createBrowserController(
        vi.fn().mockResolvedValue([
          {
            id: 'lesson-1',
            classroomId: 'classroom-1',
            courseTitle: '高等数学',
            lessonTitle: '第一讲',
            lessonState: 'in_class',
            href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
          }
        ])
      ),
      supportsDeferredActiveLessonEntry: () => true
    } as unknown as BrowserController;
    const service = new AutoplayMonitorService({
      autoAnswerService: {
        getStatus: () => ({ status: 'idle' }),
        start: vi.fn()
      } as any,
      browserController,
      intervalMs: 10
    });

    await service.start();

    expect(browserController.navigate).not.toHaveBeenCalled();
  });

  it('returns to the home page when wsapp reports the lesson has finished', async () => {
    let onClassroomEvent: ((event: any) => Promise<void>) | null = null;
    const browserController = {
      ...createBrowserController(
        vi.fn().mockResolvedValue([
          {
            id: 'lesson-1',
            classroomId: 'classroom-1',
            courseTitle: '高等数学',
            lessonTitle: '第一讲',
            lessonState: 'in_class',
            href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
          }
        ])
      ),
      navigateHome: vi.fn(async () => ({
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-20T00:00:00.000Z',
        pageUrl: 'https://www.yuketang.cn/v2/web/index',
        lastError: null
      })),
      startClassroomDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
        onClassroomEvent = handler;
      })
    } as unknown as BrowserController;
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: 'idle' })),
      start: vi.fn()
    };
    const onLog = vi.fn();
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      onLog
    });

    await service.start();
    await onClassroomEvent?.({
      lessonId: 'lesson-1',
      eventType: 'lesson_finished',
      source: 'wsapp',
      code: 'LESSON_FINISH',
      title: '下课啦',
      detectedAt: '2026-04-20T06:00:00.000Z'
    });

    expect(browserController.navigateHome).toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith('课堂已结束，已返回首页', 'classroom_left');
  });

  it('retries a pushed question until the classroom runtime state becomes readable', async () => {
    vi.useFakeTimers();
    let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
    let runtimeReady = false;
    const runtimeState = {
      lessonId: 'lesson-1',
      exerciseIndex: '8',
      problemId: 'problem-8',
      problemType: 1,
      pageIndex: 8,
      questionText: '第 8 题',
      options: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' }
      ],
      imageUrl: 'https://example.com/problem-8.jpg',
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/8'
    };
    const browserController = {
      ...createBrowserController(
        vi.fn().mockResolvedValue([
          {
            id: 'lesson-1',
            classroomId: 'classroom-1',
            courseTitle: '高等数学',
            lessonTitle: '第一讲',
            lessonState: 'in_class',
            href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
          }
        ])
      ),
      supportsPushedQuestionDetection: () => true,
      getStatus: vi.fn(() => ({
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-20T00:00:00.000Z',
        pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
        lastError: null
      })),
      getSessionState: vi.fn(async () => ({
        hasSession: true,
        savedAt: '2026-04-20T00:00:00.000Z',
        origin: 'www.yuketang.cn',
        cookieCount: 2,
        currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
        pageTitle: '雨课堂',
        mode: 'headless'
      })),
      inspectPage: vi.fn(async () => ({
        currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
        pageTitle: '雨课堂',
        html: '<html></html>',
        text: '课堂中'
      })),
      startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
        onQuestionEvent = handler;
      }),
      listExerciseEntries: vi.fn(async () =>
        runtimeReady
          ? [
              {
                entryId: 'current-exercise-8',
                lessonId: 'lesson-1',
                status: 'unanswered' as const,
                isActive: true,
                pageHint: '第8页',
                remainingHint: null,
                thumbnailUrl: null,
                exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/8',
                runtimeState
              }
            ]
          : []
      ),
      readExerciseRuntimeState: vi.fn(async () => (runtimeReady ? runtimeState : null))
    } as unknown as BrowserController;
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: 'idle' })),
      start: vi.fn(async () => ({ runId: 'run-1' }))
    };
    const onLog = vi.fn();
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      intervalMs: 1000,
      onLog
    });

    await service.start();

    setTimeout(() => {
      runtimeReady = true;
    }, 100);

    const pending = onQuestionEvent?.({
      lessonId: 'lesson-1',
      problemId: 'problem-8',
      problemType: 1,
      exerciseIndex: '8',
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/8',
      isComplete: false,
      imageUrl: 'https://example.com/problem-8.jpg',
      detectedAt: '2026-04-20T06:00:00.000Z'
    });

    await vi.advanceTimersByTimeAsync(200);
    await pending;

    expect(onLog).toHaveBeenCalledWith('检测到题目', 'question_detected');
    expect(autoAnswerService.start).toHaveBeenCalledTimes(1);
    expect(service.getStatus().lastTriggeredRunId).toBe('run-1');
  });
});
