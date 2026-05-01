import WebSocket from 'ws';
import type {
  BrowserController,
  BrowserDebugState,
  BrowserStatus,
  DetectedClassroomEvent,
  DetectedQuestionEvent,
  ExerciseEntry,
  ExerciseRuntimeState,
  LessonCandidate,
  LessonPresentationSlide,
  LessonPresentationSlideList,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult,
  PageSnapshot,
  ScreenshotPayload,
  SessionState
} from './browser-controller.js';
import type { StoredSession } from './session-store.js';
import { buildDetectedQuestionEvent, buildRuntimeStateFromPresentationSlide, parseLessonTarget, parseOptionalNumber, parseOptionalString } from './question-runtime.js';
import { buildRainClassroomHomeUrl, getRainClassroomPlatform, resolveRainClassroomPlatformByOrigin, resolveRainClassroomPlatformByUrl } from './rain-classroom-platforms.js';
import { buildCookieHeader, extractCookieValue, RainClassroomHttpClient } from './rain-classroom-http-client.js';
import type { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';

type SessionStoreLike = Pick<{ load(): Promise<StoredSession | null>; save(session: StoredSession): Promise<StoredSession> }, 'load' | 'save'>;

type RainClassroomHttpControllerOptions = {
  sessionStore: SessionStoreLike;
  fetchFn?: typeof fetch;
  createQuestionWebSocket?: (url: string, options: { headers: Record<string, string> }) => Pick<WebSocket, 'on' | 'send' | 'close'>;
  traceStore?: Pick<AutoplayDebugTraceStore, 'record'>;
  activeLessonEnterDelayMs?: number;
};

type TimelineProblemEvent = {
  type?: string;
  pres?: string;
  prob?: string;
  si?: number | string;
};

type TimelinePayload = {
  op?: string;
  lessonid?: string;
  timeline?: unknown[];
  presentation?: string;
  slideindex?: number | string;
  slideid?: string;
  unlockedproblem?: unknown[];
};

const createIdleStatus = (): BrowserStatus => ({
  status: 'idle',
  engine: 'http',
  mode: null,
  startedAt: null,
  pageUrl: null,
  lastError: null
});

const safeJson = async (response: Response) => response.json().catch(() => null);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeEnterDelayMs = (value: number | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(300_000, Math.max(0, Math.floor(value))) : 0;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const getPresentationItems = (payload: unknown) => {
  const data = isObject(payload) && isObject(payload.data) ? payload.data : null;
  const collection = data?.presentations ?? data?.slides ?? data?.list ?? [];
  return Array.isArray(collection) ? collection : [];
};

const findLatestProblemEvent = (timeline: unknown[]) =>
  [...timeline]
    .reverse()
    .find((event): event is TimelineProblemEvent => isObject(event) && event.type === 'problem' && Boolean(event.pres || event.prob)) ?? null;

export class RainClassroomHttpController implements BrowserController {
  private readonly sessionStore: SessionStoreLike;
  private readonly fetchFn: typeof fetch;
  private readonly createQuestionWebSocket: NonNullable<RainClassroomHttpControllerOptions['createQuestionWebSocket']>;
  private readonly traceStore: Pick<AutoplayDebugTraceStore, 'record'> | null;
  private readonly activeLessonEnterDelayMs: number;
  private status: BrowserStatus = createIdleStatus();
  private session: StoredSession | null = null;
  private client: RainClassroomHttpClient | null = null;
  private currentLessonId: string | null = null;
  private currentPresentationId: string | null = null;
  private currentSlideIndex: number | null = null;
  private currentTimeline: unknown[] = [];
  private questionSocket: Pick<WebSocket, 'on' | 'send' | 'close'> | null = null;
  private questionDetectionEnabled = false;
  private onQuestionDetected: ((event: DetectedQuestionEvent) => void | Promise<void>) | null = null;
  private lastDetectedQuestionKey: string | null = null;
  private classroomDetectionEnabled = false;
  private onClassroomDetected: ((event: DetectedClassroomEvent) => void | Promise<void>) | null = null;
  private detectedClassroomLessonId: string | null = null;
  private pendingClassroomEntryLessonId: string | null = null;
  private lastDetectedClassroomKey: string | null = null;
  private readonly emittedTraceKeys = new Set<string>();

  constructor(options: RainClassroomHttpControllerOptions) {
    this.sessionStore = options.sessionStore;
    this.fetchFn = options.fetchFn ?? fetch;
    this.traceStore = options.traceStore ?? null;
    this.activeLessonEnterDelayMs = normalizeEnterDelayMs(options.activeLessonEnterDelayMs);
    this.createQuestionWebSocket =
      options.createQuestionWebSocket ??
      ((url, socketOptions) => new WebSocket(url, socketOptions));
  }

  getStatus(): BrowserStatus {
    return { ...this.status };
  }

  supportsDeferredActiveLessonEntry(): boolean {
    return true;
  }

  supportsPushedQuestionDetection(): boolean {
    return true;
  }

  async start(): Promise<BrowserStatus> {
    if (this.status.status === 'running' || this.status.status === 'starting') {
      return this.getStatus();
    }

    this.status = { ...this.status, status: 'starting', lastError: null };
    try {
      this.session = await this.sessionStore.load();
      if (!this.session?.cookies.length) {
        throw new Error('No saved session available');
      }
      this.client = new RainClassroomHttpClient({
        originUrl: this.resolveOriginUrl(),
        cookies: this.session.cookies,
        fetchFn: this.fetchFn
      });
      const homeUrl = buildRainClassroomHomeUrl(this.session.origin);
      this.status = {
        status: 'running',
        engine: 'http',
        mode: 'http',
        startedAt: new Date().toISOString(),
        pageUrl: homeUrl,
        lastError: null
      };
      await this.discoverLessons().catch(() => []);
    } catch (error) {
      this.status = {
        status: 'error',
        engine: 'http',
        mode: null,
        startedAt: null,
        pageUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown HTTP controller startup error'
      };
    }

    return this.getStatus();
  }

  async stop(): Promise<BrowserStatus> {
    this.stopQuestionSocket();
    this.questionDetectionEnabled = false;
    this.onQuestionDetected = null;
    this.classroomDetectionEnabled = false;
    this.onClassroomDetected = null;
    this.currentLessonId = null;
    this.detectedClassroomLessonId = null;
    this.pendingClassroomEntryLessonId = null;
    this.lastDetectedClassroomKey = null;
    this.emittedTraceKeys.clear();
    this.currentPresentationId = null;
    this.currentSlideIndex = null;
    this.currentTimeline = [];
    this.status = createIdleStatus();
    return this.getStatus();
  }

  async getSessionState(): Promise<SessionState> {
    const stored = this.session ?? (await this.sessionStore.load());
    return {
      hasSession: Boolean(stored?.cookies.length),
      savedAt: stored?.savedAt ?? null,
      origin: stored?.origin ?? null,
      cookieCount: stored?.cookies.length ?? 0,
      currentUrl: this.status.pageUrl,
      pageTitle: null,
      mode: this.status.mode
    };
  }

  async saveSession(): Promise<SessionState> {
    return this.getSessionState();
  }

  async navigateHome(): Promise<BrowserStatus> {
    this.stopQuestionSocket();
    this.currentLessonId = null;
    this.currentPresentationId = null;
    this.currentSlideIndex = null;
    this.status = {
      ...this.status,
      pageUrl: buildRainClassroomHomeUrl(this.session?.origin ?? null)
    };
    return this.getStatus();
  }

  async navigate(url: string): Promise<BrowserStatus> {
    const lessonId = parseLessonTarget(url).lessonId;
    if (lessonId) {
      await this.prepareLesson(lessonId);
    }
    this.status = { ...this.status, pageUrl: url };
    return this.getStatus();
  }

  async discoverLessons(): Promise<LessonCandidate[]> {
    await this.ensureStarted();
    const payload = await this.requestJson('/api/v3/classroom/on-lesson-upcoming-exam', {
      referer: buildRainClassroomHomeUrl(this.session?.origin ?? null)
    });
    const lessons = Array.isArray(payload?.data?.onLessonClassrooms) ? payload.data.onLessonClassrooms : [];
    const candidates = lessons
      .filter((lesson: { lessonId?: string }) => lesson.lessonId)
      .map((lesson: { classroomId?: string; classroomName?: string; courseName?: string; lessonId: string }) => ({
        id: lesson.lessonId,
        classroomId: lesson.classroomId ?? null,
        courseTitle: lesson.courseName ?? lesson.classroomName ?? '未命名课程',
        lessonTitle: lesson.classroomName ?? lesson.courseName ?? null,
        lessonState: 'in_class',
        href: `${this.resolveOriginUrl()}/lesson/fullscreen/v3/${lesson.lessonId}`
      } satisfies LessonCandidate));
    await this.syncClassroomState(candidates);
    return candidates;
  }

  async listExerciseEntries(): Promise<ExerciseEntry[]> {
    if (!this.currentLessonId) {
      const activeLesson = (await this.discoverLessons()).find((lesson) => lesson.lessonState === 'in_class');
      if (!activeLesson) {
        return [];
      }
      await this.prepareLesson(activeLesson.id);
    }

    const lessonId = this.currentLessonId;
    if (!lessonId) {
      return [];
    }

    const slides = await this.listLessonPresentationSlides(lessonId);
    return slides.flatMap((slide, index) => {
      const runtimeState = buildRuntimeStateFromPresentationSlide(lessonId, slide, index);
      if (!runtimeState) {
        return [];
      }
      return [
        {
          entryId: `presentation-${runtimeState.exerciseIndex}`,
          lessonId,
          status: runtimeState.isComplete ? 'answered' : 'unanswered',
          isActive:
            this.currentSlideIndex !== null &&
            (this.currentSlideIndex === runtimeState.pageIndex || String(this.currentSlideIndex) === runtimeState.exerciseIndex),
          pageHint: runtimeState.pageIndex !== null ? `第${runtimeState.pageIndex}页` : null,
          remainingHint: null,
          thumbnailUrl: runtimeState.imageThumbnailUrl,
          exerciseUrl: `${this.resolveOriginUrl()}${runtimeState.routePath}`,
          runtimeState
        } satisfies ExerciseEntry
      ];
    });
  }

  async listLessonPresentationSlides(lessonId: string, preferredPresentationId: string | null = null): Promise<LessonPresentationSlideList> {
    await this.prepareLesson(lessonId);
    const presentationId = preferredPresentationId ?? this.currentPresentationId;
    if (!presentationId || !this.client) {
      return [];
    }

    const payload = await this.client.fetchPresentation(presentationId);
    const slides = getPresentationItems(payload).map((item) => this.toPresentationSlide(lessonId, item));
    this.recordTraceOnce('presentation_fetch', `${lessonId}:${presentationId}:${slides.length}`, 'Presentation fetch succeeded', {
      lessonId,
      presentationId,
      slideCount: slides.length
    });
    return slides;
  }

  async readCurrentQuestionPresentationSlide(
    lessonId: string,
    input?: { problemId?: string | null; presentationId?: string | null }
  ): Promise<LessonPresentationSlide> {
    const slides = await this.listLessonPresentationSlides(lessonId, input?.presentationId ?? null);
    if (input?.problemId) {
      return slides.find((slide) => slide.problemId === input.problemId) ?? null;
    }

    const latestProblem = findLatestProblemEvent(this.currentTimeline);
    const targetProblemId = parseOptionalString(latestProblem?.prob);
    if (targetProblemId) {
      return slides.find((slide) => slide.problemId === targetProblemId) ?? null;
    }

    if (this.currentSlideIndex !== null) {
      return slides.find((slide) => slide.pageIndex === this.currentSlideIndex || slide.exerciseIndex === String(this.currentSlideIndex)) ?? null;
    }

    return [...slides].reverse().find((slide) => slide.problemId && slide.problemType) ?? null;
  }

  async openCurrentExercise(): Promise<string | null> {
    if (!this.currentLessonId) {
      return null;
    }

    const slide = await this.readCurrentQuestionPresentationSlide(this.currentLessonId);
    if (!slide) {
      return null;
    }

    const runtimeState = buildRuntimeStateFromPresentationSlide(this.currentLessonId, slide, slide.pageIndex ?? 0);
    return runtimeState?.routePath ? `${this.resolveOriginUrl()}${runtimeState.routePath}` : null;
  }

  async inspectPage(): Promise<PageSnapshot> {
    return {
      currentUrl: this.status.pageUrl,
      pageTitle: null,
      html: null,
      text: null
    };
  }

  async getDebugState(): Promise<BrowserDebugState> {
    return {
      snapshot: await this.inspectPage(),
      network: [],
      runtime: {
        hasVue: false,
        routeName: null,
        routePath: null,
        storeStateKeys: [],
        interestingState: {
          lessonId: this.currentLessonId,
          presentationId: this.currentPresentationId,
          slideIndex: this.currentSlideIndex,
          timelineCount: this.currentTimeline.length
        }
      }
    };
  }

  async captureScreenshot(): Promise<ScreenshotPayload> {
    return null;
  }

  async ensureExercisePageReady(url: string): Promise<ExerciseRuntimeState> {
    const target = parseLessonTarget(url);
    if (!target.lessonId) {
      throw new Error(`Invalid exercise URL: ${url}`);
    }
    await this.prepareLesson(target.lessonId);
    const slide = await this.readCurrentQuestionPresentationSlide(target.lessonId);
    const runtimeState = slide ? buildRuntimeStateFromPresentationSlide(target.lessonId, slide, slide.pageIndex ?? 0) : null;
    if (!runtimeState) {
      throw new Error(`Exercise runtime state was not available for ${url}`);
    }
    return runtimeState;
  }

  async readExerciseRuntimeState(): Promise<ExerciseRuntimeState | null> {
    if (!this.currentLessonId) {
      return null;
    }
    const slide = await this.readCurrentQuestionPresentationSlide(this.currentLessonId);
    return slide ? buildRuntimeStateFromPresentationSlide(this.currentLessonId, slide, slide.pageIndex ?? 0) : null;
  }

  async startQuestionDetection(onEvent: (event: DetectedQuestionEvent) => void | Promise<void>): Promise<void> {
    this.questionDetectionEnabled = true;
    this.onQuestionDetected = onEvent;
    const activeLesson = (await this.discoverLessons()).find((lesson) => lesson.lessonState === 'in_class');
    if (!activeLesson) {
      return;
    }
    await this.prepareLesson(activeLesson.id);
    await this.dispatchCurrentQuestion();
    await this.startQuestionSocket(activeLesson.id);
  }

  async stopQuestionDetection(): Promise<void> {
    this.questionDetectionEnabled = false;
    this.onQuestionDetected = null;
    this.lastDetectedQuestionKey = null;
    this.stopQuestionSocket();
  }

  async startClassroomDetection(onEvent: (event: DetectedClassroomEvent) => void | Promise<void>): Promise<void> {
    this.classroomDetectionEnabled = true;
    this.onClassroomDetected = onEvent;
    await this.discoverLessons().catch(() => []);
  }

  async stopClassroomDetection(): Promise<void> {
    this.classroomDetectionEnabled = false;
    this.onClassroomDetected = null;
    this.detectedClassroomLessonId = null;
    this.pendingClassroomEntryLessonId = null;
    this.lastDetectedClassroomKey = null;
  }

  async submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult> {
    if (!this.client || !this.currentLessonId) {
      throw new Error('Lesson checkin is required before submitting answers');
    }
    return this.client.submitProblem(payload, `${this.resolveOriginUrl()}/lesson/fullscreen/v3/${this.currentLessonId}`);
  }

  private async prepareLesson(lessonId: string) {
    await this.ensureStarted();
    if (!this.client) {
      throw new Error('HTTP client is not available');
    }
    const checkin = await this.client.checkInLesson(lessonId);
    this.recordTraceOnce('lesson_checkin', `${lessonId}:${Boolean(checkin.authorization)}:${Boolean(checkin.lessonToken)}`, checkin.authorization ? 'Lesson checkin succeeded' : 'Lesson checkin missing set-auth', {
      lessonId,
      ok: Boolean(checkin.authorization),
      hasAuthorization: Boolean(checkin.authorization),
      hasLessonToken: Boolean(checkin.lessonToken)
    });
    if (!checkin.authorization) {
      throw new Error('Lesson checkin did not return set-auth');
    }
    this.currentLessonId = lessonId;
    this.status = {
      ...this.status,
      pageUrl: `${this.resolveOriginUrl()}/lesson/fullscreen/v3/${lessonId}`
    };
    await this.refreshTimeline(lessonId).catch(() => undefined);
  }

  private async refreshTimeline(lessonId: string) {
    const timeline = await this.fetchTimeline(lessonId);
    if (!timeline) {
      this.recordTraceOnce('timeline_fetch', `${lessonId}:failed`, 'Timeline fetch failed', {
        lessonId,
        ok: false
      });
      return;
    }
    this.applyTimelinePayload(timeline);
    this.recordTraceOnce('timeline_fetch', `${lessonId}:${this.currentPresentationId}:${this.currentSlideIndex}:${this.currentTimeline.length}`, 'Timeline fetch succeeded', {
      lessonId,
      ok: true,
      timelineCount: this.currentTimeline.length,
      presentationId: this.currentPresentationId,
      slideIndex: this.currentSlideIndex
    });
  }

  private async fetchTimeline(lessonId: string) {
    const session = await this.getActiveSession();
    const platform = resolveRainClassroomPlatformByOrigin(session.origin) ?? getRainClassroomPlatform('rain-classroom');
    const lessonToken = await this.getLessonToken(lessonId);
    const userId = await this.getUserId();
    if (!lessonToken || !userId) {
      return null;
    }

    return new Promise<TimelinePayload | null>((resolve) => {
      const socket = this.createQuestionWebSocket(platform.wsUrl, {
        headers: {
          Cookie: buildCookieHeader(session.cookies),
          Origin: platform.originUrl,
          Referer: `${platform.originUrl}/lesson/fullscreen/v3/${lessonId}`,
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36'
        }
      });
      const timeout = setTimeout(() => {
        socket.close();
        resolve(null);
      }, 8000);
      let msgid = 1;
      socket.on('open', () => {
        socket.send(JSON.stringify({ op: 'hello', userid: userId, role: 'student', auth: lessonToken, lessonid: lessonId }));
      });
      socket.on('message', (data: unknown) => {
        const payload = this.parseSocketPayload(data);
        if (payload?.op === 'hello') {
          this.applyTimelinePayload(payload);
          socket.send(JSON.stringify({ op: 'fetchtimeline', lessonid: lessonId, msgid: msgid++ }));
          return;
        }
        if (payload?.op === 'fetchtimeline') {
          clearTimeout(timeout);
          socket.close();
          resolve(payload);
        }
      });
      socket.on('error', () => {
        clearTimeout(timeout);
        resolve(null);
      });
    });
  }

  private async startQuestionSocket(lessonId: string) {
    this.stopQuestionSocket();
    const session = await this.getActiveSession();
    const platform = resolveRainClassroomPlatformByOrigin(session.origin) ?? getRainClassroomPlatform('rain-classroom');
    const lessonToken = await this.getLessonToken(lessonId);
    const userId = await this.getUserId();
    if (!lessonToken || !userId) {
      return;
    }
    const socket = this.createQuestionWebSocket(platform.wsUrl, {
      headers: {
        Cookie: buildCookieHeader(session.cookies),
        Origin: platform.originUrl,
        Referer: `${platform.originUrl}/lesson/fullscreen/v3/${lessonId}`,
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 (KHTML, like Gecko) Chrome Safari/537.36'
      }
    });
    this.questionSocket = socket;
    let msgid = 1;
    socket.on('open', () => {
      socket.send(JSON.stringify({ op: 'hello', userid: userId, role: 'student', auth: lessonToken, lessonid: lessonId }));
    });
    socket.on('message', (data: unknown) => {
      void this.handleSocketMessage(lessonId, data, () => {
        socket.send(JSON.stringify({ op: 'fetchtimeline', lessonid: lessonId, msgid: msgid++ }));
      });
    });
    socket.on('close', () => {
      if (this.questionSocket === socket) {
        this.questionSocket = null;
      }
    });
  }

  private async handleSocketMessage(lessonId: string, data: unknown, fetchTimeline: () => void) {
    const payload = this.parseSocketPayload(data);
    if (!payload) {
      return;
    }
    if (payload.op === 'hello') {
      this.applyTimelinePayload(payload);
      fetchTimeline();
      await this.dispatchCurrentQuestion();
      return;
    }
    if (payload.op === 'fetchtimeline') {
      this.applyTimelinePayload(payload);
      await this.dispatchCurrentQuestion();
      return;
    }
    const record = payload as Record<string, unknown>;
    if (record.op === 'unlockproblem') {
      const problem = isObject(record.problem) ? record.problem : null;
      this.currentPresentationId = parseOptionalString(problem?.pres) ?? this.currentPresentationId;
      this.currentSlideIndex = parseOptionalNumber(problem?.si) ?? this.currentSlideIndex;
      await this.dispatchPresentationQuestion(lessonId, parseOptionalString(problem?.prob), parseOptionalString(problem?.pres), parseOptionalNumber(problem?.si), 'wsapp-unlockproblem');
      return;
    }
    if (record.op === 'lessonfinished') {
      const event = isObject(record.event) ? record.event : {};
      this.currentLessonId = null;
      this.detectedClassroomLessonId = null;
      this.pendingClassroomEntryLessonId = null;
      this.stopQuestionSocket();
      await this.dispatchDetectedClassroomEvent({
        lessonId,
        eventType: 'lesson_finished',
        source: 'wsapp',
        code: 'LESSON_FINISHED',
        title: parseOptionalString(event.title),
        detectedAt: new Date().toISOString()
      });
    }
  }

  private async dispatchCurrentQuestion() {
    if (!this.currentLessonId) {
      return;
    }
    const latestProblem = findLatestProblemEvent(this.currentTimeline);
    if (!latestProblem?.prob) {
      return;
    }
    await this.dispatchPresentationQuestion(
      this.currentLessonId,
      parseOptionalString(latestProblem.prob),
      parseOptionalString(latestProblem.pres),
      parseOptionalNumber(latestProblem.si),
      'presentation-slide'
    );
  }

  private async dispatchPresentationQuestion(
    lessonId: string,
    problemId: string | null,
    presentationId: string | null,
    pageIndex: number | null,
    source: 'presentation-slide' | 'wsapp-unlockproblem'
  ) {
    if (!problemId || !presentationId) {
      return;
    }
    const slide = await this.readCurrentQuestionPresentationSlide(lessonId, {
      problemId,
      presentationId
    });
    const runtimeState = slide ? buildRuntimeStateFromPresentationSlide(lessonId, slide, pageIndex ?? slide.pageIndex ?? 0) : null;
    await this.dispatchDetectedQuestionEvent(buildDetectedQuestionEvent(runtimeState, {
      source,
      pageIndex: pageIndex ?? runtimeState?.pageIndex ?? null,
      presentationId
    }));
  }

  private async dispatchDetectedQuestionEvent(event: DetectedQuestionEvent | null) {
    if (!this.questionDetectionEnabled || !this.onQuestionDetected || !event) {
      return;
    }
    const eventKey = `${event.lessonId}:${event.problemId}`;
    if (this.lastDetectedQuestionKey === eventKey) {
      return;
    }
    this.lastDetectedQuestionKey = eventKey;
    await this.onQuestionDetected(event);
    this.traceStore?.record('question_resolved', 'Question runtime data resolved', {
      lessonId: event.lessonId,
      problemId: event.problemId,
      problemType: event.problemType,
      exerciseIndex: event.exerciseIndex,
      pageIndex: event.pageIndex,
      presentationId: event.presentationId,
      source: event.source
    });
  }

  private async syncClassroomState(lessons: LessonCandidate[]) {
    if (!this.classroomDetectionEnabled || !this.onClassroomDetected) {
      return;
    }

    const activeLesson = lessons.find((lesson) => lesson.lessonState === 'in_class');
    if (activeLesson?.id) {
      if (this.detectedClassroomLessonId === activeLesson.id || this.pendingClassroomEntryLessonId === activeLesson.id) {
        return;
      }
      this.pendingClassroomEntryLessonId = activeLesson.id;
      this.traceStore?.record(
        'classroom_detected',
        this.activeLessonEnterDelayMs > 0
          ? `检测到课堂，${Math.ceil(this.activeLessonEnterDelayMs / 1000)}秒后进入课堂`
          : '检测到课堂，立即进入课堂',
        {
          lessonId: activeLesson.id,
          delayMs: this.activeLessonEnterDelayMs
        }
      );
      if (this.activeLessonEnterDelayMs > 0) {
        await delay(this.activeLessonEnterDelayMs);
      }
      if (
        !this.classroomDetectionEnabled ||
        !this.onClassroomDetected ||
        this.pendingClassroomEntryLessonId !== activeLesson.id
      ) {
        return;
      }
      this.pendingClassroomEntryLessonId = null;
      this.detectedClassroomLessonId = activeLesson.id;
      if (this.questionDetectionEnabled) {
        await this.prepareLesson(activeLesson.id);
        await this.dispatchCurrentQuestion();
        await this.startQuestionSocket(activeLesson.id);
      }
      await this.dispatchDetectedClassroomEvent({
        lessonId: activeLesson.id,
        eventType: 'lesson_started',
        source: 'http',
        code: 'ACTIVE_LESSON',
        title: activeLesson.lessonTitle ?? activeLesson.courseTitle,
        detectedAt: new Date().toISOString()
      });
      return;
    }

    if (!this.detectedClassroomLessonId) {
      this.pendingClassroomEntryLessonId = null;
      return;
    }
    const endedLessonId = this.detectedClassroomLessonId;
    this.detectedClassroomLessonId = null;
    await this.dispatchDetectedClassroomEvent({
      lessonId: endedLessonId,
      eventType: 'lesson_finished',
      source: 'http',
      code: 'NO_ACTIVE_LESSON',
      title: null,
      detectedAt: new Date().toISOString()
    });
  }

  private async dispatchDetectedClassroomEvent(event: DetectedClassroomEvent) {
    if (!this.classroomDetectionEnabled || !this.onClassroomDetected) {
      return;
    }
    const eventKey = `${event.eventType}:${event.lessonId}`;
    if (this.lastDetectedClassroomKey === eventKey) {
      return;
    }
    this.lastDetectedClassroomKey = eventKey;
    await this.onClassroomDetected(event);
  }

  private recordTraceOnce(
    type: Parameters<AutoplayDebugTraceStore['record']>[0],
    key: string,
    message: string,
    data: Record<string, unknown>
  ) {
    if (!this.traceStore) {
      return;
    }
    const traceKey = `${type}:${key}`;
    if (this.emittedTraceKeys.has(traceKey)) {
      return;
    }
    this.emittedTraceKeys.add(traceKey);
    this.traceStore.record(type, message, data);
  }

  private applyTimelinePayload(payload: TimelinePayload) {
    this.currentPresentationId = parseOptionalString(payload.presentation) ?? this.currentPresentationId;
    this.currentSlideIndex = parseOptionalNumber(payload.slideindex) ?? this.currentSlideIndex;
    this.currentTimeline = Array.isArray(payload.timeline) ? payload.timeline : this.currentTimeline;
    const latestProblem = findLatestProblemEvent(this.currentTimeline);
    this.currentPresentationId = parseOptionalString(latestProblem?.pres) ?? this.currentPresentationId;
    this.currentSlideIndex = parseOptionalNumber(latestProblem?.si) ?? this.currentSlideIndex;
  }

  private async getLessonToken(lessonId: string) {
    if (!this.client) {
      return null;
    }
    const result = await this.client.checkInLesson(lessonId);
    return result.lessonToken;
  }

  private async getUserId() {
    const payload = await this.requestJson('/api/v3/user/basic-info', {
      referer: buildRainClassroomHomeUrl(this.session?.origin ?? null)
    });
    return parseOptionalString(payload?.data?.id) ?? (typeof payload?.data?.id === 'number' ? String(payload.data.id) : null);
  }

  private async requestJson(path: string, input: { method?: string; body?: unknown; referer?: string; authorization?: string | null } = {}) {
    const session = await this.getActiveSession();
    const response = await this.fetchFn(new URL(path, this.resolveOriginUrl()).toString(), {
      method: input.method ?? 'GET',
      headers: {
        accept: 'application/json, text/plain, */*',
        'content-type': 'application/json;charset=UTF-8',
        cookie: buildCookieHeader(session.cookies),
        referer: input.referer ?? buildRainClassroomHomeUrl(session.origin),
        origin: this.resolveOriginUrl(),
        'x-csrftoken': extractCookieValue(session.cookies, 'csrftoken') ?? '',
        xtbz: 'ykt',
        'xt-agent': 'web',
        'x-client': 'h5',
        'university-id': '0',
        ...(input.authorization ? { Authorization: input.authorization } : {})
      },
      body: input.body ? JSON.stringify(input.body) : undefined
    });
    return safeJson(response);
  }

  private async getActiveSession() {
    if (!this.session) {
      this.session = await this.sessionStore.load();
    }
    if (!this.session?.cookies.length) {
      throw new Error('No saved session available');
    }
    return this.session;
  }

  private async ensureStarted() {
    if (this.status.status !== 'running') {
      await this.start();
    }
    if (this.status.status !== 'running') {
      throw new Error(this.status.lastError ?? 'HTTP controller is not running');
    }
  }

  private resolveOriginUrl() {
    const fromUrl = resolveRainClassroomPlatformByUrl(this.status.pageUrl)?.originUrl;
    if (fromUrl) {
      return fromUrl;
    }
    const platform = resolveRainClassroomPlatformByOrigin(this.session?.origin) ?? getRainClassroomPlatform('rain-classroom');
    return platform.originUrl;
  }

  private toPresentationSlide(lessonId: string, item: unknown): Exclude<LessonPresentationSlide, null> {
    const raw = isObject(item) ? item : {};
    const problem = isObject(raw.problem) ? raw.problem : isObject(raw.Problem) ? raw.Problem : {};
    const problemId =
      parseOptionalString(raw.problemId) ??
      parseOptionalString(raw.problemID) ??
      parseOptionalString(problem.problemId) ??
      parseOptionalString(problem.problemID) ??
      parseOptionalString(problem.prob);
    const problemType =
      parseOptionalNumber(raw.problemType) ??
      parseOptionalNumber(problem.problemType) ??
      parseOptionalNumber(problem.type);
    return {
      lessonId,
      exerciseIndex:
        parseOptionalString(raw.exerciseIndex) ??
        parseOptionalString(raw.index) ??
        (parseOptionalNumber(raw.pageIndex) !== null ? String(parseOptionalNumber(raw.pageIndex)) : null),
      pageIndex:
        parseOptionalNumber(raw.pageIndex) ??
        parseOptionalNumber(raw.index) ??
        parseOptionalNumber(raw.page) ??
        null,
      problemId,
      problemType,
      imageUrl:
        parseOptionalString(raw.imageUrl) ??
        parseOptionalString(raw.cover) ??
        parseOptionalString(raw.src) ??
        null,
      imageThumbnailUrl:
        parseOptionalString(raw.imageThumbnailUrl) ??
        parseOptionalString(raw.thumbnail) ??
        null,
      raw: item
    };
  }

  private parseSocketPayload(data: unknown): TimelinePayload | null {
    const raw = Buffer.isBuffer(data) ? data.toString() : typeof data === 'string' ? data : String(data);
    try {
      const payload = JSON.parse(raw);
      return isObject(payload) ? payload : null;
    } catch {
      return null;
    }
  }

  private stopQuestionSocket() {
    this.questionSocket?.close();
    this.questionSocket = null;
  }
}
