import type { AutoAnswerService } from './auto-answer-service.js';
import type { BrowserController, DetectedClassroomEvent, DetectedQuestionEvent } from '../browser/browser-controller.js';

export type AutoplayMonitorStatus = {
  enabled: boolean;
  lastStartedAt: string | null;
  lastEventAt: string | null;
  lastEventKey: string | null;
  lastTriggeredRunId: string | null;
  lastError: string | null;
};

type AutoplayMonitorServiceOptions = {
  autoAnswerService: AutoAnswerService;
  browserController: BrowserController;
  intervalMs?: number;
  onLog?: (message: string, type: string) => void | Promise<void>;
};

const createIdleStatus = (): AutoplayMonitorStatus => ({
  enabled: false,
  lastStartedAt: null,
  lastEventAt: null,
  lastEventKey: null,
  lastTriggeredRunId: null,
  lastError: null
});

const buildEventKey = (event: Pick<DetectedQuestionEvent, 'lessonId' | 'problemId'>) => `${event.lessonId}:${event.problemId}`;

export class AutoplayMonitorService {
  private readonly autoAnswerService: AutoAnswerService;
  private readonly browserController: BrowserController;
  private readonly intervalMs: number;
  private readonly onLog: ((message: string, type: string) => void | Promise<void>) | null;
  private readonly processedEventKeys = new Set<string>();
  private readonly queuedQuestionEvents: DetectedQuestionEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private currentLessonId: string | null = null;
  private status: AutoplayMonitorStatus = createIdleStatus();

  constructor(options: AutoplayMonitorServiceOptions) {
    this.autoAnswerService = options.autoAnswerService;
    this.browserController = options.browserController;
    this.intervalMs = options.intervalMs ?? 3000;
    this.onLog = options.onLog ?? null;
  }

  getStatus(): AutoplayMonitorStatus {
    return { ...this.status };
  }

  async start(): Promise<AutoplayMonitorStatus> {
    if (this.status.enabled) {
      return this.getStatus();
    }

    this.processedEventKeys.clear();
    this.queuedQuestionEvents.length = 0;
    this.status = {
      enabled: true,
      lastStartedAt: new Date().toISOString(),
      lastEventAt: null,
      lastEventKey: null,
      lastTriggeredRunId: null,
      lastError: null
    };

    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);

    const startClassroomDetection = (
      this.browserController as Partial<Pick<BrowserController, 'startClassroomDetection'>>
    ).startClassroomDetection;
    if (typeof startClassroomDetection === 'function') {
      await startClassroomDetection.call(this.browserController, async (event) => {
        await this.handleDetectedClassroom(event);
      });
    }

