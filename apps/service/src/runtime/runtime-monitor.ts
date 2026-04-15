import type { AutomationStore } from '../automation/automation-store.js';
import type { BrowserController } from '../browser/browser-controller.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import type { RuntimeMonitorStatus, RuntimeStatus } from './runtime-types.js';
import { extractQuestionsFromHtml } from './question-extractor.js';
import { probeRuntimeStatus } from './runtime-probe.js';

const HOME_PAGE_URL = 'https://www.yuketang.cn/v2/web/index';

type RuntimeMonitorOptions = {
  browserController: BrowserController;
  runtimeRepository: RuntimeRepository;
  automationStore: AutomationStore;
  intervalMs?: number;
};

export class RuntimeMonitor {
  private readonly browserController: BrowserController;
  private readonly runtimeRepository: RuntimeRepository;
  private readonly automationStore: AutomationStore;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private status: RuntimeMonitorStatus = {
    enabled: false,
    phase: 'idle',
    currentCourse: null,
    currentLessonId: null,
    lastCheckedAt: null,
    lastTransitionAt: null,
    lastError: null
  };

  constructor(options: RuntimeMonitorOptions) {
    this.browserController = options.browserController;
    this.runtimeRepository = options.runtimeRepository;
    this.automationStore = options.automationStore;
    this.intervalMs = options.intervalMs ?? 10000;
  }

  getStatus(): RuntimeMonitorStatus {
    return { ...this.status };
  }

  async start(): Promise<RuntimeMonitorStatus> {
    if (this.status.enabled) {
      return this.getStatus();
    }

    this.status = {
      ...this.status,
      enabled: true,
      phase: 'home_polling',
      lastTransitionAt: new Date().toISOString(),
      lastError: null
    };

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    await this.tick();
    return this.getStatus();
  }

  async stop(): Promise<RuntimeMonitorStatus> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.ticking = false;
    this.status = {
      ...this.status,
      enabled: false,
      phase: 'idle',
      currentCourse: null,
      currentLessonId: null,
      lastTransitionAt: new Date().toISOString(),
      lastError: null
    };
    return this.getStatus();
  }

  private async tick() {
    if (!this.status.enabled || this.ticking) {
      return;
    }

    this.ticking = true;
    const now = new Date().toISOString();

    try {
      const current = await this.readCurrentPage();
      if (current.status.lessonState === 'in_class') {
        await this.scanCurrentPage();
        this.status = {
          ...this.status,
          phase: 'class_monitoring',
          currentCourse: current.status.courseTitle,
          currentLessonId: this.status.currentLessonId,
          lastCheckedAt: now,
          lastError: null
        };
        return;
      }

      if (current.status.lessonState === 'ended') {
        this.status = {
          ...this.status,
          phase: 'returning_home',
          lastCheckedAt: now,
          lastTransitionAt: now,
          lastError: null
        };
        await this.browserController.navigateHome();
      } else if (current.status.currentUrl && current.status.currentUrl !== HOME_PAGE_URL) {
        await this.browserController.navigateHome();
      }

      const lessons = await this.browserController.discoverLessons();
      const activeLesson = lessons.find((lesson) => lesson.lessonState === 'in_class');

      if (!activeLesson?.href) {
        this.status = {
          ...this.status,
          phase: 'home_polling',
          currentCourse: null,
          currentLessonId: null,
          lastCheckedAt: now,
          lastTransitionAt: now,
          lastError: null
        };
        return;
      }

      await this.browserController.navigate(activeLesson.href);
      const next = await this.scanCurrentPage();

      this.status = {
        ...this.status,
        phase: next.status.lessonState === 'ended' ? 'returning_home' : 'class_monitoring',
        currentCourse: activeLesson.courseTitle,
        currentLessonId: activeLesson.id,
        lastCheckedAt: now,
        lastTransitionAt: now,
        lastError: null
      };

      if (next.status.lessonState === 'ended') {
        await this.browserController.navigateHome();
        this.status = {
          ...this.status,
          phase: 'home_polling',
          currentCourse: null,
          currentLessonId: null,
          lastTransitionAt: new Date().toISOString()
        };
      }
    } catch (error) {
      this.status = {
        ...this.status,
        phase: 'error_backoff',
        lastCheckedAt: now,
        lastTransitionAt: now,
        lastError: error instanceof Error ? error.message : 'Unknown runtime monitor error'
      };
    } finally {
      this.ticking = false;
    }
  }

  private async scanCurrentPage(): Promise<{
    status: RuntimeStatus;
    questions: ReturnType<RuntimeRepository['listQuestions']>;
    currentQuestion: ReturnType<RuntimeRepository['getCurrentQuestion']>;
  }> {
    return this.automationStore.executeTask('runtime_scan', 'Scan current lesson page', async () => {
      const snapshot = await this.browserController.inspectPage();
      const status = probeRuntimeStatus(snapshot);
      const questions = extractQuestionsFromHtml(snapshot.html ?? '', status.courseTitle, snapshot.text ?? null);
      this.runtimeRepository.saveSnapshot(status, questions);
      return {
        status,
        questions: this.runtimeRepository.listQuestions(),
        currentQuestion: this.runtimeRepository.getCurrentQuestion()
      };
    });
  }

  private async readCurrentPage(): Promise<{ status: RuntimeStatus }> {
    const snapshot = await this.browserController.inspectPage();
    return {
      status: probeRuntimeStatus(snapshot)
    };
  }
}
