import { AutoAnswerRepository } from '../auto-answer/auto-answer-repository.js';
import { AutoAnswerService } from '../auto-answer/auto-answer-service.js';
import { AutoplayMonitorService } from '../auto-answer/autoplay-monitor-service.js';
import { QuestionSolveService } from '../auto-answer/question-solve-service.js';
import { AutomationStore } from '../automation/automation-store.js';
import type { BrowserController } from '../browser/browser-controller.js';
import { RainClassroomHttpController } from '../browser/rain-classroom-http-controller.js';
import { AccountRepository } from '../db/account-repository.js';
import type { StoredSession } from '../browser/session-store.js';
import { AssistRepository } from '../db/assist-repository.js';
import { RuntimeRepository } from '../db/runtime-repository.js';
import { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';
import { isRainClassroomHomePageUrl } from '../browser/rain-classroom-platforms.js';
import { normalizeAiErrorMessage } from '../assist/ai-error-message.js';

export type AccountMonitorLog = {
  id: number;
  at: string;
  type: string;
  message: string;
};

export type ActiveClassroomContext = {
  lessonId: string;
  classroomId: string | null;
  courseTitle: string;
  classroomTitle: string | null;
  status: 'in_class' | 'idle';
  detectedAt: string;
};

export type AccountMonitorSnapshot = {
  accountId: number;
  monitorStatus: 'idle' | 'starting' | 'monitoring' | 'error';
  monitorUpdatedAt: string | null;
  monitorLastError: string | null;
  currentClassroom: ActiveClassroomContext | null;
  recentLogs: AccountMonitorLog[];
};

type AccountMonitorManagerOptions = {
  accountRepository: AccountRepository;
  runtimeRepository: RuntimeRepository;
  assistRepository: AssistRepository;
  autoAnswerRepository: AutoAnswerRepository;
  questionSolveService: QuestionSolveService;
  automationStore: AutomationStore;
  onSnapshotChanged?: (accountId: number) => void;
  controllerFactory?: (input: {
    accountId: number;
    activeLessonEnterDelayMs: number;
    sessionStore: AccountSessionStore;
    traceStore: AutoplayDebugTraceStore;
  }) => BrowserController;
};

type MonitorWorker = {
  browserController: BrowserController;
  autoplayMonitorService: AutoplayMonitorService;
  autoAnswerService: AutoAnswerService;
  traceStore: AutoplayDebugTraceStore;
  pendingSubmitFailures: Map<string, boolean>;
  logs: AccountMonitorLog[];
  nextLogId: number;
  snapshot: AccountMonitorSnapshot;
};

class AccountSessionStore {
  constructor(
    private readonly accountRepository: AccountRepository,
    private readonly accountId: number
  ) {}

  async load(): Promise<StoredSession | null> {
    return this.accountRepository.getStoredSession(this.accountId);
  }

  async save(session: StoredSession): Promise<StoredSession> {
    this.accountRepository.saveSession(this.accountId, {
      cookies: session.cookies,
      savedAt: session.savedAt,
      origin: session.origin,
      currentUrl: session.currentUrl ?? null,
      pageTitle: session.pageTitle ?? null,
      mode: session.mode ?? null
    });

    return session;
  }
}

export class AccountMonitorManager {
  private readonly accountRepository: AccountRepository;
  private readonly runtimeRepository: RuntimeRepository;
  private readonly assistRepository: AssistRepository;
  private readonly autoAnswerRepository: AutoAnswerRepository;
  private readonly questionSolveService: QuestionSolveService;
  private readonly automationStore: AutomationStore;
  private readonly onSnapshotChanged: ((accountId: number) => void) | null;
  private readonly controllerFactory: NonNullable<AccountMonitorManagerOptions['controllerFactory']>;
  private readonly workers = new Map<number, MonitorWorker>();

  constructor(options: AccountMonitorManagerOptions) {
    this.accountRepository = options.accountRepository;
    this.runtimeRepository = options.runtimeRepository;
    this.assistRepository = options.assistRepository;
    this.autoAnswerRepository = options.autoAnswerRepository;
    this.questionSolveService = options.questionSolveService;
    this.automationStore = options.automationStore;
    this.onSnapshotChanged = options.onSnapshotChanged ?? null;
    this.controllerFactory =
      options.controllerFactory ??
      ((input) =>
        new RainClassroomHttpController({
          sessionStore: input.sessionStore,
          traceStore: input.traceStore,
          activeLessonEnterDelayMs: input.activeLessonEnterDelayMs
        }));
  }

  async bootstrap() {
    const accounts = this.accountRepository
      .listWithSessions()
      .filter((account) => account.monitoringEnabled && account.session);
    for (const account of accounts) {
      await this.startForAccount(account.id, 'bootstrap');
    }
  }

  async startForAccount(accountId: number, reason: 'bootstrap' | 'login' | 'refresh' = 'refresh') {
    const account = this.accountRepository.listWithSessions().find((entry) => entry.id === accountId);
    if (!account?.monitoringEnabled || !account?.session) {
      return this.getSnapshot(accountId);
    }

    await this.stopForAccount(accountId);

    const traceStore = new AutoplayDebugTraceStore();
    const logs: AccountMonitorLog[] = [];
    const snapshot: AccountMonitorSnapshot = {
      accountId,
      monitorStatus: 'starting',
      monitorUpdatedAt: new Date().toISOString(),
      monitorLastError: null,
      currentClassroom: null,
      recentLogs: logs
    };
    const sessionStore = new AccountSessionStore(this.accountRepository, accountId);
    const browserController = this.controllerFactory({
      accountId,
      activeLessonEnterDelayMs: account.activeLessonEnterDelayMs,
      sessionStore,
      traceStore
    });
    const autoAnswerService = new AutoAnswerService({
      browserController,
      runtimeRepository: this.runtimeRepository,
      assistRepository: this.assistRepository,
      autoAnswerRepository: this.autoAnswerRepository,
      questionSolveService: this.questionSolveService,
      automationStore: this.automationStore,
      traceStore
    });
    const worker: MonitorWorker = {
      browserController,
      autoplayMonitorService: new AutoplayMonitorService({
        autoAnswerService,
        browserController,
        onLog: (message, type) => this.appendLog(worker, type, message)
      }),
      autoAnswerService,
      traceStore,
      pendingSubmitFailures: new Map(),
      logs,
      nextLogId: 1,
      snapshot
    };

    this.patchTraceStore(worker);
    this.patchBrowserController(worker);
    this.workers.set(accountId, worker);

    try {
      if (reason === 'login') {
        this.appendLog(worker, 'login_success', '登录成功');
      }
      const browserStatus = await browserController.start();
      if (!this.isAuthenticatedHomePage(browserStatus.pageUrl)) {
        this.accountRepository.markLoginFailure(accountId, '会话失效，需重新登录');
        throw new Error('会话失效，需重新登录');
      }
      this.accountRepository.markLoginHealthy(accountId, {
        checkedAt: browserStatus.startedAt ?? new Date().toISOString(),
        currentUrl: browserStatus.pageUrl,
        mode: browserStatus.mode
      });
      this.appendLog(worker, 'home_entered', '成功进入首页');
      await worker.autoplayMonitorService.start();
      worker.snapshot.monitorStatus = 'monitoring';
      worker.snapshot.monitorUpdatedAt = new Date().toISOString();
      worker.snapshot.monitorLastError = null;
      this.notifySnapshotChanged(accountId);
    } catch (error) {
      worker.snapshot.monitorStatus = 'error';
      worker.snapshot.monitorUpdatedAt = new Date().toISOString();
      worker.snapshot.monitorLastError = error instanceof Error ? error.message : 'Unknown account monitor error';
      this.appendLog(worker, 'monitor_error', worker.snapshot.monitorLastError);
      await worker.browserController.stop().catch(() => undefined);
      this.notifySnapshotChanged(accountId);
    }

    return this.getSnapshot(accountId);
  }

  async stopForAccount(accountId: number) {
    const worker = this.workers.get(accountId);
    if (!worker) {
      return;
    }

    await worker.autoplayMonitorService.stop().catch(() => undefined);
    await worker.browserController.stop().catch(() => undefined);
    worker.snapshot.monitorStatus = 'idle';
    worker.snapshot.monitorUpdatedAt = new Date().toISOString();
    worker.snapshot.currentClassroom = null;
    this.workers.delete(accountId);
    this.notifySnapshotChanged(accountId);
  }

  async stopAll() {
    const accountIds = Array.from(this.workers.keys());
    for (const accountId of accountIds) {
      await this.stopForAccount(accountId);
    }
  }

  async setMonitoringEnabled(accountId: number, enabled: boolean) {
    const account = this.accountRepository.setMonitoringEnabled(accountId, enabled);
    if (!account) {
      return null;
    }

    if (enabled) {
      await this.startForAccount(accountId, 'refresh');
    } else {
      await this.stopForAccount(accountId);
    }

    return account;
  }

  async setActiveLessonEnterDelayMs(accountId: number, delayMs: number) {
    const account = this.accountRepository.setActiveLessonEnterDelayMs(accountId, delayMs);
    if (!account) {
      return null;
    }

    if (account.monitoringEnabled && this.workers.has(accountId)) {
      await this.startForAccount(accountId, 'refresh');
    }

    return account;
  }

  async deleteAccount(accountId: number) {
    await this.stopForAccount(accountId);
    this.accountRepository.delete(accountId);
  }

  getSnapshot(accountId: number): AccountMonitorSnapshot {
    const worker = this.workers.get(accountId);
    if (!worker) {
      return {
        accountId,
        monitorStatus: 'idle',
        monitorUpdatedAt: null,
        monitorLastError: null,
        currentClassroom: null,
        recentLogs: []
      };
    }

    return {
      ...worker.snapshot,
      recentLogs: [...worker.logs].reverse()
    };
  }

  listSnapshots(): AccountMonitorSnapshot[] {
    return this.accountRepository.list().map((account) => this.getSnapshot(account.id));
  }

  private appendLog(worker: MonitorWorker, type: string, message: string) {
    const event: AccountMonitorLog = {
      id: worker.nextLogId++,
      at: new Date().toISOString(),
      type,
      message
    };

    worker.logs.push(event);
    if (worker.logs.length > 100) {
      worker.logs.splice(0, worker.logs.length - 100);
    }
    worker.snapshot.monitorUpdatedAt = event.at;
    this.notifySnapshotChanged(worker.snapshot.accountId);
  }

  private patchTraceStore(worker: MonitorWorker) {
    const originalRecord = worker.traceStore.record.bind(worker.traceStore);
    worker.traceStore.record = ((type, message, data = {}) => {
      const event = originalRecord(type, message, data);
      if (type === 'classroom_entered') {
        this.appendLog(worker, type, '成功进入课堂');
      } else if (type === 'classroom_detected') {
        const delayMs = typeof data.delayMs === 'number' ? data.delayMs : null;
        const delaySeconds = delayMs !== null ? Math.max(0, Math.ceil(delayMs / 1000)) : 0;
        this.appendLog(worker, type, delaySeconds > 0 ? `检测到课堂，${delaySeconds}秒后进入课堂` : '检测到课堂，立即进入课堂');
      } else if (type === 'question_collect_failed') {
        const reason = typeof data.reason === 'string' && data.reason.trim() ? data.reason.trim() : '题目提取失败';
        this.appendLog(worker, type, reason);
      } else if (type === 'question_ws_failed') {
        this.appendLog(worker, type, '题目推送连接失败，等待下一次同步');
      } else if (type === 'ai_request_started') {
        this.appendLog(worker, type, '提交AI自动作答');
      } else if (type === 'ai_request_failed') {
        const provider = typeof data.provider === 'string' ? data.provider : null;
        const reason = typeof data.reason === 'string' ? data.reason : message;
        const displayReason = normalizeAiErrorMessage(reason, provider === 'openai' || provider === 'qwen_vl' ? provider : null);
        this.accountRepository.markAccountError(worker.snapshot.accountId, displayReason);
        this.appendLog(worker, type, displayReason || 'AI 调用失败');
      } else if (type === 'ai_response') {
        this.accountRepository.markAccountHealthy(worker.snapshot.accountId, {
          checkedAt: event.at
        });
        this.appendLog(worker, type, '答案成功获取');
      } else if (type === 'submit_payload') {
        this.appendLog(worker, type, '正在提交答案');
      } else if (type === 'submit_result') {
        this.handleSubmitResultLog(worker, type, data);
      }
      return event;
    }) as typeof worker.traceStore.record;
  }

  private patchBrowserController(worker: MonitorWorker) {
    const originalDiscoverLessons = worker.browserController.discoverLessons.bind(worker.browserController);
    const originalNavigateHome =
      typeof worker.browserController.navigateHome === 'function'
        ? worker.browserController.navigateHome.bind(worker.browserController)
        : null;
    worker.browserController.discoverLessons = (async () => {
      const lessons = await originalDiscoverLessons();
      const activeLesson = lessons.find((lesson) => lesson.lessonState === 'in_class');

      worker.snapshot.currentClassroom = activeLesson
        ? {
            lessonId: activeLesson.id,
            classroomId: activeLesson.classroomId ?? null,
            courseTitle: activeLesson.courseTitle,
            classroomTitle: activeLesson.lessonTitle ?? null,
            status: 'in_class',
            detectedAt: new Date().toISOString()
          }
        : null;
      this.notifySnapshotChanged(worker.snapshot.accountId);

      return lessons;
    }) as typeof worker.browserController.discoverLessons;
    if (originalNavigateHome) {
      worker.browserController.navigateHome = (async () => {
        const status = await originalNavigateHome();
        worker.snapshot.currentClassroom = null;
        this.notifySnapshotChanged(worker.snapshot.accountId);
        return status;
      }) as typeof worker.browserController.navigateHome;
    }
  }

  private handleSubmitResultLog(worker: MonitorWorker, type: string, data: Record<string, unknown>) {
    const key =
      (typeof data.attemptId === 'string' && data.attemptId) ||
      (typeof data.exerciseEntryId === 'string' && data.exerciseEntryId) ||
      null;
    const ok = Boolean(data.ok);

    if (!key) {
      this.appendLog(worker, type, ok ? '答案提交成功' : '答案提交失败');
      return;
    }

    if (ok) {
      worker.pendingSubmitFailures.delete(key);
      const message = typeof data.message === 'string' ? data.message : null;
      this.appendLog(
        worker,
        type,
        message === 'LOCAL_ALREADY_COMPLETED' || message === 'RUNTIME_ALREADY_COMPLETED'
          ? '重复题目'
          : '答案提交成功'
      );
      return;
    }

    if (worker.pendingSubmitFailures.has(key)) {
      worker.pendingSubmitFailures.delete(key);
      this.appendLog(worker, type, '答案提交失败');
      return;
    }

    worker.pendingSubmitFailures.set(key, true);
  }

  private isAuthenticatedHomePage(pageUrl: string | null) {
    return isRainClassroomHomePageUrl(pageUrl);
  }

  private notifySnapshotChanged(accountId: number) {
    this.onSnapshotChanged?.(accountId);
  }
}