    await this.browserController.startQuestionDetection(async (event) => {
      await this.handleDetectedQuestion(event);
    });
    await this.tick();
    return this.getStatus();
  }

  async stop(): Promise<AutoplayMonitorStatus> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    const stopQuestionDetection = (
      this.browserController as Partial<Pick<BrowserController, 'stopQuestionDetection'>>
    ).stopQuestionDetection;
    const stopClassroomDetection = (
      this.browserController as Partial<Pick<BrowserController, 'stopClassroomDetection'>>
    ).stopClassroomDetection;

    if (typeof stopQuestionDetection === 'function') {
      await stopQuestionDetection.call(this.browserController).catch(() => undefined);
    }
    if (typeof stopClassroomDetection === 'function') {
      await stopClassroomDetection.call(this.browserController).catch(() => undefined);
    }

    this.ticking = false;
    this.currentLessonId = null;
    this.processedEventKeys.clear();
    this.queuedQuestionEvents.length = 0;
    this.status = {
      ...this.status,
      enabled: false
    };
    return this.getStatus();
  }

  private async tick() {
    if (!this.status.enabled || this.ticking) {
      return;
    }

    this.ticking = true;
    try {
      await this.ensureAutoplayContext();
      await this.flushQueuedQuestionEvent();
      if (this.status.lastError) {
        this.status = {
          ...this.status,
          lastError: null
        };
      }
    } catch (error) {
      this.status = {
        ...this.status,
        lastError: error instanceof Error ? error.message : 'Unknown autoplay monitor error'
      };
    } finally {
      this.ticking = false;
    }
  }

  private async ensureAutoplayContext() {
    const session = await this.browserController.getSessionState();
    if (!session.hasSession) {
      return;
    }

    if (this.currentLessonId && this.browserController.supportsPushedQuestionDetection?.()) {
      return;
    }

    const activeLesson = (await this.browserController.discoverLessons()).find((lesson) => lesson.lessonState === 'in_class' && lesson.href);

    if (!activeLesson?.href) {
      this.resetMonitoringCycle();
      return;
    }

    if (this.currentLessonId === activeLesson.id) {
      return;
    }

    if (this.browserController.supportsDeferredActiveLessonEntry?.()) {
      return;
    }

    await this.browserController.navigate(activeLesson.href);
    this.currentLessonId = activeLesson.id;
    await this.onLog?.('成功进入课堂', 'classroom_entered');
  }

  private async handleDetectedClassroom(event: DetectedClassroomEvent) {
    if (!this.status.enabled) {
      return;
    }

    this.status = {
      ...this.status,
      lastEventAt: event.detectedAt,
      lastEventKey: `classroom:${event.eventType}:${event.lessonId}`,
      lastError: null
    };

    if (event.eventType === 'lesson_started') {
      if (this.currentLessonId !== event.lessonId) {
        await this.onLog?.('成功进入课堂', 'classroom_entered');
      }
      this.currentLessonId = event.lessonId;
      return;
    }

    if (this.currentLessonId && event.lessonId !== this.currentLessonId) {
      return;
    }

    this.currentLessonId = null;
    this.resetMonitoringCycle();
    await this.onLog?.('下课了', 'lesson_ended');
    await this.browserController.navigateHome().catch(() => undefined);
    await this.onLog?.('课堂已结束，已返回首页', 'classroom_left');
  }

  private async handleDetectedQuestion(event: DetectedQuestionEvent) {
    if (!this.status.enabled || event.isComplete) {
      return;
    }

    const eventKey = buildEventKey(event);
    this.status = {
      ...this.status,
      lastEventAt: event.detectedAt,
      lastEventKey: eventKey,
      lastError: null
    };

    if (this.processedEventKeys.has(eventKey)) {
      return;
    }

    await this.onLog?.('检测到题目', 'question_detected');

    if (this.autoAnswerService.getStatus().status === 'running') {
      this.queueQuestionEvent(event);
      return;
    }

    this.processedEventKeys.add(eventKey);
    const started = await this.autoAnswerService.start({
      preferredQuestion: event
    });
    this.status = {
      ...this.status,
      lastTriggeredRunId: started.runId,
      lastError: null
    };
  }

  private resetMonitoringCycle() {
    this.processedEventKeys.clear();
    this.queuedQuestionEvents.length = 0;
    this.status = {
      ...this.status,
      lastEventAt: null,
      lastEventKey: null,
      lastTriggeredRunId: null,
      lastError: null
    };
  }

  private queueQuestionEvent(event: DetectedQuestionEvent) {
    const eventKey = buildEventKey(event);
    if (
      this.processedEventKeys.has(eventKey) ||
      this.queuedQuestionEvents.some((queuedEvent) => buildEventKey(queuedEvent) === eventKey)
    ) {
      return;
    }

    this.queuedQuestionEvents.push(event);
  }

  private async flushQueuedQuestionEvent() {
    if (this.autoAnswerService.getStatus().status === 'running' || this.queuedQuestionEvents.length === 0) {
      return;
    }

    const queuedEvent = this.queuedQuestionEvents.shift();
    if (!queuedEvent) {
      return;
    }

    const eventKey = buildEventKey(queuedEvent);
    if (this.processedEventKeys.has(eventKey)) {
      return;
    }

    this.processedEventKeys.add(eventKey);
    const started = await this.autoAnswerService.start({
      preferredQuestion: queuedEvent
    });
    this.status = {
      ...this.status,
      lastTriggeredRunId: started.runId,
      lastError: null
    };
  }
}
