import type { AutoAnswerService } from './auto-answer-service.js';
import type { BrowserController, DetectedClassroomEvent, DetectedQuestionEvent, ExerciseEntry } from '../browser/browser-controller.js';
import { buildDetectedQuestionEvent } from '../browser/question-runtime.js';
import { isRainClassroomHomePageUrl } from '../browser/rain-classroom-platforms.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';

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
const PUSHED_QUESTION_CONFIRM_RETRY_COUNT = 5;
const PUSHED_QUESTION_CONFIRM_RETRY_DELAY_MS = 100;

const latestRuntimeStateFromEntries = (entries: ExerciseEntry[]) =>
  [...entries]
    .reverse()
    .map((entry) => entry.runtimeState ?? null)
    .find((runtimeState) => runtimeState && !runtimeState.isComplete) ?? null;

const parseLessonIdFromUrl = (url: string | null) => url?.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/)?.[1] ?? null;

export class AutoplayMonitorService {
  private readonly autoAnswerService: AutoAnswerService;
  private readonly browserController: BrowserController;
  private readonly intervalMs: number;
  private readonly onLog: ((message: string, type: string) => void | Promise<void>) | null;
  private readonly processedEventKeys = new Set<string>();
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
    await this.handleInitialQuestion();
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
      if (!this.browserController.supportsPushedQuestionDetection?.()) {
        const polledEvent = await this.readLatestDetectedQuestion().catch(() => null);
        if (polledEvent) {
          await this.handleDetectedQuestion(polledEvent);
        }
      }
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

    const snapshot = await this.browserController.inspectPage().catch(() => null);
    const currentLessonId = parseLessonIdFromUrl(snapshot?.currentUrl ?? null);
    const activeLesson = (await this.browserController.discoverLessons()).find((lesson) => lesson.lessonState === 'in_class' && lesson.href);

    if (activeLesson?.id) {
      this.currentLessonId = activeLesson.id;
    }

    if (snapshot) {
      const runtimeStatus = probeRuntimeStatus(snapshot);
      if (runtimeStatus.lessonState === 'ended') {
        this.resetMonitoringCycle();
        await this.onLog?.('下课了', 'lesson_ended');
        await this.browserController.navigateHome();
        await this.onLog?.('成功回到首页', 'returned_home');
        return;
      }

      if (runtimeStatus.lessonState === 'in_class') {
        return;
      }

      if (
        runtimeStatus.currentUrl &&
        !isRainClassroomHomePageUrl(runtimeStatus.currentUrl) &&
        /\/lesson\/fullscreen\/v3\//.test(runtimeStatus.currentUrl) &&
        (!currentLessonId || currentLessonId !== activeLesson?.id)
      ) {
        this.resetMonitoringCycle();
        await this.browserController.navigateHome();
        await this.onLog?.('成功回到首页', 'returned_home');
      }
    }

    if (!activeLesson?.href) {
      if (isRainClassroomHomePageUrl(snapshot?.currentUrl)) {
        this.resetMonitoringCycle();
      }
      return;
    }

    if (currentLessonId && currentLessonId === activeLesson.id) {
      return;
    }

    if (this.browserController.supportsDeferredActiveLessonEntry?.()) {
      return;
    }

    await this.browserController.navigate(activeLesson.href);
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
      this.currentLessonId = event.lessonId;
      return;
    }

    if (this.currentLessonId && event.lessonId !== this.currentLessonId) {
      return;
    }

    this.currentLessonId = null;
    this.resetMonitoringCycle();
    await this.browserController.navigateHome().catch(() => undefined);
    await this.onLog?.('课堂已结束，已返回首页', 'classroom_left');
  }

  private async handleInitialQuestion() {
    const initialEvent = await this.readLatestDetectedQuestion();
    if (initialEvent) {
      await this.handleDetectedQuestion(initialEvent);
    }
  }

  private async handleDetectedQuestion(event: DetectedQuestionEvent) {
    if (!this.status.enabled) {
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
      return;
    }

    const confirmedEvent = await this.confirmDetectedQuestion(event);
    if (!confirmedEvent) {
      return;
    }

    this.processedEventKeys.add(eventKey);
    const started = await this.autoAnswerService.start();
    this.status = {
      ...this.status,
      lastTriggeredRunId: started.runId,
      lastError: null
    };
  }

  private async confirmDetectedQuestion(event: DetectedQuestionEvent) {
    const eventKey = buildEventKey(event);

    for (let attempt = 0; attempt < PUSHED_QUESTION_CONFIRM_RETRY_COUNT; attempt += 1) {
      const confirmedEvent = await this.readLatestDetectedQuestion();
      if (confirmedEvent && buildEventKey(confirmedEvent) === eventKey) {
        return confirmedEvent;
      }

      if (attempt < PUSHED_QUESTION_CONFIRM_RETRY_COUNT - 1) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, PUSHED_QUESTION_CONFIRM_RETRY_DELAY_MS);
        });
      }
    }

    return null;
  }

  private async readLatestDetectedQuestion() {
    const latestListedQuestion = latestRuntimeStateFromEntries(await this.browserController.listExerciseEntries().catch(() => []));
    const currentRuntimeState = await this.browserController.readExerciseRuntimeState().catch(() => null);
    return buildDetectedQuestionEvent(latestListedQuestion ?? currentRuntimeState);
  }

  private resetMonitoringCycle() {
    this.processedEventKeys.clear();
    this.status = {
      ...this.status,
      lastEventAt: null,
      lastEventKey: null,
      lastTriggeredRunId: null,
      lastError: null
    };
  }
}
