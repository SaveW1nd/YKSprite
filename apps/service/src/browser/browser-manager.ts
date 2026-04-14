import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserController, BrowserStatus, PageSnapshot, ScreenshotPayload, SessionState } from './browser-controller.js';
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
      await this.page.goto('https://www.yuketang.cn');

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

  async inspectPage(): Promise<PageSnapshot> {
    return {
      currentUrl: this.page?.url() ?? null,
      pageTitle: this.page ? await this.page.title().catch(() => null) : null,
      html: this.page ? await this.page.content().catch(() => null) : null
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

  private async cleanup() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
