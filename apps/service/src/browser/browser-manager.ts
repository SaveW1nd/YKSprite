import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page, Request } from 'playwright';
import { AccountRepository } from '../db/account-repository.js';
import type { AccountIdentity } from '../db/account-repository.js';
import type {
  BrowserCookie,
  BrowserDebugState,
  BrowserNetworkEvent,
  BrowserController,
  BrowserStatus,
  DetectedQuestionEvent,
  ExerciseEntry,
  ExerciseRuntimeState,
  LessonCandidate,
  LessonPresentationSlide,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult,
  PageSnapshot,
  ScreenshotPayload,
  SessionState
} from './browser-controller.js';
import type { AccountLoginController, AccountLoginState } from './account-login-controller.js';
import { SessionStore } from './session-store.js';
import type { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';
import {
  buildDetectedQuestionEvent,
  buildRuntimeStateFromPresentationSlide,
  parseLessonTarget,
  parseOptionalString
} from './question-runtime.js';
import {
  buildRainClassroomHomeUrl,
  getRainClassroomPlatform,
  resolveRainClassroomPlatformByOrigin,
  resolveRainClassroomPlatformByUrl,
  type RainClassroomPlatform
} from './rain-classroom-platforms.js';

type LaunchBrowser = typeof chromium.launch;

const normalizeCookieSameSite = (value: string | undefined): 'Strict' | 'Lax' | 'None' | undefined => {
  if (value === 'Strict' || value === 'Lax' || value === 'None') {
    return value;
  }

  return undefined;
};

const toPlaywrightCookies = (cookies: BrowserCookie[]) =>
  cookies.map((cookie) => ({
    ...cookie,
    sameSite: normalizeCookieSameSite(cookie.sameSite)
  }));

type BrowserManagerOptions = {
  launchBrowser?: LaunchBrowser;
  sessionStore?: Pick<SessionStore, 'load' | 'save'>;
  accountRepository?: AccountRepository;
  traceStore?: AutoplayDebugTraceStore;
  activeLessonEnterDelayMs?: number;
  onAccountSessionSaved?: (accountId: number) => void | Promise<void>;
};

const createIdleStatus = (): BrowserStatus => ({
  status: 'idle',
  engine: 'chromium',
  headless: true,
  mode: null,
  startedAt: null,
  pageUrl: null,
  lastError: null
});

const createIdleAccountLoginState = (): AccountLoginState => ({
  loginSessionId: null,
  accountId: null,
  status: 'idle',
  qrCodeDataUrl: null,
  lastError: null,
  notice: null,
  updatedAt: null
});

const createLoginSessionId = () => `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const EXERCISE_READY_RETRIES = 6;
const EXERCISE_READY_TIMEOUT_MS = 8000;
const QUESTION_DETECTION_BINDING = '__ykspriteQuestionDetected';
const ACTIVE_LESSON_DETECTION_BINDING = '__ykspriteActiveLessonDetected';
const LESSON_ENDED_DETECTION_BINDING = '__ykspriteLessonEndedDetected';
const DEFAULT_ACTIVE_LESSON_ENTER_DELAY_MS = 10000;

type DetectedActiveLessonEvent = {
  lessonId: string;
  lessonHref: string;
};

type DetectedLessonEndedEvent = {
  lessonId: string;
  currentUrl: string;
};

const MAX_NETWORK_EVENTS = 100;
const MAX_NETWORK_BODY_PREVIEW = 2000;

const installQuestionDetector = (input: { questionBindingName: string; lessonBindingName: string }) => {
  const { questionBindingName, lessonBindingName } = input;
  const pageWindow = window as typeof window & {
    __ykspriteQuestionDetector?: {
      questionBindingName: string;
      lessonBindingName: string;
      enabled: boolean;
      lastEventKey: string | null;
      lastLessonKey: string | null;
      lastEndedLessonKey: string | null;
      observer: MutationObserver | null;
      unwatch: (() => void) | null;
      routeListenersInstalled: boolean;
      networkHooksInstalled: boolean;
      socketTarget: EventTarget | null;
      socketMessageHandler: ((event: MessageEvent) => void) | null;
      onRouteChange?: () => void;
      onDomReady?: () => void;
      onLoad?: () => void;
      onHashChange?: () => void;
      onPopState?: () => void;
      disable: () => void;
      enable: (nextQuestionBindingName: string, nextLessonBindingName: string) => void;
      detectAndOpenActiveLesson: () => Promise<boolean>;
      detectLessonEndedIfNeeded: () => Promise<boolean>;
      installNetworkHooks: () => void;
      reportCurrentQuestion: () => void;
      attachVueWatch: () => void;
    };
    __ykspriteQuestionRoutePatched?: boolean;
    __ykspriteQuestionFetchPatched?: boolean;
    __ykspriteQuestionXhrPatched?: boolean;
    socket?: EventTarget | null;
  };

  const isExerciseRoute = () => /\/(exercise|subjective)\//.test(location.href);
  const isLessonRoute = () => /\/lesson\/fullscreen\/v3\//.test(location.href);
  const isLessonRootRoute = () => /\/lesson\/fullscreen\/v3\/[^/?#]+$/.test(location.href);
  const isHomeRoute = () => /\/v2\/web\/index/.test(location.href);
  const normalizeOptionListInPage = (value: unknown) => {
    if (!Array.isArray(value)) {
      return [];
    }

    return value
      .map((option) => {
        if (typeof option === 'string') {
          const text = option.trim();
          return text ? { key: text, value: text } : null;
        }

        if (option && typeof option === 'object') {
          const record = option as Record<string, unknown>;
          const key =
            (typeof record.key === 'string' && record.key.trim() ? record.key.trim() : null) ??
            (typeof record.label === 'string' && record.label.trim() ? record.label.trim() : null) ??
            '';
          const resolvedValue =
            (typeof record.value === 'string' && record.value.trim() ? record.value.trim() : null) ??
            (typeof record.label === 'string' && record.label.trim() ? record.label.trim() : null) ??
            (typeof record.text === 'string' && record.text.trim() ? record.text.trim() : null) ??
            (typeof record.key === 'string' && record.key.trim() ? record.key.trim() : null) ??
            '';
          return key || resolvedValue ? { key, value: resolvedValue } : null;
        }

        return null;
      })
      .filter((option): option is { key: string; value: string } => Boolean(option));
  };

  const readVueLessonContext = () => {
    const app = document.querySelector('#app') as { __vue__?: any } | null;
    const vue = app?.__vue__;
    if (!vue?.$store) {
      return null;
    }

    const route = vue.$route;
    const lessonId =
      route?.params?.lessonID ??
      location.pathname.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/)?.[1] ??
      null;
    const root = vue.$children?.[0] ?? vue;
    const cards = vue.$store.state?.cards ?? [];

    return {
      vue,
      route,
      lessonId,
      root,
      cards
    };
  };

  const buildRuntimeStateFromCard = (
    context: NonNullable<ReturnType<typeof readVueLessonContext>>,
    targetCard: any,
    exerciseIndex: string | null,
    routePath: string | null,
    pageIndexFallback: number | null = null
  ): ExerciseRuntimeState | null => {
    const problemId = targetCard?.problemID || context.vue.$store.state?.currSlide?.problemID || null;
    if (!context.lessonId || !problemId) {
      return null;
    }

    const problem = context.root.problemMap?.get?.(problemId)?.problem;
    const problemType = Number(problem?.problemType ?? targetCard?.problemType ?? 0);
    if (!problemType) {
      return null;
    }

    return {
      lessonId: context.lessonId,
      exerciseIndex,
      problemId,
      problemType,
      pageIndex: targetCard?.pageIndex ?? pageIndexFallback,
      questionText: String(problem?.body ?? targetCard?.body ?? '').trim(),
      options: normalizeOptionListInPage(problem?.options ?? targetCard?.options ?? []),
      imageUrl: targetCard?.cover ?? targetCard?.src ?? context.root.problemMap?.get?.(problemId)?.cover ?? null,
      imageThumbnailUrl: targetCard?.thumbnail ?? context.root.problemMap?.get?.(problemId)?.thumbnail ?? null,
      isComplete: Boolean(targetCard?.isComplete ?? false),
      routePath
    } satisfies ExerciseRuntimeState;
  };

  const readRuntimeState = (): ExerciseRuntimeState | null => {
    const context = readVueLessonContext();
    if (!context) {
      return null;
    }

    if (!context.route || !['exercise', 'subjective'].includes(context.route.name)) {
      return null;
    }

    return buildRuntimeStateFromCard(
      context,
      context.cards[Number(context.route.params?.index ?? -1)],
      context.route.params?.index ?? null,
      context.route.path ?? null
    );
  };

  const readLatestPendingRuntimeState = (): ExerciseRuntimeState | null => {
    const context = readVueLessonContext();
    if (!context) {
      return null;
    }

    const candidates = context.cards
      .map((card: any, index: number) => {
        if (card?.isComplete) {
          return null;
        }

        const problemType = Number(context.root?.problemMap?.get?.(card?.problemID)?.problem?.problemType ?? card?.problemType ?? 0);
        const isSubjective = problemType === 5;
        return buildRuntimeStateFromCard(
          context,
          card,
          String(index),
          `/lesson/fullscreen/v3/${context.lessonId}/${isSubjective ? 'subjective' : 'exercise'}/${index}`,
          index
        );
      })
      .filter((card: ExerciseRuntimeState | null): card is ExerciseRuntimeState => Boolean(card));

    return candidates[candidates.length - 1] ?? null;
  };

  const readLatestRuntimeState = () => {
    return readRuntimeState() ?? readLatestPendingRuntimeState();
  };

  const buildEvent = (runtimeState: ExerciseRuntimeState | null): DetectedQuestionEvent | null => {
    if (
      !runtimeState?.lessonId ||
      !runtimeState.problemId ||
      !runtimeState.problemType ||
      runtimeState.isComplete
    ) {
      return null;
    }

    return {
      lessonId: runtimeState.lessonId,
      problemId: runtimeState.problemId,
      problemType: runtimeState.problemType,
      exerciseIndex: runtimeState.exerciseIndex ?? null,
      routePath: runtimeState.routePath ?? null,
      isComplete: runtimeState.isComplete,
      imageUrl: runtimeState.imageUrl ?? null,
      detectedAt: new Date().toISOString()
    };
  };

  const selectActiveLessonFromApiPayload = (payload: {
    data?: {
      onLessonClassrooms?: Array<{
        lessonId?: string;
      }>;
    };
  }): DetectedActiveLessonEvent | null => {
    const activeLesson = payload.data?.onLessonClassrooms?.find((item) => item.lessonId) ?? null;
    if (!activeLesson?.lessonId) {
      return null;
    }

    return {
      lessonId: activeLesson.lessonId,
      lessonHref: `${location.origin}/lesson/fullscreen/v3/${activeLesson.lessonId}`
    };
  };

  const reportActiveLesson = async (lesson: DetectedActiveLessonEvent | null) => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled || !lesson) {
      return false;
    }

    const lessonKey = `${lesson.lessonId}:${lesson.lessonHref}`;
    if (detector.lastLessonKey === lessonKey) {
      return false;
    }

    detector.lastLessonKey = lessonKey;
    const reporter = (pageWindow as unknown as Record<string, unknown>)[detector.lessonBindingName];
    if (typeof reporter === 'function') {
      await (reporter as (payload: DetectedActiveLessonEvent) => Promise<void>)(lesson);
      return true;
    }

    return false;
  };

  const detectAndOpenActiveLesson = async () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled || isExerciseRoute() || isLessonRootRoute() || !isHomeRoute()) {
      return false;
    }

    let lesson: DetectedActiveLessonEvent | null = null;

    try {
      const response = await fetch('/api/v3/classroom/on-lesson-upcoming-exam', {
        credentials: 'include'
      });
      if (response.ok) {
        lesson = selectActiveLessonFromApiPayload((await response.json()) as {
          data?: {
            onLessonClassrooms?: Array<{
              lessonId?: string;
            }>;
          };
        });
      }
    } catch {
      lesson = null;
    }

    return reportActiveLesson(lesson);
  };

  const installNetworkHooks = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector || detector.networkHooksInstalled) {
      return;
    }

    const shouldCheckActiveLesson = (url: string) =>
      url.includes('/api/v3/classroom/on-lesson-upcoming-exam') || url.includes('/api/v3/classroom/');

    if (!pageWindow.__ykspriteQuestionFetchPatched && typeof window.fetch === 'function') {
      pageWindow.__ykspriteQuestionFetchPatched = true;
      const originalFetch = window.fetch.bind(window);
      window.fetch = (async (...args: Parameters<typeof window.fetch>) => {
        const response = await originalFetch(...args);
        const input = args[0];
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (url.includes('/api/v3/classroom/on-lesson-upcoming-exam')) {
          response
            .clone()
            .json()
            .then((payload) => reportActiveLesson(selectActiveLessonFromApiPayload(payload)))
            .catch(() => undefined);
        } else if (shouldCheckActiveLesson(url)) {
          void detectAndOpenActiveLesson();
        }
        return response;
      }) as typeof window.fetch;
    }

    if (!pageWindow.__ykspriteQuestionXhrPatched && typeof XMLHttpRequest !== 'undefined') {
      pageWindow.__ykspriteQuestionXhrPatched = true;
      const originalOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (
        method: string,
        url: string | URL,
        async?: boolean,
        username?: string | null,
        password?: string | null
      ) {
        Object.defineProperty(this, '__ykspriteRequestUrl', {
          configurable: true,
          writable: true,
          value: String(url)
        });
        this.addEventListener('loadend', () => {
          const requestUrl = (this as XMLHttpRequest & { __ykspriteRequestUrl?: string }).__ykspriteRequestUrl ?? '';
          if (shouldCheckActiveLesson(requestUrl)) {
            void detectAndOpenActiveLesson();
          }
        });
        return originalOpen.call(this, method, url, async ?? true, username ?? null, password ?? null);
      };
    }

    detector.networkHooksInstalled = true;
  };

  const installSocketHooks = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    const socket = pageWindow.socket;
    if (!detector || !socket || typeof socket.addEventListener !== 'function') {
      return;
    }

    if (detector.socketTarget === socket && detector.socketMessageHandler) {
      return;
    }

    if (detector.socketTarget && detector.socketMessageHandler) {
      detector.socketTarget.removeEventListener('message', detector.socketMessageHandler as EventListener);
    }

    detector.socketTarget = socket;
    detector.socketMessageHandler = (event: MessageEvent) => {
      let payload: { op?: string } | null = null;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
      } catch {
        payload = null;
      }

      if (!payload?.op || !['unlockproblem', 'slidenav', 'showpresentation', 'presentationupdated'].includes(payload.op)) {
        return;
      }

      setTimeout(() => {
        attachVueWatch();
        reportCurrentQuestion();
      }, 0);
    };
    socket.addEventListener('message', detector.socketMessageHandler as EventListener);
  };

  const detectLessonEndedIfNeeded = async () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled || !isLessonRoute() || isHomeRoute()) {
      return false;
    }

    const target = `${document.title ?? ''} ${document.body?.innerText ?? document.body?.textContent ?? ''}`.trim();
    if (!/已结束|下课|课程结束/.test(target)) {
      return false;
    }

    const lessonId = location.pathname.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/)?.[1] ?? null;
    if (!lessonId) {
      return false;
    }

    const lessonKey = `${lessonId}:${location.pathname}`;
    if (detector.lastEndedLessonKey === lessonKey) {
      return false;
    }

    detector.lastEndedLessonKey = lessonKey;
    const reporter = (pageWindow as unknown as Record<string, unknown>)[LESSON_ENDED_DETECTION_BINDING];
    if (typeof reporter === 'function') {
      await (reporter as (payload: DetectedLessonEndedEvent) => Promise<void>)({
        lessonId,
        currentUrl: location.href
      });
      return true;
    }

    return false;
  };

  const reportCurrentQuestion = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled) {
      return;
    }

    const event = buildEvent(readLatestRuntimeState());
    if (!event) {
      return;
    }

    const eventKey = `${event.lessonId}:${event.problemId}`;
    if (detector.lastEventKey === eventKey) {
      return;
    }

    detector.lastEventKey = eventKey;
    const reporter = (pageWindow as unknown as Record<string, unknown>)[detector.questionBindingName];
    if (typeof reporter === 'function') {
      void (reporter as (payload: DetectedQuestionEvent) => Promise<void>)(event);
    }
  };

  const attachVueWatch = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled || detector.unwatch) {
      return;
    }

    const app = document.querySelector('#app') as { __vue__?: any } | null;
    const vue = app?.__vue__;
    if (!vue?.$watch) {
      return;
    }

    detector.unwatch = vue.$watch(
      () => {
        const route = vue.$route;
        const latestCard = readLatestRuntimeState();
        return JSON.stringify({
          routeName: route?.name ?? null,
          routePath: route?.path ?? null,
          lessonId: latestCard?.lessonId ?? route?.params?.lessonID ?? null,
          exerciseIndex: latestCard?.exerciseIndex ?? route?.params?.index ?? null,
          problemId: latestCard?.problemId ?? null,
          problemType: latestCard?.problemType ?? 0,
          isComplete: latestCard?.isComplete ?? false
        });
      },
      () => {
        reportCurrentQuestion();
      },
      { immediate: true }
    );
  };

  const installRouteHooks = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector || detector.routeListenersInstalled) {
      return;
    }

    const routeChange = async () => {
      if (await detectLessonEndedIfNeeded()) {
        return;
      }
      void detectAndOpenActiveLesson();
      installSocketHooks();
      attachVueWatch();
      reportCurrentQuestion();
    };

    detector.onRouteChange = routeChange;
    detector.onDomReady = routeChange;
    detector.onLoad = routeChange;
    detector.onHashChange = routeChange;
    detector.onPopState = routeChange;
    window.addEventListener('DOMContentLoaded', detector.onDomReady);
    window.addEventListener('load', detector.onLoad);
    window.addEventListener('hashchange', detector.onHashChange);
    window.addEventListener('popstate', detector.onPopState);

    if (!pageWindow.__ykspriteQuestionRoutePatched) {
      pageWindow.__ykspriteQuestionRoutePatched = true;
      const dispatchRouteChange = () => {
        window.dispatchEvent(new Event('yksprite:route-change'));
      };
      const originalPushState = history.pushState.bind(history);
      const originalReplaceState = history.replaceState.bind(history);
      history.pushState = ((...args: Parameters<typeof history.pushState>) => {
        const result = originalPushState(...args);
        dispatchRouteChange();
        return result;
      }) as typeof history.pushState;
      history.replaceState = ((...args: Parameters<typeof history.replaceState>) => {
        const result = originalReplaceState(...args);
        dispatchRouteChange();
        return result;
      }) as typeof history.replaceState;
    }

    window.addEventListener('yksprite:route-change', detector.onRouteChange);
    detector.routeListenersInstalled = true;
  };

  const ensureObserver = () => {
    const detector = pageWindow.__ykspriteQuestionDetector;
    if (!detector?.enabled || detector.observer) {
      return;
    }

    detector.observer = new MutationObserver(() => {
      void detectLessonEndedIfNeeded();
      void detectAndOpenActiveLesson();
      installSocketHooks();
      attachVueWatch();
      reportCurrentQuestion();
    });
    const root = document.documentElement ?? document.body;
    if (root) {
      detector.observer.observe(root, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true
      });
    }
  };

  const existing = pageWindow.__ykspriteQuestionDetector;
  if (existing) {
    existing.enable(questionBindingName, lessonBindingName);
    return;
  }

  pageWindow.__ykspriteQuestionDetector = {
    questionBindingName,
    lessonBindingName,
    enabled: true,
    lastEventKey: null,
    lastLessonKey: null,
    lastEndedLessonKey: null,
    observer: null,
    unwatch: null,
    routeListenersInstalled: false,
    networkHooksInstalled: false,
    socketTarget: null,
    socketMessageHandler: null,
    disable() {
      this.enabled = false;
      this.observer?.disconnect();
      this.observer = null;
      this.unwatch?.();
      this.unwatch = null;
      if (this.socketTarget && this.socketMessageHandler) {
        this.socketTarget.removeEventListener('message', this.socketMessageHandler as EventListener);
      }
      this.socketTarget = null;
      this.socketMessageHandler = null;
    },
    enable(nextQuestionBindingName: string, nextLessonBindingName: string) {
      this.unwatch?.();
      this.unwatch = null;
      this.lastEventKey = null;
      if (this.socketTarget && this.socketMessageHandler) {
        this.socketTarget.removeEventListener('message', this.socketMessageHandler as EventListener);
      }
      this.socketTarget = null;
      this.socketMessageHandler = null;
      this.questionBindingName = nextQuestionBindingName;
      this.lessonBindingName = nextLessonBindingName;
      this.enabled = true;
      installRouteHooks();
      installNetworkHooks();
      installSocketHooks();
      ensureObserver();
      void detectLessonEndedIfNeeded();
      void detectAndOpenActiveLesson();
      attachVueWatch();
      reportCurrentQuestion();
    },
    detectAndOpenActiveLesson,
    detectLessonEndedIfNeeded,
    installNetworkHooks,
    reportCurrentQuestion,
    attachVueWatch
  };

  pageWindow.__ykspriteQuestionDetector.enable(questionBindingName, lessonBindingName);
};

export class BrowserManager implements BrowserController, AccountLoginController {
  private readonly launchBrowser: LaunchBrowser;
  private readonly sessionStore: Pick<SessionStore, 'load' | 'save'>;
  private readonly accountRepository: AccountRepository | null;
  private readonly traceStore: AutoplayDebugTraceStore | null;
  private readonly activeLessonEnterDelayMs: number;
  private readonly onAccountSessionSaved: ((accountId: number) => void | Promise<void>) | null;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private status: BrowserStatus = createIdleStatus();
  private recentNetworkEvents: BrowserNetworkEvent[] = [];
  private questionDetectionEnabled = false;
  private onQuestionDetected: ((event: DetectedQuestionEvent) => void | Promise<void>) | null = null;
  private questionBindingsInstalled = false;
  private questionInitScriptInstalled = false;
  private visibleLoginAutoSaveHandler: ((...args: unknown[]) => void) | null = null;
  private lastSavedSessionFingerprint: string | null = null;
  private accountLoginState: AccountLoginState = createIdleAccountLoginState();
  private currentLoginPlatform: RainClassroomPlatform = getRainClassroomPlatform('rain-classroom');
  private pendingActiveLessonKey: string | null = null;
  private activeLessonEntryTimeout: ReturnType<typeof setTimeout> | null = null;

  constructor(options: BrowserManagerOptions = {}) {
    this.launchBrowser = options.launchBrowser ?? chromium.launch.bind(chromium);
    this.sessionStore = options.sessionStore ?? new SessionStore();
    this.accountRepository = options.accountRepository ?? null;
    this.traceStore = options.traceStore ?? null;
    this.activeLessonEnterDelayMs = options.activeLessonEnterDelayMs ?? DEFAULT_ACTIVE_LESSON_ENTER_DELAY_MS;
    this.onAccountSessionSaved = options.onAccountSessionSaved ?? null;
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

    this.status = {
      ...this.status,
      status: 'starting',
      lastError: null
    };

    try {
      this.browser = await this.launchBrowser({ headless: true });
      this.context = await this.browser.newContext();
      const session = await this.sessionStore.load();
      if (session?.cookies.length) {
        await this.context.addCookies(toPlaywrightCookies(session.cookies));
        this.lastSavedSessionFingerprint = this.buildSessionFingerprint(session.cookies);
      }
      this.page = await this.context.newPage();
      this.attachPageNetworkListeners(this.page);
      this.resetQuestionDetectionInstallState();
      await this.ensureQuestionDetection();
      const homeUrl = buildRainClassroomHomeUrl(session?.origin ?? null);
      await this.page.goto(session?.cookies.length ? homeUrl : 'about:blank');

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: new Date().toISOString(),
        pageUrl: this.page.url(),
        lastError: null
      };
      await this.emitCurrentQuestionSnapshot();
    } catch (error) {
      await this.cleanup();
      this.status = {
        status: 'error',
        engine: 'chromium',
        headless: true,
        mode: null,
        startedAt: null,
        pageUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown browser launch error'
      };
    }

    return this.getStatus();
  }

  async startLogin(): Promise<BrowserStatus> {
    if (this.status.status === 'running' && this.status.mode === 'visible-login') {
      return this.getStatus();
    }

    if (this.status.status === 'running') {
      await this.stop();
    }

    this.accountLoginState = createIdleAccountLoginState();

    this.status = {
      ...this.status,
      status: 'starting',
      lastError: null
    };

    try {
      this.browser = await this.launchBrowser({ headless: false });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      this.attachPageNetworkListeners(this.page);
      this.attachVisibleLoginAutoSave(this.page);
      this.resetQuestionDetectionInstallState();
      await this.ensureQuestionDetection();
      const loginUrl = this.resolveCurrentPlatform().loginUrl;
      await this.page.goto(loginUrl);

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'visible-login',
        startedAt: new Date().toISOString(),
        pageUrl: this.page.url(),
        lastError: null
      };
      await this.emitCurrentQuestionSnapshot();
    } catch (error) {
      await this.cleanup();
      this.status = {
        status: 'error',
        engine: 'chromium',
        headless: true,
        mode: null,
        startedAt: null,
        pageUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown login browser launch error'
      };
    }

    return this.getStatus();
  }

  async startAccountLogin(input?: { platform?: string }): Promise<AccountLoginState> {
    const loginSessionId = createLoginSessionId();
    if (!this.accountRepository) {
      return {
        loginSessionId,
        accountId: null,
        status: 'error',
        qrCodeDataUrl: null,
        lastError: 'Account repository is unavailable',
        notice: null,
        updatedAt: new Date().toISOString()
      };
    }

    if (this.status.status === 'running') {
      await this.stop();
    }

    this.status = {
      ...this.status,
      status: 'starting',
      lastError: null
    };

    this.accountLoginState = {
      loginSessionId,
      accountId: null,
      status: 'pending',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: new Date().toISOString()
    };
    this.currentLoginPlatform = getRainClassroomPlatform(input?.platform);

    try {
      this.browser = await this.launchBrowser({ headless: true });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      this.attachPageNetworkListeners(this.page);
      this.attachVisibleLoginAutoSave(this.page);
      this.resetQuestionDetectionInstallState();
      await this.ensureQuestionDetection();
      const qrCodePageUrl = await this.requestLoginQrCodePageUrl(this.currentLoginPlatform);
      await this.page.goto(qrCodePageUrl);
      const qrCodeDataUrl = await this.readLoginQrCodeDataUrlFromPage(loginSessionId, qrCodePageUrl);

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'qr-login',
        startedAt: new Date().toISOString(),
        pageUrl: this.page.url(),
        lastError: null
      };

      this.accountLoginState = {
        loginSessionId,
        accountId: null,
        status: 'pending',
        qrCodeDataUrl,
        lastError: null,
        notice: null,
        updatedAt: new Date().toISOString()
      };

      return { ...this.accountLoginState };
    } catch (error) {
      await this.cleanup();
      this.status = {
        status: 'error',
        engine: 'chromium',
        headless: true,
        mode: null,
        startedAt: null,
        pageUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown QR login launch error'
      };
      this.accountLoginState = {
        loginSessionId,
        accountId: null,
        status: 'error',
        qrCodeDataUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown QR login launch error',
        notice: null,
        updatedAt: new Date().toISOString()
      };
      return { ...this.accountLoginState };
    }
  }

  async getAccountLoginState(loginSessionId: string): Promise<AccountLoginState> {
    if (this.accountLoginState.loginSessionId === loginSessionId) {
      return { ...this.accountLoginState };
    }

    return {
      loginSessionId,
      accountId: null,
      status: 'idle',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: null
    };
  }

  async stopAccountLogin(loginSessionId: string): Promise<AccountLoginState> {
    if (this.accountLoginState.loginSessionId !== loginSessionId) {
      return {
        loginSessionId,
        accountId: null,
        status: 'idle',
        qrCodeDataUrl: null,
        lastError: null,
        notice: null,
        updatedAt: null
      };
    }

    await this.stop();
    this.accountLoginState = createIdleAccountLoginState();
    return {
      loginSessionId,
      accountId: null,
      status: 'idle',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: new Date().toISOString()
    };
  }

  async stop(): Promise<BrowserStatus> {
    if (this.status.status === 'idle' || this.status.status === 'stopping') {
      return this.getStatus();
    }

    this.status = {
      ...this.status,
      status: 'stopping'
    };

    await this.maybeAutoSaveVisibleLoginSession();
    await this.cleanup();
    this.status = createIdleStatus();
    return this.getStatus();
  }

  async getSessionState(): Promise<SessionState> {
    const stored = await this.sessionStore.load();
    const pageTitle = this.page ? await this.page.title().catch(() => null) : null;

    return {
      hasSession: Boolean(stored?.cookies.length),
      savedAt: stored?.savedAt ?? null,
      origin: stored?.origin ?? null,
      cookieCount: stored?.cookies.length ?? 0,
      currentUrl: this.page?.url() ?? null,
      pageTitle,
      mode: this.status.mode
    };
  }

  async saveSession(): Promise<SessionState> {
    return (await this.persistCurrentSession()) ?? this.getSessionState();
  }

  async navigateHome(): Promise<BrowserStatus> {
    if (!this.page) {
      return this.getStatus();
    }

    await this.page.goto(this.resolveCurrentPlatform().homeUrl);
    this.status = {
      ...this.status,
      pageUrl: this.page.url()
    };
    return this.getStatus();
  }

  async navigate(url: string): Promise<BrowserStatus> {
    if (!this.page) {
      return this.getStatus();
    }

    await this.page.goto(url);
    this.status = {
      ...this.status,
      pageUrl: this.page.url()
    };
    return this.getStatus();
  }

  async discoverLessons(): Promise<LessonCandidate[]> {
    if (!this.page) {
      return [];
    }

    return this.page.evaluate(async () => {
      const response = await fetch('/api/v3/classroom/on-lesson-upcoming-exam', {
        credentials: 'include'
      });

      if (response.ok) {
        const payload = (await response.json()) as {
          data?: {
            onLessonClassrooms?: Array<{
              classroomId?: string;
              classroomName?: string;
              courseName?: string;
              lessonId?: string;
            }>;
          };
        };

        const lessons = payload.data?.onLessonClassrooms ?? [];
        return lessons
          .filter((lesson) => lesson.lessonId)
          .map((lesson) => ({
            id: lesson.lessonId!,
            classroomId: lesson.classroomId ?? null,
            courseTitle: lesson.courseName ?? lesson.classroomName ?? '未命名课程',
            lessonTitle: lesson.classroomName ?? lesson.courseName ?? null,
            lessonState: 'in_class',
            href: `${location.origin}/lesson/fullscreen/v3/${lesson.lessonId}`
          } satisfies LessonCandidate));
      }

      return [];
    });
  }

  async listExerciseEntries(): Promise<ExerciseEntry[]> {
    if (!this.page) {
      return [];
    }

    const currentUrl = this.page.url();
    const currentTarget = parseLessonTarget(currentUrl);
    if (!currentTarget.lessonId) {
      return [];
    }

    const slides = await this.listLessonPresentationSlides(currentTarget.lessonId);
    const pageOrigin = (() => {
      try {
        return new URL(currentUrl).origin;
      } catch {
        return this.resolveCurrentPlatform().originUrl;
      }
    })();

    return slides.flatMap((slide, index) => {
      const runtimeState = buildRuntimeStateFromPresentationSlide(currentTarget.lessonId as string, slide, index);
      if (!runtimeState) {
        return [];
      }

      const raw = slide.raw && typeof slide.raw === 'object' ? (slide.raw as Record<string, unknown>) : {};
      const statusText =
        parseOptionalString(raw.status) ??
        parseOptionalString(raw.answerStatus) ??
        parseOptionalString(raw.state) ??
        '';
      const isExpired = /expired|ended|结束|已结束/i.test(statusText);

      return [
        {
          entryId: `presentation-${runtimeState.exerciseIndex}`,
          lessonId: currentTarget.lessonId,
          status: isExpired ? 'expired' : runtimeState.isComplete ? 'answered' : 'unanswered',
          isActive:
            currentTarget.exerciseIndex === runtimeState.exerciseIndex ||
            currentTarget.exerciseIndex === String(runtimeState.pageIndex ?? ''),
          pageHint: parseOptionalString(raw.pageHint) ?? (runtimeState.pageIndex !== null ? `第${runtimeState.pageIndex}页` : null),
          remainingHint: parseOptionalString(raw.remainingHint) ?? parseOptionalString(raw.updatedAt) ?? null,
          thumbnailUrl: runtimeState.imageThumbnailUrl,
          exerciseUrl: `${pageOrigin}${runtimeState.routePath}`,
          runtimeState
        } satisfies ExerciseEntry
      ];
    });
  }

  async listLessonPresentationSlides(lessonId: string) {
    if (!this.page) {
      return [];
    }

    return this.page.evaluate(async (activeLessonId) => {
      const response = await fetch('/api/v3/lesson/presentation/fetch', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json;charset=UTF-8'
        },
        body: JSON.stringify({
          lessonId: activeLessonId
        })
      });

      if (!response.ok) {
        return [];
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            data?: {
              presentations?: unknown[];
              slides?: unknown[];
              list?: unknown[];
            };
          }
        | null;
      const collection =
        payload?.data?.presentations ??
        payload?.data?.slides ??
        payload?.data?.list ??
        [];

      const items = Array.isArray(collection) ? collection : [];

      const parseNumber = (value: unknown) => {
        if (typeof value === 'number' && Number.isFinite(value)) {
          return value;
        }

        if (typeof value === 'string' && value.trim()) {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        }

        return null;
      };

      const parseString = (value: unknown) => {
        return typeof value === 'string' && value.trim() ? value.trim() : null;
      };

      return items.map((item) => {
        const raw = item as Record<string, unknown>;
        return {
          lessonId: activeLessonId,
          exerciseIndex:
            parseString(raw.exerciseIndex) ??
            parseString(raw.index) ??
            (parseNumber(raw.pageIndex) !== null ? String(parseNumber(raw.pageIndex)) : null),
          pageIndex:
            parseNumber(raw.pageIndex) ??
            parseNumber(raw.index) ??
            parseNumber(raw.page) ??
            null,
          problemId:
            parseString(raw.problemId) ??
            parseString(raw.problemID) ??
            null,
          problemType:
            parseNumber(raw.problemType) ??
            null,
          imageUrl:
            parseString(raw.imageUrl) ??
            parseString(raw.cover) ??
            parseString(raw.src) ??
            null,
          imageThumbnailUrl:
            parseString(raw.imageThumbnailUrl) ??
            parseString(raw.thumbnail) ??
            null,
          raw: item
        };
      });
    }, lessonId);
  }

  async readCurrentQuestionPresentationSlide(lessonId: string): Promise<LessonPresentationSlide> {
    if (!this.page) {
      return null;
    }
    const slides = await this.listLessonPresentationSlides(lessonId);
    const currentExerciseIndex = this.page.url().match(/\/lesson\/fullscreen\/v3\/[^/]+\/(?:exercise|subjective)\/([^/?#]+)/)?.[1] ?? null;
    const latestSlide = [...slides].reverse().find((slide) => slide.problemId && slide.imageUrl) ?? null;

    return (
      slides.find((slide) => {
        if (!currentExerciseIndex) {
          return false;
        }

        return (
          slide.exerciseIndex === currentExerciseIndex ||
          String(slide.pageIndex ?? '') === currentExerciseIndex
        );
      }) ??
      latestSlide ??
      (await this.page.evaluate((activeLessonId) => {
        const app = document.querySelector('#app') as { __vue__?: any } | null;
        const vue = app?.__vue__;
        const currentSlide = vue?.$store?.state?.currSlide ?? null;
        if (!currentSlide) {
          return null;
        }

        return {
          lessonId: vue?.$route?.params?.lessonID ?? activeLessonId,
          exerciseIndex:
            (typeof currentSlide.exerciseIndex === 'string' && currentSlide.exerciseIndex.trim() ? currentSlide.exerciseIndex.trim() : null) ??
            (typeof currentSlide.index === 'string' && currentSlide.index.trim() ? currentSlide.index.trim() : null) ??
            (typeof currentSlide.pageIndex === 'number'
              ? String(currentSlide.pageIndex)
              : typeof currentSlide.pageIndex === 'string' && currentSlide.pageIndex.trim()
                ? currentSlide.pageIndex.trim()
                : null),
          pageIndex:
            (typeof currentSlide.pageIndex === 'number' && Number.isFinite(currentSlide.pageIndex) ? currentSlide.pageIndex : null) ??
            (typeof currentSlide.index === 'number' && Number.isFinite(currentSlide.index) ? currentSlide.index : null),
          problemId:
            (typeof currentSlide.problemId === 'string' && currentSlide.problemId.trim() ? currentSlide.problemId.trim() : null) ??
            (typeof currentSlide.problemID === 'string' && currentSlide.problemID.trim() ? currentSlide.problemID.trim() : null),
          problemType:
            typeof currentSlide.problemType === 'number' && Number.isFinite(currentSlide.problemType)
              ? currentSlide.problemType
              : null,
          imageUrl:
            (typeof currentSlide.imageUrl === 'string' && currentSlide.imageUrl.trim() ? currentSlide.imageUrl.trim() : null) ??
            (typeof currentSlide.cover === 'string' && currentSlide.cover.trim() ? currentSlide.cover.trim() : null) ??
            (typeof currentSlide.src === 'string' && currentSlide.src.trim() ? currentSlide.src.trim() : null) ??
            null,
          imageThumbnailUrl:
            (typeof currentSlide.imageThumbnailUrl === 'string' && currentSlide.imageThumbnailUrl.trim() ? currentSlide.imageThumbnailUrl.trim() : null) ??
            (typeof currentSlide.thumbnail === 'string' && currentSlide.thumbnail.trim() ? currentSlide.thumbnail.trim() : null) ??
            null,
          raw: currentSlide
        };
      }, lessonId).catch(() => null)) ??
      null
    );
  }

  async openCurrentExercise(): Promise<string | null> {
    if (!this.page) {
      return null;
    }

    if (/\/(exercise|subjective)\//.test(this.page.url())) {
      return this.page.url();
    }

    return null;
  }

  async inspectPage(): Promise<PageSnapshot> {
    return {
      currentUrl: this.page?.url() ?? null,
      pageTitle: this.page ? await this.page.title().catch(() => null) : null,
      html: this.page ? await this.page.content().catch(() => null) : null,
      text: this.page ? await this.page.locator('body').innerText().catch(() => null) : null
    };
  }

  async getDebugState(): Promise<BrowserDebugState> {
    return {
      snapshot: await this.inspectPage(),
      network: [...this.recentNetworkEvents],
      runtime: await this.inspectRuntimeDebug()
    };
  }

  async captureScreenshot(): Promise<ScreenshotPayload> {
    if (!this.page) {
      return null;
    }

    const data = await this.page.screenshot({ type: 'png' });
    return {
      mimeType: 'image/png',
      data: data.toString('base64')
    };
  }

  async ensureExercisePageReady(url: string): Promise<ExerciseRuntimeState> {
    if (!this.page) {
      throw new Error('Browser page is not available');
    }

    const handleDialog = async (dialog: { dismiss(): Promise<void> }) => {
      await dialog.dismiss().catch(() => undefined);
    };

    this.page.on('dialog', handleDialog);
    try {
      const target = parseLessonTarget(url);
      const currentUrl = this.page.url();
      const currentRuntimeState = await this.readExerciseRuntimeState().catch(() => null);

      const alreadyOnTarget =
        currentUrl === url ||
        (currentRuntimeState &&
          currentRuntimeState.lessonId === target.lessonId &&
          currentRuntimeState.exerciseIndex === target.exerciseIndex);

      if (!alreadyOnTarget) {
        await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      }

      await this.page.mouse.click(100, 100).catch(() => undefined);
      await this.page.keyboard.press('Tab').catch(() => undefined);
      await this.page.waitForFunction(() => {
        const app = document.querySelector('#app') as { __vue__?: any } | null;
        const vue = app?.__vue__;
        if (!vue?.$store || !vue.$route || !['exercise', 'subjective'].includes(vue.$route.name)) {
          return false;
        }

        const cards = vue.$store.state?.cards ?? [];
        const routeIndex = Number(vue.$route.params?.index ?? -1);
        const card = cards[routeIndex];
        const problemId = card?.problemID || vue.$store.state?.currSlide?.problemID || null;
        return Boolean(problemId);
      }, { timeout: EXERCISE_READY_TIMEOUT_MS });

      const runtimeState = await this.readExerciseRuntimeState();
      if (runtimeState) {
        this.status = {
          ...this.status,
          pageUrl: this.page.url()
        };
        return runtimeState;
      }

      throw new Error(`Exercise runtime state was not available for ${url}`);
    } finally {
      this.page.off('dialog', handleDialog);
    }
  }

  async readExerciseRuntimeState(): Promise<ExerciseRuntimeState | null> {
    if (!this.page) {
      return null;
    }

    return this.page.evaluate(() => {
      const normalizeOptionListInPage = (value: unknown) => {
        if (!Array.isArray(value)) {
          return [];
        }

        return value
          .map((option) => {
            if (typeof option === 'string') {
              const text = option.trim();
              return text ? { key: text, value: text } : null;
            }

            if (option && typeof option === 'object') {
              const record = option as Record<string, unknown>;
              const key =
                (typeof record.key === 'string' && record.key.trim() ? record.key.trim() : null) ??
                (typeof record.label === 'string' && record.label.trim() ? record.label.trim() : null) ??
                '';
              const resolvedValue =
                (typeof record.value === 'string' && record.value.trim() ? record.value.trim() : null) ??
                (typeof record.label === 'string' && record.label.trim() ? record.label.trim() : null) ??
                (typeof record.text === 'string' && record.text.trim() ? record.text.trim() : null) ??
                (typeof record.key === 'string' && record.key.trim() ? record.key.trim() : null) ??
                '';
              return key || resolvedValue ? { key, value: resolvedValue } : null;
            }

            return null;
          })
          .filter((option): option is { key: string; value: string } => Boolean(option));
      };

      const buildRuntimeStateFromCard = (
        context: {
          vue: any;
          route: any;
          lessonId: string | null;
          root: any;
          cards: any[];
        },
        targetCard: any,
        exerciseIndex: string | null,
        routePath: string | null,
        pageIndexFallback: number | null = null
      ) => {
        const problemId = targetCard?.problemID || context.vue.$store.state?.currSlide?.problemID || null;
        if (!context.lessonId || !problemId) {
          return null;
        }

        const problem = context.root.problemMap?.get?.(problemId)?.problem;
        const problemType = Number(problem?.problemType ?? targetCard?.problemType ?? 0);
        if (!problemType) {
          return null;
        }

        return {
          lessonId: context.lessonId,
          exerciseIndex,
          problemId,
          problemType,
          pageIndex: targetCard?.pageIndex ?? pageIndexFallback,
          questionText: String(problem?.body ?? targetCard?.body ?? '').trim(),
          options: normalizeOptionListInPage(problem?.options ?? targetCard?.options ?? []),
          imageUrl: targetCard?.cover ?? targetCard?.src ?? context.root.problemMap?.get?.(problemId)?.cover ?? null,
          imageThumbnailUrl: targetCard?.thumbnail ?? context.root.problemMap?.get?.(problemId)?.thumbnail ?? null,
          isComplete: Boolean(targetCard?.isComplete ?? false),
          routePath
        } satisfies ExerciseRuntimeState;
      };

      const app = document.querySelector('#app') as { __vue__?: any } | null;
      const vue = app?.__vue__;
      if (!vue?.$store) {
        return null;
      }

      const route = vue.$route;
      const lessonId =
        route?.params?.lessonID ??
        location.pathname.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/)?.[1] ??
        null;
      const root = vue.$children?.[0] ?? vue;
      const cards = vue.$store.state?.cards ?? [];
      const context = {
        vue,
        route,
        lessonId,
        root,
        cards
      };

      if (route && ['exercise', 'subjective'].includes(route.name)) {
        const routeIndex = Number(route.params?.index ?? -1);
        const card = cards[routeIndex];
        return buildRuntimeStateFromCard(
          context,
          card,
          route.params?.index ?? null,
          route.path ?? null
        );
      }

      const candidates = cards
        .map((card: any, index: number) => {
          if (card?.isComplete) {
            return null;
          }

          const problemType = Number(root?.problemMap?.get?.(card?.problemID)?.problem?.problemType ?? card?.problemType ?? 0);
          const isSubjective = problemType === 5;
          return buildRuntimeStateFromCard(
            context,
            card,
            String(index),
            `/lesson/fullscreen/v3/${lessonId}/${isSubjective ? 'subjective' : 'exercise'}/${index}`,
            index
          );
        })
        .filter((card: ExerciseRuntimeState | null): card is ExerciseRuntimeState => Boolean(card));

      return candidates[candidates.length - 1] ?? null;
    });
  }

  async startQuestionDetection(onEvent: (event: DetectedQuestionEvent) => void | Promise<void>): Promise<void> {
    this.questionDetectionEnabled = true;
    this.onQuestionDetected = onEvent;
    await this.ensureQuestionDetection();
    await this.page
      ?.evaluate(() => {
        const pageWindow = window as typeof window & {
          __ykspriteQuestionDetector?: { detectLessonEndedIfNeeded?: () => Promise<boolean> };
        };
        return pageWindow.__ykspriteQuestionDetector?.detectLessonEndedIfNeeded?.() ?? false;
      })
      .catch(() => undefined);
    await this.emitCurrentQuestionSnapshot();
  }

  async stopQuestionDetection(): Promise<void> {
    this.questionDetectionEnabled = false;
    this.onQuestionDetected = null;
    await this.disableCurrentPageQuestionDetector();
  }

  async submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult> {
    if (!this.page) {
      throw new Error('Browser page is not available');
    }

    return this.page.evaluate(async (input) => {
      const pageWindow = window as typeof window & {
        API?: {
          lesson?: {
            answer_problem?: string;
          };
        };
        request?: {
          post?: (url: string, body: unknown) => Promise<unknown>;
        };
      };

      if (pageWindow.request?.post && pageWindow.API?.lesson?.answer_problem) {
        try {
          const responseJson = await pageWindow.request.post(pageWindow.API.lesson.answer_problem, input);
          const code =
            typeof responseJson === 'object' &&
            responseJson !== null &&
            'code' in responseJson &&
            typeof (responseJson as { code?: unknown }).code === 'number'
              ? (responseJson as { code: number }).code
              : 0;
          const message =
            typeof responseJson === 'object' &&
            responseJson !== null &&
            'msg' in responseJson &&
            typeof (responseJson as { msg?: unknown }).msg === 'string'
              ? (responseJson as { msg: string }).msg
              : 'OK';

          return {
            ok: code === 0,
            code,
            message,
            responseJson
          } satisfies LessonProblemSubmitResult;
        } catch (error) {
          const responseJson =
            typeof error === 'object' && error !== null
              ? error
              : {
                  message: String(error)
                };
          const code =
            typeof responseJson === 'object' &&
            responseJson !== null &&
            'code' in responseJson &&
            typeof (responseJson as { code?: unknown }).code === 'number'
              ? (responseJson as { code: number }).code
              : -1;
          const message =
            typeof responseJson === 'object' &&
            responseJson !== null &&
            'msg' in responseJson &&
            typeof (responseJson as { msg?: unknown }).msg === 'string'
              ? (responseJson as { msg: string }).msg
              : (responseJson as { message?: string }).message ?? 'Request failed';

          return {
            ok: false,
            code,
            message,
            responseJson
          } satisfies LessonProblemSubmitResult;
        }
      }

      const csrftoken = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] ?? '';
      try {
        const response = await fetch('/api/v3/lesson/problem/answer', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'content-type': 'application/json;charset=UTF-8',
            'x-csrftoken': csrftoken,
            xtbz: 'ykt',
            'xt-agent': 'web',
            'x-client': 'web',
            'university-id': '0'
          },
          body: JSON.stringify(input)
        });

        const text = await response.text();
        let responseJson: unknown = text;
        try {
          responseJson = JSON.parse(text);
        } catch {
          responseJson = text;
        }

        const code =
          typeof responseJson === 'object' &&
          responseJson !== null &&
          'code' in responseJson &&
          typeof (responseJson as { code?: unknown }).code === 'number'
            ? ((responseJson as { code: number }).code)
            : response.ok
              ? 0
              : response.status;

        const message =
          typeof responseJson === 'object' &&
          responseJson !== null &&
          'msg' in responseJson &&
          typeof (responseJson as { msg?: unknown }).msg === 'string'
            ? ((responseJson as { msg: string }).msg)
            : response.ok
              ? 'OK'
              : `HTTP ${response.status}`;

        return {
          ok: response.ok && code === 0,
          code,
          message,
          responseJson
        } satisfies LessonProblemSubmitResult;
      } catch (error) {
        return {
          ok: false,
          code: -1,
          message: error instanceof Error ? error.message : 'Request failed',
          responseJson: {
            error: error instanceof Error ? error.message : String(error)
          }
        } satisfies LessonProblemSubmitResult;
      }
    }, payload);
  }

  private async disableCurrentPageQuestionDetector() {
    if (!this.page) {
      return;
    }

    await this.page
      .evaluate(() => {
        const pageWindow = window as typeof window & {
          __ykspriteQuestionDetector?: { disable?: () => void };
        };
        pageWindow.__ykspriteQuestionDetector?.disable?.();
      })
      .catch(() => undefined);
  }

  private resetQuestionDetectionInstallState() {
    this.questionBindingsInstalled = false;
    this.questionInitScriptInstalled = false;
  }

  private recordNetworkEvent(event: BrowserNetworkEvent) {
    this.recentNetworkEvents.push(event);
    if (this.recentNetworkEvents.length > MAX_NETWORK_EVENTS) {
      this.recentNetworkEvents.splice(0, this.recentNetworkEvents.length - MAX_NETWORK_EVENTS);
    }
  }

  private async inspectRuntimeDebug() {
    if (!this.page) {
      return {
        hasVue: false,
        routeName: null,
        routePath: null,
        storeStateKeys: [],
        interestingState: {}
      };
    }

    return this.page
      .evaluate(() => {
        const app = document.querySelector('#app') as { __vue__?: any } | null;
        const vue = app?.__vue__;
        const route = vue?.$route ?? null;
        const state = vue?.$store?.state ?? null;
        const storeStateKeys = state && typeof state === 'object' ? Object.keys(state) : [];
        const interestingKeys = storeStateKeys.filter((key) => /lesson|classroom|course|live|exam|upcoming|agent/i.test(key));

        const summarize = (value: unknown, depth = 0): unknown => {
          if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
            return value;
          }

          if (depth >= 2) {
            if (Array.isArray(value)) {
              return {
                type: 'array',
                length: value.length
              };
            }
            return {
              type: 'object',
              keys: Object.keys(value as Record<string, unknown>).slice(0, 10)
            };
          }

          if (Array.isArray(value)) {
            return {
              type: 'array',
              length: value.length,
              sample: value.slice(0, 3).map((item) => summarize(item, depth + 1))
            };
          }

          if (typeof value === 'object') {
            const entries = Object.entries(value as Record<string, unknown>).slice(0, 10);
            return {
              type: 'object',
              keys: entries.map(([key]) => key),
              sample: Object.fromEntries(entries.map(([key, child]) => [key, summarize(child, depth + 1)]))
            };
          }

          return String(value);
        };

        return {
          hasVue: Boolean(vue),
          routeName: route?.name ?? null,
          routePath: route?.path ?? null,
          storeStateKeys,
          interestingState: Object.fromEntries(interestingKeys.map((key) => [key, summarize(state[key])]))
        };
      })
      .catch(() => ({
        hasVue: false,
        routeName: null,
        routePath: null,
        storeStateKeys: [],
        interestingState: {}
      }));
  }

  private attachPageNetworkListeners(page: Page) {
    page.on('requestfinished', async (request: Request) => {
      const response = await request.response().catch(() => null);
      const contentType = response?.headers()?.['content-type'] ?? null;
      let bodyPreview: string | null = null;
      if (response && ['xhr', 'fetch'].includes(request.resourceType?.() ?? '')) {
        try {
          const text = await response.text();
          bodyPreview = text.slice(0, MAX_NETWORK_BODY_PREVIEW);
        } catch {
          bodyPreview = null;
        }
      }
      this.recordNetworkEvent({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType?.() ?? null,
        status: response?.status() ?? null,
        ok: response ? response.ok() : null,
        contentType,
        bodyPreview,
        failureText: null,
        at: new Date().toISOString()
      });
    });

    page.on('requestfailed', (request: Request) => {
      this.recordNetworkEvent({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType?.() ?? null,
        status: null,
        ok: false,
        contentType: null,
        bodyPreview: null,
        failureText: request.failure()?.errorText ?? 'request failed',
        at: new Date().toISOString()
      });
    });
  }

  private async ensureQuestionDetection() {
    if (!this.questionDetectionEnabled || !this.page) {
      return;
    }

    if (!this.questionBindingsInstalled) {
      await this.page.exposeBinding(QUESTION_DETECTION_BINDING, async (_source, payload: DetectedQuestionEvent) => {
        if (!this.questionDetectionEnabled || !this.onQuestionDetected) {
          return;
        }

        await this.onQuestionDetected(payload);
      });
      await this.page.exposeBinding(ACTIVE_LESSON_DETECTION_BINDING, async (_source, payload: DetectedActiveLessonEvent) => {
        if (!this.questionDetectionEnabled || !payload.lessonHref || this.page?.url() === payload.lessonHref) {
          return;
        }

        await this.scheduleActiveLessonEntry(payload);
      });
      await this.page.exposeBinding(LESSON_ENDED_DETECTION_BINDING, async () => {
        if (!this.questionDetectionEnabled) {
          return;
        }

        await this.navigateHome();
      });
      this.questionBindingsInstalled = true;
    }

    if (!this.questionInitScriptInstalled) {
      await this.page.addInitScript(installQuestionDetector, {
        questionBindingName: QUESTION_DETECTION_BINDING,
        lessonBindingName: ACTIVE_LESSON_DETECTION_BINDING
      });
      this.questionInitScriptInstalled = true;
    }

    await this.page
      .evaluate(installQuestionDetector, {
        questionBindingName: QUESTION_DETECTION_BINDING,
        lessonBindingName: ACTIVE_LESSON_DETECTION_BINDING
      })
      .catch(() => undefined);
  }

  private async emitCurrentQuestionSnapshot() {
    if (!this.questionDetectionEnabled || !this.onQuestionDetected) {
      return;
    }

    const event = buildDetectedQuestionEvent(await this.readExerciseRuntimeState().catch(() => null));
    if (!event) {
      return;
    }

    await this.onQuestionDetected(event);
  }

  private async cleanup() {
    if (this.activeLessonEntryTimeout) {
      clearTimeout(this.activeLessonEntryTimeout);
      this.activeLessonEntryTimeout = null;
    }
    if (this.page && this.visibleLoginAutoSaveHandler) {
      this.page.off('framenavigated', this.visibleLoginAutoSaveHandler);
      this.page.off('load', this.visibleLoginAutoSaveHandler);
    }
    await this.disableCurrentPageQuestionDetector().catch(() => undefined);
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
    this.recentNetworkEvents = [];
    this.visibleLoginAutoSaveHandler = null;
    this.lastSavedSessionFingerprint = null;
    this.pendingActiveLessonKey = null;
    this.resetQuestionDetectionInstallState();
  }

  private async scheduleActiveLessonEntry(payload: DetectedActiveLessonEvent) {
    const lessonKey = `${payload.lessonId}:${payload.lessonHref}`;
    if (this.pendingActiveLessonKey === lessonKey || this.page?.url() === payload.lessonHref) {
      return;
    }

    if (this.activeLessonEntryTimeout) {
      clearTimeout(this.activeLessonEntryTimeout);
      this.activeLessonEntryTimeout = null;
    }

    this.pendingActiveLessonKey = lessonKey;
    const delaySeconds = Math.max(1, Math.ceil(this.activeLessonEnterDelayMs / 1000));
    this.traceStore?.record('classroom_detected', `检测到课堂，${delaySeconds}秒后进入课堂`, {
      lessonId: payload.lessonId,
      href: payload.lessonHref,
      delayMs: this.activeLessonEnterDelayMs
    });

    await new Promise<void>((resolve) => {
      this.activeLessonEntryTimeout = setTimeout(() => {
        this.activeLessonEntryTimeout = null;
        resolve();
      }, this.activeLessonEnterDelayMs);
    });

    if (!this.questionDetectionEnabled || !this.page || this.pendingActiveLessonKey !== lessonKey) {
      return;
    }

    this.pendingActiveLessonKey = null;
    if (this.page.url() === payload.lessonHref) {
      return;
    }

    await this.navigate(payload.lessonHref);
    this.traceStore?.record('classroom_entered', '已成功进入课堂', {
      lessonId: payload.lessonId,
      href: payload.lessonHref
    });
    await this.emitCurrentQuestionSnapshot();
  }

  private attachVisibleLoginAutoSave(page: Page) {
    const handler = async () => {
      await this.maybeAutoSaveVisibleLoginSession();
    };

    this.visibleLoginAutoSaveHandler = handler;
    page.on('framenavigated', handler);
    page.on('load', handler);
  }

  private buildSessionFingerprint(cookies: BrowserCookie[] | Awaited<ReturnType<BrowserContext['cookies']>>) {
    return JSON.stringify(
      cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.domain,
        path: cookie.path
      }))
    );
  }

  private async persistCurrentSession(): Promise<SessionState | null> {
    if (!this.context) {
      return null;
    }

    const cookies = await this.context.cookies();
    const currentUrl = this.page?.url() ?? this.resolveCurrentPlatform().originUrl;
    const origin = new URL(currentUrl).hostname;
    const pageTitle = this.page ? await this.page.title().catch(() => null) : null;
    const saved = await this.sessionStore.save({
      cookies,
      savedAt: new Date().toISOString(),
      origin,
      currentUrl,
      pageTitle,
      mode: this.status.mode
    });

    this.lastSavedSessionFingerprint = this.buildSessionFingerprint(cookies);

    return {
      hasSession: saved.cookies.length > 0,
      savedAt: saved.savedAt,
      origin: saved.origin,
      cookieCount: saved.cookies.length,
      currentUrl,
      pageTitle,
      mode: this.status.mode
    };
  }

  private async maybeAutoSaveVisibleLoginSession() {
    if (!this.context || !this.page || !['visible-login', 'qr-login'].includes(this.status.mode ?? '')) {
      return;
    }

    const currentUrl = this.page.url();
    if (!currentUrl || currentUrl === 'about:blank' || currentUrl === this.resolveCurrentPlatform().loginUrl) {
      return;
    }

    let hostname: string;
    try {
      hostname = new URL(currentUrl).hostname;
    } catch {
      return;
    }

    if (!hostname.endsWith('yuketang.cn')) {
      return;
    }

    const cookies = await this.context.cookies().catch(() => []);
    if (cookies.length === 0) {
      return;
    }

    const fingerprint = this.buildSessionFingerprint(cookies);
    if (fingerprint === this.lastSavedSessionFingerprint) {
      return;
    }

    if (this.accountLoginState.loginSessionId && this.accountRepository) {
      const currentUrl = this.page?.url() ?? this.resolveCurrentPlatform().originUrl;
      const pageTitle = this.page ? await this.page.title().catch(() => null) : null;
      const identity = this.page ? await this.extractLoggedInAccountIdentity(this.page).catch(() => null) : null;

      const persisted = this.accountRepository.saveSessionForLogin({
        cookies,
        savedAt: new Date().toISOString(),
        origin: hostname,
        currentUrl,
        pageTitle,
        mode: this.status.mode
      }, identity);
      const persistedAccountId = persisted.accountId > 0 ? persisted.accountId : null;

      this.accountLoginState = {
        loginSessionId: this.accountLoginState.loginSessionId,
        accountId: persistedAccountId,
        status: 'completed',
        qrCodeDataUrl: this.accountLoginState.qrCodeDataUrl,
        lastError: null,
        notice: persisted.refreshedExistingAccount ? '重复账号，已刷新会话' : null,
        updatedAt: new Date().toISOString()
      };

      if (persistedAccountId) {
        await this.onAccountSessionSaved?.(persistedAccountId);
      }

      await this.cleanup();
      this.status = createIdleStatus();
      return;
    }

    await this.persistCurrentSession();
  }

  private async fetchLoginQrCodeDataUrl(loginSessionId: string) {
    const qrPageUrl = await this.requestLoginQrCodePageUrl(this.resolveCurrentPlatform());
    return this.readLoginQrCodeDataUrlFromPage(loginSessionId, qrPageUrl);
  }

  private async requestLoginQrCodePageUrl(platform: RainClassroomPlatform) {
    const headers = {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      accept: 'application/json, text/plain, */*',
      referer: platform.loginUrl
    };
    const authResponse = await fetch(`${platform.originUrl}/api/v3/user/login/wechat-auth-param`, {
      method: 'POST',
      headers
    });
    const authPayload = (await authResponse.json().catch(() => null)) as
      | {
          code?: number;
          data?: { appId?: string; state?: string; redirectUri?: string };
        }
      | null;
    if (!authResponse.ok || authPayload?.code !== 0 || !authPayload.data?.appId || !authPayload.data?.state || !authPayload.data?.redirectUri) {
      throw new Error('Unable to request login QR parameters');
    }

    const params = new URLSearchParams({
      appid: authPayload.data.appId,
      scope: 'snsapi_login',
      redirect_uri: `${authPayload.data.redirectUri}?path=%2Fauthorize%2Fwx-qrlogin%3Fsuccess%3D1`,
      state: authPayload.data.state,
      login_type: 'jssdk',
      self_redirect: 'true',
      stylelite: '1'
    });
    return `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}`;
  }

  private resolveCurrentPlatform() {
    return (
      resolveRainClassroomPlatformByUrl(this.page?.url()) ??
      resolveRainClassroomPlatformByUrl(this.status.pageUrl) ??
      resolveRainClassroomPlatformByOrigin(this.accountLoginState.status === 'pending' ? this.currentLoginPlatform.host : null) ??
      getRainClassroomPlatform('rain-classroom')
    );
  }

  private async readLoginQrCodeDataUrlFromPage(loginSessionId: string, qrPageUrl: string) {
    if (!this.page) {
      throw new Error('QR login page is unavailable');
    }

    await this.page.waitForFunction(
      () => Boolean(document.querySelector('img.js_qrcode_img')),
      undefined,
      { timeout: 10000 }
    );
    const imageSrc = await this.page.evaluate(() => {
      return document.querySelector('img.js_qrcode_img')?.getAttribute('src') ?? null;
    });
    const imageUrl = imageSrc ? new URL(imageSrc, 'https://open.weixin.qq.com').toString() : null;
    if (!imageUrl) {
      throw new Error('Unable to extract QR image URL');
    }

    const headers = {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      accept: 'application/json, text/plain, */*',
      referer: qrPageUrl
    };
    const imageResponse = await fetch(imageUrl, {
      headers
    });
    if (!imageResponse.ok) {
      throw new Error('Unable to download QR image');
    }

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = imageResponse.headers.get('content-type') ?? 'image/jpeg';
    const qrCodeDataUrl = `data:${contentType};base64,${imageBuffer.toString('base64')}`;

    if (!qrCodeDataUrl) {
      throw new Error('Unable to extract QR code image data');
    }

    await this.saveQrCodeBackup(loginSessionId, qrCodeDataUrl);
    return qrCodeDataUrl;
  }

  private async saveQrCodeBackup(loginSessionId: string, qrCodeDataUrl: string) {
    const match = qrCodeDataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
    if (!match) {
      return;
    }

    const [, mimeType, base64Payload] = match;
    const extension = mimeType.split('/')[1]?.split('+')[0] ?? 'png';
    const outputDir = path.resolve(process.cwd(), '.tmp/qr-login');
    const outputPath = path.join(outputDir, `${loginSessionId}.${extension}`);

    await mkdir(outputDir, { recursive: true });
    await writeFile(outputPath, Buffer.from(base64Payload, 'base64'));
  }

  private async extractLoggedInAccountIdentity(page: Page): Promise<AccountIdentity | null> {
    return page.evaluate<AccountIdentity | null>(async () => {
      const requestJson = async (url: string) => {
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
          return null;
        }

        return response.json().catch(() => null);
      };

      const basicInfoPayload = await requestJson('/api/v3/user/basic-info');
      const basicInfo = basicInfoPayload?.code === 0 ? basicInfoPayload.data : null;
      const basicUserId =
        typeof basicInfo?.id === 'string' || typeof basicInfo?.id === 'number' ? String(basicInfo.id) : null;
      const basicName = typeof basicInfo?.name === 'string' ? basicInfo.name.trim() : null;
      if (basicUserId || basicName) {
        return {
          userId: basicUserId,
          name: basicName
        };
      }

      const webUserinfoPayload = await requestJson('/v2/api/web/userinfo');
      const webUserinfo = Array.isArray(webUserinfoPayload?.data) ? webUserinfoPayload.data[0] : null;
      const webUserId =
        typeof webUserinfo?.user_id === 'string' || typeof webUserinfo?.user_id === 'number'
          ? String(webUserinfo.user_id)
          : null;
      const webName = typeof webUserinfo?.name === 'string' ? webUserinfo.name.trim() : null;
      if (webUserId || webName) {
        return {
          userId: webUserId,
          name: webName
        };
      }

      const selectorGroups = [
        '.user-info .name',
        '.user-name',
        '.profile-name',
        '.nickname',
        '.name-box .name',
        '[class*="user"] [class*="name"]',
        '[class*="profile"] [class*="name"]'
      ];

      for (const selector of selectorGroups) {
        const node = document.querySelector(selector);
        const text = node?.textContent?.trim() ?? '';
        if (text && !/雨课堂|课堂|首页|课程|我的/.test(text)) {
          return {
            userId: null,
            name: text
          };
        }
      }

      const candidates = Array.from(document.querySelectorAll('span, div, a'))
        .map((node) => node.textContent?.trim() ?? '')
        .filter((text) => text.length >= 2 && text.length <= 24)
        .filter((text) => !/雨课堂|课堂|首页|课程|我的|下载|English|登录|扫码/.test(text));

      return {
        userId: null,
        name: candidates[0] ?? null
      };
    });
  }
}
