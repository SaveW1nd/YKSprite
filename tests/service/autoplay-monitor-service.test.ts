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

  it('starts auto-answer from a curr-slide push event without re-confirming through list polling', async () => {
    let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
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
      listExerciseEntries: vi.fn(async () => {
        throw new Error('list polling should not run for pushed question confirmation');
      }),
      readExerciseRuntimeState: vi.fn(async () => {
        throw new Error('runtime polling should not run for pushed question confirmation');
      })
    } as unknown as BrowserController;
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: 'idle' })),
      start: vi.fn(async () => ({ runId: 'run-push-only' }))
    };
    const onLog = vi.fn();
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      intervalMs: 1000,
      onLog
    });

    await service.start();
    await onQuestionEvent?.({
      lessonId: 'lesson-1',
      problemId: 'problem-20',
      problemType: 2,
      exerciseIndex: null,
      routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-20T06:00:00.000Z',
      pageIndex: 20,
      source: 'curr-slide-event'
    });

    expect(onLog).toHaveBeenCalledWith('检测到题目', 'question_detected');
    expect(autoAnswerService.start).toHaveBeenCalledWith({
      preferredQuestion: expect.objectContaining({
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        source: 'curr-slide-event'
      })
    });
    expect(autoAnswerService.start).toHaveBeenCalledTimes(1);
    expect(service.getStatus().lastTriggeredRunId).toBe('run-push-only');
  });

  it('queues a later pushed question while a previous auto-answer run is still active', async () => {
    vi.useFakeTimers();
    let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
    let autoAnswerStatus: 'running' | 'idle' = 'running';
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
      startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
        onQuestionEvent = handler;
      })
    } as unknown as BrowserController;
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: autoAnswerStatus })),
      start: vi.fn(async () => ({ runId: 'run-queued' }))
    };
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      intervalMs: 100
    });

    await service.start();
    await onQuestionEvent?.({
      lessonId: 'lesson-1',
      problemId: 'problem-21',
      problemType: 1,
      exerciseIndex: null,
      routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-20T06:01:00.000Z',
      pageIndex: 21,
      source: 'curr-slide-event'
    });

    expect(autoAnswerService.start).not.toHaveBeenCalled();

    autoAnswerStatus = 'idle';
    await vi.advanceTimersByTimeAsync(100);

    expect(autoAnswerService.start).toHaveBeenCalledWith({
      preferredQuestion: expect.objectContaining({
        lessonId: 'lesson-1',
        problemId: 'problem-21',
        pageIndex: 21
      })
    });
    expect(autoAnswerService.start).toHaveBeenCalledTimes(1);
  });

  it('passes preferredQuestion into auto answer runs for both immediate and queued events', async () => {
    vi.useFakeTimers();
    let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
    let autoAnswerStatus: 'idle' | 'running' = 'idle';
    const autoAnswerService = {
      getStatus: vi.fn(() => ({ status: autoAnswerStatus })),
      start: vi.fn(async () => ({ runId: `run-${Date.now()}` }))
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
      startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
        onQuestionEvent = handler;
      })
    } as unknown as BrowserController;
    const service = new AutoplayMonitorService({
      autoAnswerService: autoAnswerService as any,
      browserController,
      intervalMs: 100
    });

    await service.start();
    await onQuestionEvent?.({
      lessonId: 'lesson-1',
      problemId: 'problem-20',
      problemType: 2,
      exerciseIndex: null,
      routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-20T06:00:00.000Z',
      pageIndex: 20,
      source: 'curr-slide-event'
    });

    autoAnswerStatus = 'running';
    await onQuestionEvent?.({
      lessonId: 'lesson-1',
      problemId: 'problem-21',
      problemType: 1,
      exerciseIndex: null,
      routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-20T06:01:00.000Z',
      pageIndex: 21,
      source: 'curr-slide-event'
    });

    autoAnswerStatus = 'idle';
    await vi.advanceTimersByTimeAsync(100);

    expect(autoAnswerService.start).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        preferredQuestion: expect.objectContaining({ problemId: 'problem-20' })
      })
    );
    expect(autoAnswerService.start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        preferredQuestion: expect.objectContaining({ problemId: 'problem-21' })
      })
    );
  });
});
