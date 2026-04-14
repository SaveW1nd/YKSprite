import { chromium } from 'playwright';
import type { Browser, BrowserContext, Page } from 'playwright';
import type { BrowserController, BrowserStatus } from './browser-controller.js';

type LaunchBrowser = typeof chromium.launch;

type BrowserManagerOptions = {
  launchBrowser?: LaunchBrowser;
};

const createIdleStatus = (): BrowserStatus => ({
  status: 'idle',
  engine: 'chromium',
  headless: true,
  startedAt: null,
  pageUrl: null,
  lastError: null
});

export class BrowserManager implements BrowserController {
  private readonly launchBrowser: LaunchBrowser;
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private status: BrowserStatus = createIdleStatus();

  constructor(options: BrowserManagerOptions = {}) {
    this.launchBrowser = options.launchBrowser ?? chromium.launch.bind(chromium);
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
      this.page = await this.context.newPage();
      await this.page.goto('about:blank');

      this.status = {
        status: 'running',
        engine: 'chromium',
        headless: true,
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
        startedAt: null,
        pageUrl: null,
        lastError: error instanceof Error ? error.message : 'Unknown browser launch error'
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

  private async cleanup() {
    await this.context?.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
    this.context = null;
    this.browser = null;
    this.page = null;
  }
}
