import { describe, expect, it, vi } from 'vitest';
import { AccountMonitorManager } from '../../apps/service/src/monitors/account-monitor-manager';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';

const createManager = (overrides: { accountRepository?: Record<string, unknown> } = {}) =>
  new AccountMonitorManager({
    accountRepository: {
      ...overrides.accountRepository
    } as any,
    runtimeRepository: {} as any,
    assistRepository: {} as any,
    autoAnswerRepository: {} as any,
    questionSolveService: {} as any,
    automationStore: {} as any
  });

const createWorker = () => ({
  browserController: {} as any,
  autoplayMonitorService: {} as any,
  autoAnswerService: {} as any,
  traceStore: new AutoplayDebugTraceStore(),
  pendingSubmitFailures: new Map<string, boolean>(),
  logs: [] as Array<{ id: number; at: string; type: string; message: string }>,
  nextLogId: 1,
  snapshot: {
    accountId: 1,
    monitorStatus: 'monitoring' as const,
    monitorUpdatedAt: null,
    monitorLastError: null,
    currentClassroom: null,
    recentLogs: []
  }
});

describe('AccountMonitorManager', () => {
  it('marks the account as expired instead of logging home entered when browser start lands on the login page', async () => {
    const accountRepository = {
      listWithSessions: vi.fn().mockReturnValue([
        {
          id: 1,
          monitoringEnabled: true,
          session: {
            cookies: [{ name: 'sessionid', value: 'cookie-value' }],
            savedAt: '2026-04-19T00:00:00.000Z',
            origin: 'www.yuketang.cn',
            currentUrl: 'https://www.yuketang.cn/v2/web/index',
            pageTitle: '雨课堂',
            mode: 'qr-login'
          }
        }
      ]),
      getStoredSession: vi.fn(),
      saveSession: vi.fn(),
      markLoginFailure: vi.fn()
    };
    const manager = new AccountMonitorManager({
      accountRepository: accountRepository as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {} as any,
      questionSolveService: {} as any,
      automationStore: {} as any,
      controllerFactory: () =>
        ({
          start: vi.fn().mockResolvedValue({
            status: 'running',
            engine: 'chromium',
            headless: true,
            mode: 'headless',
            startedAt: '2026-04-19T00:00:00.000Z',
            pageUrl: 'https://www.yuketang.cn/web?next=/v2/web/index&type=3',
            lastError: null
          }),
          stop: vi.fn().mockResolvedValue({
            status: 'idle',
            engine: 'chromium',
            headless: true,
            mode: null,
            startedAt: null,
            pageUrl: null,
            lastError: null
          }),
          getStatus: vi.fn().mockReturnValue({
            status: 'idle',
            engine: 'chromium',
            headless: true,
            mode: null,
            startedAt: null,
            pageUrl: null,
            lastError: null
          }),
          getSessionState: vi.fn().mockResolvedValue({
            hasSession: true,
            savedAt: '2026-04-19T00:00:00.000Z',
            origin: 'www.yuketang.cn',
            cookieCount: 1,
            currentUrl: 'https://www.yuketang.cn/v2/web/index',
            pageTitle: '雨课堂',
            mode: 'headless'
          }),
          saveSession: vi.fn(),
          navigateHome: vi.fn(),
          navigate: vi.fn(),
          discoverLessons: vi.fn().mockResolvedValue([]),
          listExerciseEntries: vi.fn().mockResolvedValue([]),
          openCurrentExercise: vi.fn().mockResolvedValue(null),
          inspectPage: vi.fn().mockResolvedValue({
            currentUrl: 'https://www.yuketang.cn/web?next=/v2/web/index&type=3',
            pageTitle: null,
            html: null,
            text: null
          }),
          getDebugState: vi.fn(),
          captureScreenshot: vi.fn().mockResolvedValue(null),
          ensureExercisePageReady: vi.fn(),
          readExerciseRuntimeState: vi.fn().mockResolvedValue(null),
          startQuestionDetection: vi.fn(),
          stopQuestionDetection: vi.fn(),
          submitLessonProblem: vi.fn()
        }) as any
    });

    const snapshot = await manager.startForAccount(1, 'refresh');

    expect(accountRepository.markLoginFailure).toHaveBeenCalledWith(1, '会话失效，需重新登录');
    expect(snapshot.monitorStatus).toBe('error');
    expect(snapshot.monitorLastError).toBe('会话失效，需重新登录');
    expect(snapshot.recentLogs.map((log) => log.message)).not.toContain('成功进入首页');
  });

  it('clears stale login failure state after the browser successfully enters the home page', async () => {
    const accountRepository = {
      listWithSessions: vi.fn().mockReturnValue([
        {
          id: 1,
          monitoringEnabled: true,
          session: {
            cookies: [{ name: 'sessionid', value: 'cookie-value' }],
            savedAt: '2026-04-20T07:53:04.892Z',
            origin: 'www.yuketang.cn',
            currentUrl: 'https://www.yuketang.cn/authorize/wx-qrlogin?success=1',
            pageTitle: '雨课堂',
            mode: 'qr-login'
          }
        }
      ]),
      getStoredSession: vi.fn(),
      saveSession: vi.fn(),
      markLoginFailure: vi.fn(),
      markLoginHealthy: vi.fn()
    };
    const manager = new AccountMonitorManager({
      accountRepository: accountRepository as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {} as any,
      questionSolveService: {} as any,
      automationStore: {} as any,
      controllerFactory: () =>
        ({
          start: vi.fn().mockResolvedValue({
            status: 'running',
            engine: 'chromium',
            headless: true,
            mode: 'headless',
            startedAt: '2026-04-20T07:54:17.000Z',
            pageUrl: 'https://www.yuketang.cn/v2/web/index',
            lastError: null
          }),
          stop: vi.fn().mockResolvedValue({
            status: 'idle',
            engine: 'chromium',
            headless: true,
            mode: null,
            startedAt: null,
            pageUrl: null,
            lastError: null
          }),
          getStatus: vi.fn().mockReturnValue({
            status: 'idle',
            engine: 'chromium',
            headless: true,
            mode: null,
            startedAt: null,
            pageUrl: null,
            lastError: null
          }),
          getSessionState: vi.fn().mockResolvedValue({
            hasSession: true,
            savedAt: '2026-04-20T07:53:04.892Z',
            origin: 'www.yuketang.cn',
            cookieCount: 1,
            currentUrl: 'https://www.yuketang.cn/v2/web/index',
            pageTitle: '雨课堂',
            mode: 'headless'
          }),
          saveSession: vi.fn(),
          navigateHome: vi.fn(),
          navigate: vi.fn(),
          discoverLessons: vi.fn().mockResolvedValue([]),
          listExerciseEntries: vi.fn().mockResolvedValue([]),
          openCurrentExercise: vi.fn().mockResolvedValue(null),
          inspectPage: vi.fn().mockResolvedValue({
            currentUrl: 'https://www.yuketang.cn/v2/web/index',
            pageTitle: '雨课堂',
            html: null,
            text: null
          }),
          getDebugState: vi.fn(),
          captureScreenshot: vi.fn().mockResolvedValue(null),
          ensureExercisePageReady: vi.fn(),
          readExerciseRuntimeState: vi.fn().mockResolvedValue(null),
          startQuestionDetection: vi.fn(),
          stopQuestionDetection: vi.fn(),
          submitLessonProblem: vi.fn()
        }) as any
    });

    const snapshot = await manager.startForAccount(1, 'refresh');

    expect(accountRepository.markLoginHealthy).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        checkedAt: '2026-04-20T07:54:17.000Z',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        mode: 'headless'
      })
    );
    expect(snapshot.monitorStatus).toBe('monitoring');
    expect(snapshot.monitorLastError).toBeNull();
  });

  it('only logs the final submit outcome for one submission attempt', () => {
    const manager = createManager();
    const worker = createWorker();

    (manager as any).patchTraceStore(worker);

    worker.traceStore.record('submit_result', 'Submit failed for timeline-1', {
      attemptId: 'attempt-1',
      exerciseEntryId: 'timeline-1',
      ok: false
    });
    worker.traceStore.record('submit_result', 'Submit succeeded for timeline-1', {
      attemptId: 'attempt-1',
      exerciseEntryId: 'timeline-1',
      ok: true
    });

    expect(worker.logs.map((log) => log.message)).toEqual(['答案提交成功']);
  });

  it('only logs one failure after both submit attempts fail', () => {
    const manager = createManager();
    const worker = createWorker();

    (manager as any).patchTraceStore(worker);

    worker.traceStore.record('submit_result', 'Submit failed for timeline-1', {
      attemptId: 'attempt-1',
      exerciseEntryId: 'timeline-1',
      ok: false
    });
    worker.traceStore.record('submit_result', 'Submit failed for timeline-1', {
      attemptId: 'attempt-1',
      exerciseEntryId: 'timeline-1',
      ok: false
    });

    expect(worker.logs.map((log) => log.message)).toEqual(['答案提交失败']);
  });

  it('tracks the current classroom context from discovered lessons', async () => {
    const manager = createManager();
    const worker = createWorker();
    worker.browserController = {
      discoverLessons: vi.fn().mockResolvedValue([
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        }
      ])
    } as any;

    (manager as any).patchBrowserController(worker);

    await worker.browserController.discoverLessons();

    expect(worker.snapshot.currentClassroom).toMatchObject({
      lessonId: 'lesson-1',
      classroomId: 'classroom-1',
      courseTitle: '高等数学',
      classroomTitle: '第一讲',
      status: 'in_class'
    });
  });

  it('clears the current classroom context when the controller returns home', async () => {
    const manager = createManager();
    const worker = createWorker();
    worker.snapshot.currentClassroom = {
      lessonId: 'lesson-1',
      classroomId: 'classroom-1',
      courseTitle: '高等数学',
      classroomTitle: '第一讲',
      status: 'in_class',
      detectedAt: '2026-04-20T06:00:00.000Z'
    };
    worker.browserController = {
      discoverLessons: vi.fn().mockResolvedValue([]),
      navigateHome: vi.fn().mockResolvedValue({
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: '2026-04-20T06:00:00.000Z',
        pageUrl: 'https://www.yuketang.cn/v2/web/index',
        lastError: null
      })
    } as any;

    (manager as any).patchBrowserController(worker);

    await worker.browserController.navigateHome();

    expect(worker.snapshot.currentClassroom).toBeNull();
  });

  it('logs the configured classroom entry countdown in seconds', () => {
    const manager = createManager();
    const worker = createWorker();

    (manager as any).patchTraceStore(worker);

    worker.traceStore.record('classroom_detected', '检测到课堂，10秒后进入课堂', {
      lessonId: 'lesson-1',
      href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
      delayMs: 10000
    });

    expect(worker.logs.map((log) => log.message)).toEqual(['检测到课堂，10秒后进入课堂']);
  });

  it('logs a clear qwen api key error when the ai request fails before solving', () => {
    const accountRepository = {
      markAccountError: vi.fn()
    };
    const manager = createManager({
      accountRepository
    });
    const worker = createWorker();

    (manager as any).patchTraceStore(worker);

    worker.traceStore.record('ai_request_failed', 'api key未配置，无法调用 AI 解题', {
      provider: 'qwen_vl',
      reason: 'QWEN_VL_API_KEY is not configured'
    });

    expect(accountRepository.markAccountError).toHaveBeenCalledWith(1, 'api key未配置，无法调用 AI 解题');
    expect(worker.logs.map((log) => log.message)).toEqual(['api key未配置，无法调用 AI 解题']);
  });

  it('uses the api controller as the default worker controller', () => {
    const manager = createManager();

    const controller = (manager as any).controllerFactory({
      accountId: 1,
      sessionStore: {
        load: vi.fn().mockResolvedValue(null),
        save: vi.fn()
      },
      traceStore: new AutoplayDebugTraceStore()
    });

    expect(controller.supportsPushedQuestionDetection?.()).toBe(true);
  });
});
