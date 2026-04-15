import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
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
} from './browser-controller.js';
import { SessionStore } from './session-store.js';

type LaunchBrowser = typeof chromium.launch;

type BrowserManagerOptions = {
  launchBrowser?: LaunchBrowser;
  sessionStore?: SessionStore;
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

const LOGIN_PAGE_URL = 'https://www.yuketang.cn/web';
const HOME_PAGE_URL = 'https://www.yuketang.cn/v2/web/index';

const EXERCISE_READY_RETRIES = 6;

export class BrowserManager implements BrowserController {
  private readonly launchBrowser: LaunchBrowser;
  private readonly sessionStore: SessionStore;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private status: BrowserStatus = createIdleStatus();

  constructor(options: BrowserManagerOptions = {}) {
    this.launchBrowser = options.launchBrowser ?? chromium.launch.bind(chromium);
    this.sessionStore = options.sessionStore ?? new SessionStore();
  }

  getStatus(): BrowserStatus {
    return { ...this.status };
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
        await this.context.addCookies(session.cookies);
      }
      this.page = await this.context.newPage();
      await this.page.goto('about:blank');

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'headless',
        startedAt: new Date().toISOString(),
        pageUrl: this.page.url(),
        lastError: null
      };
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

    this.status = {
      ...this.status,
      status: 'starting',
      lastError: null
    };

    try {
      this.browser = await this.launchBrowser({ headless: false });
      this.context = await this.browser.newContext();
      this.page = await this.context.newPage();
      await this.page.goto(LOGIN_PAGE_URL);

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
        mode: 'visible-login',
        startedAt: new Date().toISOString(),
        pageUrl: this.page.url(),
        lastError: null
      };
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

  async stop(): Promise<BrowserStatus> {
    if (this.status.status === 'idle' || this.status.status === 'stopping') {
      return this.getStatus();
    }

    this.status = {
      ...this.status,
      status: 'stopping'
    };

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
    if (!this.context) {
      return this.getSessionState();
    }

    const cookies = await this.context.cookies();
    const currentUrl = this.page?.url() ?? 'https://www.yuketang.cn';
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

    return {
      hasSession: true,
      savedAt: saved.savedAt,
      origin: saved.origin,
      cookieCount: saved.cookies.length,
      currentUrl,
      pageTitle,
      mode: this.status.mode
    };
  }

  async navigateHome(): Promise<BrowserStatus> {
    if (!this.page) {
      return this.getStatus();
    }

    await this.page.goto(HOME_PAGE_URL);
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
        if (lessons.length > 0) {
          return lessons
            .filter((lesson) => lesson.lessonId)
            .map((lesson) => ({
              id: lesson.lessonId!,
              courseTitle: lesson.courseName ?? lesson.classroomName ?? '未命名课程',
              lessonTitle: lesson.classroomName ?? lesson.courseName ?? null,
              lessonState: 'in_class',
              href: `${location.origin}/lesson/fullscreen/v3/${lesson.lessonId}`
            } satisfies LessonCandidate));
        }
      }

      const cards = Array.from(document.querySelectorAll('[data-lesson-id], a[href*="/lesson/"]'));
      return cards.map((node, index) => {
        const text = node.textContent?.trim() ?? '';
        return {
          id: node.getAttribute('data-lesson-id') ?? `candidate-${index}`,
          courseTitle: text || '未命名课程',
          lessonTitle: null,
          lessonState: /上课中|进行中/.test(text) ? 'in_class' : /待上课|即将开始/.test(text) ? 'waiting' : 'unknown',
          href: node instanceof HTMLAnchorElement ? node.href : node.getAttribute('href')
        } satisfies LessonCandidate;
      });
    });
  }

  async listExerciseEntries(): Promise<ExerciseEntry[]> {
    if (!this.page) {
      return [];
    }

    return this.page.evaluate(() => {
      const lessonMatch = location.pathname.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/);
      const lessonId = lessonMatch?.[1] ?? null;

      return Array.from(document.querySelectorAll('.timeline__item.J_slide')).flatMap((item, index) => {
        const problem = item.querySelector('.timeline__ppt.problem');
        if (!problem) {
          return [];
        }

        const text = (problem.textContent ?? '').trim();
        const status = /未完成/.test(text) ? 'unanswered' : /已完成/.test(text) ? 'answered' : /结束/.test(text) ? 'expired' : 'unanswered';
        const img = problem.querySelector('img.cover');
        const isActive = item.classList.contains('active');
        const pageHint = problem.querySelector('.ppt--pageno')?.textContent?.trim() ?? null;
        const remainingHint = problem.querySelector('.timeline__footer p')?.textContent?.trim() ?? null;
        const exerciseId = isActive && /\/exercise\/([^/?#]+)/.test(location.pathname)
          ? location.pathname.match(/\/exercise\/([^/?#]+)/)?.[1] ?? null
          : item.getAttribute('data-index');

        return [
          {
            entryId: `timeline-${item.getAttribute('data-index') ?? index}`,
            lessonId,
            status,
            isActive,
            pageHint,
            remainingHint,
            thumbnailUrl: img?.getAttribute('src') ?? null,
            exerciseUrl: exerciseId && lessonId ? `${location.origin}/lesson/fullscreen/v3/${lessonId}/exercise/${exerciseId}` : null
          } satisfies ExerciseEntry
        ];
      });
    });
  }

  async inspectPage(): Promise<PageSnapshot> {
    return {
      currentUrl: this.page?.url() ?? null,
      pageTitle: this.page ? await this.page.title().catch(() => null) : null,
      html: this.page ? await this.page.content().catch(() => null) : null,
      text: this.page ? await this.page.locator('body').innerText().catch(() => null) : null
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
      await this.page.goto(url, { waitUntil: 'domcontentloaded' });
      await this.page.mouse.click(100, 100).catch(() => undefined);
      await this.page.keyboard.press('Tab').catch(() => undefined);
      await this.page.waitForTimeout(250);

      for (let attempt = 0; attempt < EXERCISE_READY_RETRIES; attempt += 1) {
        const runtimeState = await this.readExerciseRuntimeState();
        if (runtimeState) {
          this.status = {
            ...this.status,
            pageUrl: this.page.url()
          };
          return runtimeState;
        }

        await this.page.mouse.click(100, 100).catch(() => undefined);
        await this.page.waitForTimeout(250);
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
      const app = document.querySelector('#app') as { __vue__?: any } | null;
      const vue = app?.__vue__;
      if (!vue?.$store) {
        return null;
      }

      const route = vue.$route;
      if (!route || route.name !== 'exercise') {
        return null;
      }

      const root = vue.$children?.[0] ?? vue;
      const cards = vue.$store.state?.cards ?? [];
      const routeIndex = Number(route.params?.index ?? -1);
      const card = cards[routeIndex];
      const problemId = card?.problemID || vue.$store.state?.currSlide?.problemID || null;
      if (!problemId) {
        return null;
      }

      const problem = root.problemMap?.get?.(problemId)?.problem;
      const optionList = (problem?.options ?? card?.options ?? [])
        .map((option: { key?: string; value?: string; label?: string }) => ({
          key: option.key ?? option.label ?? '',
          value: option.value ?? option.label ?? option.key ?? ''
        }))
        .filter((option: { key: string; value: string }) => option.key || option.value);

      return {
        lessonId: route.params?.lessonID ?? null,
        exerciseIndex: route.params?.index ?? null,
        problemId,
        problemType: Number(problem?.problemType ?? card?.problemType ?? 0),
        pageIndex: card?.pageIndex ?? null,
        questionText: String(problem?.body ?? card?.body ?? '').trim(),
        options: optionList,
        isComplete: Boolean(card?.isComplete ?? false),
        routePath: route.path ?? null
      } satisfies ExerciseRuntimeState;
    });
  }

  async submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult> {
    if (!this.page) {
      throw new Error('Browser page is not available');
    }

    return this.page.evaluate(async (input) => {
      const csrftoken = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] ?? '';
      const response = await fetch('/api/v3/lesson/problem/answer', {
        method: 'POST',
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
    }, payload);
  }

  private async cleanup() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
