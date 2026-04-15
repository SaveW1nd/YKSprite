import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../../apps/service/src/browser/browser-manager';
import { SessionStore } from '../../apps/service/src/browser/session-store';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

type FakePage = {
  evaluate: ReturnType<typeof vi.fn>;
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
    evaluate: vi.fn().mockResolvedValue([]),
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
    expect(runtime.page.goto).toHaveBeenCalledWith('https://www.yuketang.cn/web');
    expect(status).toMatchObject({
      status: 'running',
      mode: 'visible-login'
    });
  });

  it('discovers in-progress lessons from the logged-in home page', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
    runtime.page.title.mockResolvedValue('雨课堂');
    runtime.page.evaluate.mockImplementation(async (fn: () => unknown) => fn());
    document.body.innerHTML = `
      <div class="onlesson">
        <div class="jump_lesson__bar box-between">
          <div class="name-box"><span class="tag">听</span><span class="name">test-test</span></div>
        </div>
      </div>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            onLessonClassrooms: [
              {
                classroomId: '31162479',
                classroomName: 'test',
                courseId: '5540212',
                courseName: 'test',
                lessonId: '1663915035887646208'
              }
            ]
          }
        })
      })
    );

    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    await manager.start();

    await expect(manager.discoverLessons()).resolves.toEqual([
      expect.objectContaining({
        id: '1663915035887646208',
        courseTitle: 'test',
        lessonTitle: 'test',
        lessonState: 'in_class',
        href: expect.stringContaining('/lesson/fullscreen/v3/1663915035887646208')
      })
    ]);
  });

  it('navigates back to the logged-in home page', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    await manager.navigateHome();

    expect(runtime.page.goto).toHaveBeenLastCalledWith('https://www.yuketang.cn/v2/web/index');
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
