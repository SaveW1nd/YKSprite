import { describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../../apps/service/src/browser/browser-manager';
import { SessionStore } from '../../apps/service/src/browser/session-store';

type FakePage = {
  goto: ReturnType<typeof vi.fn>;
  title: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
};

type FakeContext = {
  addCookies: ReturnType<typeof vi.fn>;
  cookies: ReturnType<typeof vi.fn>;
  newPage: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

type FakeBrowser = {
  newContext: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

const createRuntime = () => {
  const page: FakePage = {
    goto: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('雨课堂'),
    url: vi.fn().mockReturnValue('https://www.yuketang.cn')
  };

  const context: FakeContext = {
    addCookies: vi.fn().mockResolvedValue(undefined),
    cookies: vi.fn().mockResolvedValue([
      {
        name: 'sessionid',
        value: 'cookie-value',
        domain: '.yuketang.cn',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'Lax'
      }
    ]),
    newPage: vi.fn().mockResolvedValue(page),
    close: vi.fn().mockResolvedValue(undefined)
  };

  const browser: FakeBrowser = {
    newContext: vi.fn().mockResolvedValue(context),
    close: vi.fn().mockResolvedValue(undefined)
  };

  return {
    browser,
    context,
    page,
    launch: vi.fn().mockResolvedValue(browser)
  };
};

describe('BrowserManager', () => {
  it('starts as idle', () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    expect(manager.getStatus()).toMatchObject({
      status: 'idle',
      engine: 'chromium',
      headless: true,
      mode: null,
      pageUrl: null,
      lastError: null
    });
  });

  it('starts the browser and moves to running', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    const status = await manager.start();

    expect(runtime.launch).toHaveBeenCalledTimes(1);
    expect(runtime.browser.newContext).toHaveBeenCalledTimes(1);
    expect(runtime.context.newPage).toHaveBeenCalledTimes(1);
    expect(runtime.page.goto).toHaveBeenCalledWith('about:blank');
    expect(status).toMatchObject({
      status: 'running',
      mode: 'headless',
      pageUrl: 'https://www.yuketang.cn',
      lastError: null
    });
  });

  it('starts a visible login browser session', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    const status = await manager.startLogin();

    expect(runtime.launch).toHaveBeenCalledWith({ headless: false });
    expect(status).toMatchObject({
      status: 'running',
      mode: 'visible-login'
    });
  });

  it('is idempotent when start is called repeatedly', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    const status = await manager.start();

    expect(runtime.launch).toHaveBeenCalledTimes(1);
    expect(status.status).toBe('running');
  });

  it('stops the browser and returns to idle', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    const status = await manager.stop();

    expect(runtime.context.close).toHaveBeenCalledTimes(1);
    expect(runtime.browser.close).toHaveBeenCalledTimes(1);
    expect(status).toMatchObject({
      status: 'idle',
      mode: null,
      pageUrl: null,
      lastError: null
    });
  });

  it('records the startup error when launch fails', async () => {
    const manager = new BrowserManager({
      launchBrowser: vi.fn().mockRejectedValue(new Error('launch failed'))
    });

    const status = await manager.start();

    expect(status).toMatchObject({
      status: 'error',
      lastError: 'launch failed'
    });
  });

  it('saves the current browser session to the session store', async () => {
    const runtime = createRuntime();
    const sessionStore = new SessionStore({ readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() });
    const manager = new BrowserManager({ launchBrowser: runtime.launch, sessionStore });

    await manager.startLogin();
    const state = await manager.saveSession();

    expect(state).toMatchObject({
      hasSession: true,
      origin: 'www.yuketang.cn',
      cookieCount: 1
    });
  });

  it('loads persisted cookies when starting headless mode', async () => {
    const runtime = createRuntime();
    const sessionStore = new SessionStore({ readFile: vi.fn(), writeFile: vi.fn(), mkdir: vi.fn() });
    vi.spyOn(sessionStore, 'load').mockResolvedValue({
      cookies: [
        {
          name: 'sessionid',
          value: 'persisted-cookie',
          domain: '.yuketang.cn',
          path: '/',
          expires: -1,
          httpOnly: true,
          secure: true,
          sameSite: 'Lax'
        }
      ],
      savedAt: '2026-04-14T00:00:00.000Z',
      origin: 'yuketang.cn'
    });

    const manager = new BrowserManager({ launchBrowser: runtime.launch, sessionStore });

    await manager.start();

    expect(runtime.context.addCookies).toHaveBeenCalledTimes(1);
    expect(runtime.context.addCookies).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'sessionid',
          value: 'persisted-cookie'
        })
      ])
    );
  });
});
