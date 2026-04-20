import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../../apps/service/src/browser/browser-manager';
import { SessionStore } from '../../apps/service/src/browser/session-store';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

type FakePage = {
  addInitScript: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  exposeBinding: ReturnType<typeof vi.fn>;
  goto: ReturnType<typeof vi.fn>;
  keyboard: {
    press: ReturnType<typeof vi.fn>;
  };
  mouse: {
    click: ReturnType<typeof vi.fn>;
  };
  off: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  waitForFunction: ReturnType<typeof vi.fn>;
  waitForTimeout: ReturnType<typeof vi.fn>;
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
    addInitScript: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue([]),
    exposeBinding: vi.fn().mockImplementation(async (name: string, handler: (...args: unknown[]) => unknown) => {
      const binding = (...args: unknown[]) => handler({}, ...args);
      vi.stubGlobal(name, binding);
      Object.assign(window as Window & Record<string, unknown>, { [name]: binding });
    }),
    goto: vi.fn().mockResolvedValue(undefined),
    keyboard: {
      press: vi.fn().mockResolvedValue(undefined)
    },
    mouse: {
      click: vi.fn().mockResolvedValue(undefined)
    },
    off: vi.fn(),
    on: vi.fn(),
    waitForFunction: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
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

  it('fetches qr code data from the browser qr page and saves a local backup', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'yksprite-qr-'));
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue('/connect/qrcode/browser-code');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            appId: 'wx-app-id',
            state: 'state-token',
            redirectUri: 'https://www.yuketang.cn/api/v3/user/login/wechat-web-callback'
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/png' : null)
        },
        arrayBuffer: async () => Uint8Array.from(Buffer.from('fake-image')).buffer
      });
    vi.stubGlobal('fetch', fetchMock);

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
    const accountRepository = {
      saveSession: vi.fn().mockReturnValue({
        accountId: 9,
        refreshedExistingAccount: false
      }),
      markLoginFailure: vi.fn()
    };
    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: accountRepository as any
    });

    const state = await manager.startAccountLogin();

    expect(state).toMatchObject({
      status: 'pending',
      lastError: null
    });
    expect(state.qrCodeDataUrl).toBe(`data:image/png;base64,${Buffer.from('fake-image').toString('base64')}`);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(runtime.page.goto).toHaveBeenLastCalledWith(
      expect.stringContaining('https://open.weixin.qq.com/connect/qrconnect?')
    );
    expect(runtime.page.waitForFunction).toHaveBeenCalled();
    expect(runtime.page.evaluate).toHaveBeenCalled();
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://open.weixin.qq.com/connect/qrcode/browser-code');
    expect(readFileSync(path.join(tempRoot, `.tmp/qr-login/${state.loginSessionId}.png`), 'base64')).toBe(
      Buffer.from('fake-image').toString('base64')
    );

    cwdSpy.mockRestore();
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it('requests the qr login page from the selected rain classroom platform', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue('/connect/qrcode/browser-code');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            appId: 'wx-app-id',
            state: 'state-token',
            redirectUri: 'https://changjiang.yuketang.cn/api/v3/user/login/wechat-web-callback'
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/png' : null)
        },
        arrayBuffer: async () => Uint8Array.from(Buffer.from('fake-image')).buffer
      });
    vi.stubGlobal('fetch', fetchMock);

    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: {
        saveSessionForLogin: vi.fn().mockReturnValue({ accountId: 1, refreshedExistingAccount: false }),
        markLoginFailure: vi.fn()
      } as any
    });

    await manager.startAccountLogin({ platform: 'changjiang-rain-classroom' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://changjiang.yuketang.cn/api/v3/user/login/wechat-auth-param',
      expect.objectContaining({
        headers: expect.objectContaining({
          referer: 'https://changjiang.yuketang.cn/web'
        })
      })
    );
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

  it('opens the matching wechat qr page in the browser during account qr login', async () => {
    const runtime = createRuntime();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            appId: 'wx-app-id',
            state: 'state-token',
            redirectUri: 'https://www.yuketang.cn/api/v3/user/login/wechat-web-callback'
          }
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          '<img class="js_qrcode_img web_qrcode_img" src="/connect/qrcode/fake-code">'
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/png' : null)
        },
        arrayBuffer: async () => Uint8Array.from(Buffer.from('fake-image')).buffer
      });
    vi.stubGlobal('fetch', fetchMock);
    const accountRepository = {
      saveSession: vi.fn().mockReturnValue({
        accountId: 9,
        refreshedExistingAccount: false
      }),
      markLoginFailure: vi.fn()
    };
    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: accountRepository as any
    });

    await manager.startAccountLogin();

    expect(runtime.page.goto).toHaveBeenLastCalledWith(
      expect.stringContaining('https://open.weixin.qq.com/connect/qrconnect?')
    );
  });

  it('automatically saves the login session after navigating away from the login page', async () => {
    const runtime = createRuntime();
    let currentUrl = 'https://www.yuketang.cn/web';
    runtime.page.url.mockImplementation(() => currentUrl);
    const sessionStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({
        cookies: [
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
        ],
        savedAt: '2026-04-16T00:00:00.000Z',
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        pageTitle: '雨课堂',
        mode: 'visible-login'
      })
    } as unknown as SessionStore;
    const manager = new BrowserManager({ launchBrowser: runtime.launch, sessionStore });

    await manager.startLogin();
    currentUrl = 'https://www.yuketang.cn/v2/web/index';

    const navigateHandler = runtime.page.on.mock.calls.find(([event]) => event === 'framenavigated')?.[1] as
      | (() => Promise<void>)
      | undefined;
    expect(navigateHandler).toBeDefined();

    await navigateHandler?.();

    expect((sessionStore.save as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((sessionStore.save as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        mode: 'visible-login'
      })
    );
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

  it('extracts the current question ppt slide through the presentation fetch interface', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            presentations: [
              {
                index: '12',
                pageIndex: 12,
                problemId: 'problem-12',
                problemType: 1,
                cover: 'https://example.com/problem-12.jpg',
                thumbnail: 'https://example.com/problem-12-thumb.jpg'
              },
              {
                index: '13',
                pageIndex: 13,
                problemId: 'problem-13',
                problemType: 1,
                cover: 'https://example.com/problem-13.jpg',
                thumbnail: 'https://example.com/problem-13-thumb.jpg'
              }
            ]
          }
        })
      })
    );
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13');
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();

    await expect(manager.readCurrentQuestionPresentationSlide?.('lesson-1')).resolves.toMatchObject({
      lessonId: 'lesson-1',
      exerciseIndex: '13',
      pageIndex: 13,
      problemId: 'problem-13',
      problemType: 1,
      imageUrl: 'https://example.com/problem-13.jpg',
      imageThumbnailUrl: 'https://example.com/problem-13-thumb.jpg'
    });
  });

  it('lists lesson presentation slides through the presentation fetch interface', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            presentations: [
              {
                index: '12',
                pageIndex: 12,
                problemId: 'problem-12',
                problemType: 1,
                cover: 'https://example.com/problem-12.jpg',
                thumbnail: 'https://example.com/problem-12-thumb.jpg'
              },
              {
                index: '13',
                pageIndex: 13,
                problemId: 'problem-13',
                problemType: 1,
                cover: 'https://example.com/problem-13.jpg',
                thumbnail: 'https://example.com/problem-13-thumb.jpg'
              }
            ]
          }
        })
      })
    );
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();

    await expect(manager.listLessonPresentationSlides?.('lesson-1')).resolves.toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        exerciseIndex: '12',
        pageIndex: 12,
        imageUrl: 'https://example.com/problem-12.jpg'
      }),
      expect.objectContaining({
        lessonId: 'lesson-1',
        exerciseIndex: '13',
        pageIndex: 13,
        imageUrl: 'https://example.com/problem-13.jpg'
      })
    ]);
  });

  it('falls back to the current classroom slide image when presentation fetch data is unavailable', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate
      .mockImplementationOnce(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args))
      .mockImplementationOnce(async (fn: () => unknown) => fn());
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            presentations: []
          }
        })
      })
    );
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1/exercise/13');
    const app = document.querySelector('#app') as { __vue__?: any };
    app.__vue__ = {
      $route: {
        name: 'exercise',
        params: { lessonID: 'lesson-1', index: '13' },
        path: '/lesson/fullscreen/v3/lesson-1/exercise/13'
      },
      $store: {
        state: {
          currSlide: {
            index: 13,
            pageIndex: 13,
            problemID: 'problem-13',
            problemType: 1,
            cover: 'https://example.com/runtime-problem-13.jpg',
            src: 'https://example.com/runtime-problem-13.jpg',
            thumbnail: 'https://example.com/runtime-problem-13-thumb.jpg'
          }
        }
      },
      $children: [{}]
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();

    await expect(manager.readCurrentQuestionPresentationSlide?.('lesson-1')).resolves.toMatchObject({
      lessonId: 'lesson-1',
      exerciseIndex: '13',
      pageIndex: 13,
      problemId: 'problem-13',
      problemType: 1,
      imageUrl: 'https://example.com/runtime-problem-13.jpg',
      imageThumbnailUrl: 'https://example.com/runtime-problem-13-thumb.jpg'
    });
  });

  it('does not fall back to DOM lesson discovery when the interface returns no active lesson', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
    runtime.page.title.mockResolvedValue('雨课堂');
    runtime.page.evaluate.mockImplementation(async (fn: () => unknown) => fn());
    document.body.innerHTML = `
      <a data-lesson-id="dom-lesson" href="/lesson/fullscreen/v3/dom-lesson">
        DOM fallback lesson
      </a>
    `;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            onLessonClassrooms: []
          }
        })
      })
    );

    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    await manager.start();

    await expect(manager.discoverLessons()).resolves.toEqual([]);
  });

  it('navigates back to the logged-in home page', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    await manager.navigateHome();

    expect(runtime.page.goto).toHaveBeenLastCalledWith('https://www.yuketang.cn/v2/web/index');
  });

  it('lists exercise entries from the presentation interface without relying on the lesson timeline', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4');
    runtime.page.title.mockResolvedValue('test');
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            presentations: [
              {
                index: '4',
                pageIndex: 4,
                problemId: 'problem-4',
                problemType: 1,
                body: '第 4 题',
                options: [
                  { key: 'A', value: '选项 A' },
                  { key: 'B', value: '选项 B' }
                ],
                cover: 'https://example.com/problem-4.png',
                thumbnail: 'https://example.com/problem-4-thumb.png',
                isComplete: false
              },
              {
                index: '5',
                pageIndex: 5,
                problemId: 'problem-5',
                problemType: 5,
                body: '第 5 题',
                cover: 'https://example.com/problem-5.png',
                thumbnail: 'https://example.com/problem-5-thumb.png',
                isComplete: true
              }
            ]
          }
        })
      })
    );

    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    await manager.start();

    await expect(manager.listExerciseEntries()).resolves.toEqual([
      expect.objectContaining({
        entryId: 'presentation-4',
        status: 'unanswered',
        isActive: true,
        thumbnailUrl: 'https://example.com/problem-4-thumb.png',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4',
        runtimeState: expect.objectContaining({
          lessonId: 'lesson-1',
          exerciseIndex: '4',
          problemId: 'problem-4',
          problemType: 1,
          questionText: '第 4 题',
          options: [
            { key: 'A', value: '选项 A' },
            { key: 'B', value: '选项 B' }
          ]
        })
      }),
      expect.objectContaining({
        entryId: 'presentation-5',
        status: 'answered',
        isActive: false,
        thumbnailUrl: 'https://example.com/problem-5-thumb.png',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/5',
        runtimeState: expect.objectContaining({
          lessonId: 'lesson-1',
          exerciseIndex: '5',
          problemId: 'problem-5',
          problemType: 5,
          questionText: '第 5 题',
          options: []
        })
      })
    ]);
  });

  it('stabilizes an exercise page and reads runtime state from vue', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('about:blank');
    runtime.page.evaluate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        lessonId: 'lesson-1',
        exerciseIndex: '13',
        problemId: 'problem-13',
        problemType: 1,
        pageIndex: 6,
        questionText: '13 题题干',
        options: [
          { key: 'A', value: 'A' },
          { key: 'B', value: 'B' }
        ],
        imageUrl: null,
        imageThumbnailUrl: null,
        isComplete: false,
        routePath: '/v3/lesson-1/exercise/13'
      });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    runtime.page.goto.mockClear();
    const state = await manager.ensureExercisePageReady('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13');

    expect(runtime.page.goto).toHaveBeenCalledWith(
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13',
      { waitUntil: 'domcontentloaded' }
    );
    expect(runtime.page.waitForFunction).toHaveBeenCalled();
    expect(runtime.page.mouse.click).toHaveBeenCalled();
    expect(runtime.page.keyboard.press).toHaveBeenCalledWith('Tab');
    expect(state).toMatchObject({
      problemId: 'problem-13',
      exerciseIndex: '13'
    });
  });

  it('does not navigate again when already on the target exercise page', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13');
    runtime.page.evaluate.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '13',
      problemId: 'problem-13',
      problemType: 1,
      pageIndex: 6,
      questionText: '13 题题干',
      options: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' }
      ],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/v3/lesson-1/exercise/13'
    });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    runtime.page.goto.mockClear();
    const state = await manager.ensureExercisePageReady('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13');

    expect(runtime.page.goto).not.toHaveBeenCalled();
    expect(runtime.page.waitForFunction).toHaveBeenCalled();
    expect(state).toMatchObject({
      problemId: 'problem-13'
    });
  });

  it('navigates directly to the target exercise page without clicking the lesson timeline', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
    runtime.page.evaluate
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        lessonId: 'lesson-1',
        exerciseIndex: '13',
        problemId: 'problem-13',
        problemType: 1,
        pageIndex: 6,
        questionText: '13 题题干',
        options: [
          { key: 'A', value: 'A' },
          { key: 'B', value: 'B' }
        ],
        imageUrl: null,
        imageThumbnailUrl: null,
        isComplete: false,
        routePath: '/v3/lesson-1/exercise/13'
      });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    runtime.page.goto.mockClear();
    const state = await manager.ensureExercisePageReady('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13');

    expect(runtime.page.goto).toHaveBeenCalledWith(
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/13',
      { waitUntil: 'domcontentloaded' }
    );
    expect(runtime.page.waitForFunction).toHaveBeenCalled();
    expect(state).toMatchObject({
      exerciseIndex: '13'
    });
  });

  it('returns null when no active exercise route is available to open directly', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    runtime.page.goto.mockClear();
    const openedUrl = await manager.openCurrentExercise();

    expect(runtime.page.evaluate).not.toHaveBeenCalled();
    expect(runtime.page.waitForFunction).not.toHaveBeenCalled();
    expect(openedUrl).toBeNull();
  });

  it('submits lesson problem answers inside the page context', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue({
      ok: true,
      code: 0,
      message: 'OK',
      responseJson: { code: 0, msg: 'OK' }
    });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    const result = await manager.submitLessonProblem({
      problemId: 'problem-13',
      problemType: 1,
      dt: 1776240367580,
      result: ['B']
    });

    expect(runtime.page.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      problemId: 'problem-13',
      problemType: 1,
      dt: 1776240367580,
      result: ['B']
    });
    expect(result).toMatchObject({
      ok: true,
      code: 0
    });
  });

  it('reads runtime state from subjective routes', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/2');
    runtime.page.evaluate.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '2',
      problemId: 'problem-2',
      problemType: 5,
      pageIndex: 6,
      questionText: '请简述牛顿第一定律',
      options: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/v3/lesson-1/subjective/2'
    });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    const state = await manager.readExerciseRuntimeState();

    expect(state).toMatchObject({
      exerciseIndex: '2',
      problemType: 5,
      questionText: '请简述牛顿第一定律'
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

  it('best-effort saves the visible login session before stopping', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
    const sessionStore = {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue({
        cookies: [
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
        ],
        savedAt: '2026-04-16T00:00:00.000Z',
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        pageTitle: '雨课堂',
        mode: 'visible-login'
      })
    } as unknown as SessionStore;
    const manager = new BrowserManager({ launchBrowser: runtime.launch, sessionStore });

    await manager.startLogin();
    await manager.stop();

    expect((sessionStore.save as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
    expect((sessionStore.save as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(
      expect.objectContaining({
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        mode: 'visible-login'
      })
    );
  });

  it('saves user profile fields into the account when qr login completes', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
    runtime.page.evaluate.mockResolvedValue({
      userId: '47489393',
      name: '别点我我不会'
    });
    const accountRepository = {
      saveSessionForLogin: vi.fn().mockReturnValue({
        accountId: 9,
        refreshedExistingAccount: false
      }),
      markLoginFailure: vi.fn()
    };
    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: accountRepository as any
    });

    await manager.start();
    (manager as any).page = runtime.page;
    (manager as any).context = runtime.context;
    (manager as any).status = {
      status: 'running',
      engine: 'chromium',
      headless: true,
      mode: 'qr-login',
      startedAt: '2026-04-17T12:00:00.000Z',
      pageUrl: 'https://www.yuketang.cn/v2/web/index',
      lastError: null
    };
    (manager as any).accountLoginState = {
      loginSessionId: 'login-session-1',
      accountId: 9,
      status: 'pending',
      qrCodeDataUrl: 'data:image/png;base64,ZmFrZQ==',
      lastError: null,
      updatedAt: '2026-04-17T12:00:00.000Z'
    };

    await (manager as any).maybeAutoSaveVisibleLoginSession();

    expect(accountRepository.saveSessionForLogin).toHaveBeenCalledWith(
      expect.objectContaining({
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index'
      }),
      expect.objectContaining({
        userId: '47489393',
        name: '别点我我不会'
      })
    );
  });

  it('marks qr login completion as a duplicate account session refresh when repository merges accounts', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
    runtime.page.evaluate.mockResolvedValue({
      userId: '47489393',
      name: '别点我我不会'
    });
    const accountRepository = {
      saveSessionForLogin: vi.fn().mockReturnValue({
        accountId: 2,
        refreshedExistingAccount: true
      }),
      markLoginFailure: vi.fn()
    };
    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: accountRepository as any
    });

    await manager.start();
    (manager as any).page = runtime.page;
    (manager as any).context = runtime.context;
    (manager as any).status = {
      status: 'running',
      engine: 'chromium',
      headless: true,
      mode: 'qr-login',
      startedAt: '2026-04-17T12:00:00.000Z',
      pageUrl: 'https://www.yuketang.cn/v2/web/index',
      lastError: null
    };
    (manager as any).accountLoginState = {
      loginSessionId: 'login-session-1',
      accountId: 9,
      status: 'pending',
      qrCodeDataUrl: 'data:image/png;base64,ZmFrZQ==',
      lastError: null,
      notice: null,
      updatedAt: '2026-04-17T12:00:00.000Z'
    };

    await (manager as any).maybeAutoSaveVisibleLoginSession();

    await expect(manager.getAccountLoginState('login-session-1')).resolves.toMatchObject({
      loginSessionId: 'login-session-1',
      accountId: 2,
      status: 'completed',
      notice: '重复账号，已刷新会话'
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

  it('loads persisted cookies and opens the home page when starting headless mode', async () => {
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
    expect(runtime.page.goto).toHaveBeenCalledWith('https://www.yuketang.cn/v2/web/index');
  });

  it('starts question detection on the current page and emits the first unresolved question', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '13',
      problemId: 'problem-13',
      problemType: 1,
      pageIndex: 6,
      questionText: '13 题题干',
      options: [],
      imageUrl: 'https://example.com/problem-13.jpg',
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/v3/lesson-1/exercise/13'
    });
    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    const onEvent = vi.fn();

    await manager.start();
    await manager.startQuestionDetection(onEvent);

    expect(runtime.page.exposeBinding).toHaveBeenCalledTimes(3);
    expect(runtime.page.addInitScript).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: 'lesson-1',
        problemId: 'problem-13',
        problemType: 1,
        routePath: '/v3/lesson-1/exercise/13',
        source: 'runtime-state'
      })
    );
  });

  it('emits a pushed question from currSlide.event when the route is still on an older subjective page', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/18');
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1/subjective/18');
    const app = document.querySelector('#app') as { __vue__?: any };
    app.__vue__ = {
      $route: {
        name: 'subjective',
        params: { lessonID: 'lesson-1', index: '18' },
        path: '/lesson/fullscreen/v3/lesson-1/subjective/18'
      },
      $store: {
        state: {
          slideIndex: 18,
          currSlide: {
            pageIndex: 20,
            problemID: 'problem-20',
            problemType: 2,
            isComplete: false,
            event: {
              type: 'problem',
              prob: 'problem-20',
              sid: 'problem-20',
              si: 20,
              pres: 'presentation-1'
            }
          },
          cards: []
        }
      },
      $children: [{ problemMap: new Map() }],
      $watch: (source: () => unknown, callback: () => void, options?: { immediate?: boolean }) => {
        source();
        if (options?.immediate) {
          callback();
        }
        return () => undefined;
      }
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    const onEvent = vi.fn();

    await manager.start();
    await manager.startQuestionDetection(onEvent);

    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 2,
        routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
        pageIndex: 20,
        source: 'curr-slide-event'
      })
    );
  });

  it('emits the current slide problem when detection starts on the lesson root page', async () => {
    const runtime = createRuntime();
    let currentUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1';
    runtime.page.url.mockImplementation(() => currentUrl);
    runtime.page.goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1');
    const app = document.querySelector('#app') as { __vue__?: any };
    const problemMap = new Map([
      [
        'problem-15',
        {
          problem: {
            problemType: 1,
            body: '15 题题干',
            options: [
              { key: 'A', value: 'A' },
              { key: 'B', value: 'B' }
            ]
          },
          cover: 'https://example.com/problem-15.jpg',
          thumbnail: 'https://example.com/problem-15-thumb.jpg'
        }
      ]
    ]);
    app.__vue__ = {
      $route: {
        name: 'lesson',
        params: { lessonID: 'lesson-1' },
        path: '/lesson/fullscreen/v3/lesson-1'
      },
      $store: {
        state: {
          currSlide: {
            pageIndex: 15,
            problemID: 'problem-15',
            problemType: 1,
            isComplete: false,
            event: {
              type: 'problem',
              prob: 'problem-15',
              sid: 'problem-15',
              si: 15,
              pres: 'presentation-1'
            }
          },
          cards: []
        }
      },
      $children: [{ problemMap }],
      $watch: (source: () => unknown, callback: () => void, options?: { immediate?: boolean }) => {
        source();
        if (options?.immediate) {
          callback();
        }
        return () => undefined;
      }
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    const onEvent = vi.fn();

    await manager.start();
    runtime.page.goto.mockClear();
    await manager.startQuestionDetection(onEvent);

    const detectorInstaller = runtime.page.addInitScript.mock.calls[0]?.[0];
    expect(String(detectorInstaller)).not.toContain('.timeline__item');
    expect(String(detectorInstaller)).not.toContain('.msg__box');
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        lessonId: 'lesson-1',
        problemId: 'problem-15',
        problemType: 1,
        routePath: '/lesson/fullscreen/v3/lesson-1',
        pageIndex: 15,
        source: 'curr-slide-event'
      })
    );
  });

  it('does not emit when currSlide.event is not a problem event', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1');
    const app = document.querySelector('#app') as { __vue__?: any };
    app.__vue__ = {
      $route: {
        name: 'lesson',
        params: { lessonID: 'lesson-1' },
        path: '/lesson/fullscreen/v3/lesson-1'
      },
      $store: {
        state: {
          currSlide: {
            pageIndex: 21,
            problemID: null,
            problemType: null,
            isComplete: false,
            event: {
              type: 'slide',
              si: 21
            }
          },
          cards: []
        }
      },
      $children: [{ problemMap: new Map() }],
      $watch: () => () => undefined
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    const onEvent = vi.fn();

    await manager.start();
    await manager.startQuestionDetection(onEvent);

    expect(onEvent).not.toHaveBeenCalled();
  });

  it('reads the latest unresolved lesson card when the page stays on the lesson root route', async () => {
    const runtime = createRuntime();
    runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    document.body.innerHTML = '<div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1');
    const app = document.querySelector('#app') as { __vue__?: any };
    const problemMap = new Map([
      [
        'problem-15',
        {
          problem: {
            problemType: 1,
            body: '15 题题干',
            options: [
              { key: 'A', value: 'A' },
              { key: 'B', value: 'B' }
            ]
          },
          cover: 'https://example.com/problem-15.jpg',
          thumbnail: 'https://example.com/problem-15-thumb.jpg'
        }
      ]
    ]);
    app.__vue__ = {
      $route: {
        name: 'lesson',
        params: { lessonID: 'lesson-1' },
        path: '/lesson/fullscreen/v3/lesson-1'
      },
      $store: {
        state: {
          cards: [
            {
              problemID: 'problem-14',
              problemType: 1,
              isComplete: true,
              pageIndex: 14,
              body: '14 题题干',
              options: []
            },
            {
              problemID: 'problem-15',
              problemType: 1,
              isComplete: false,
              pageIndex: 15,
              body: '15 题题干',
              options: [
                { key: 'A', value: 'A' },
                { key: 'B', value: 'B' }
              ]
            }
          ]
        }
      },
      $children: [{ problemMap }]
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();

    await expect(manager.readExerciseRuntimeState()).resolves.toEqual(
      expect.objectContaining({
        lessonId: 'lesson-1',
        exerciseIndex: '1',
        problemId: 'problem-15',
        problemType: 1,
        questionText: '15 题题干',
        routePath: '/lesson/fullscreen/v3/lesson-1/exercise/1'
      })
    );
  });

  it('waits before navigating into the active lesson when detection starts on the home page', async () => {
    const runtime = createRuntime();
    const traceStore = new AutoplayDebugTraceStore();
    let currentUrl = 'https://www.yuketang.cn/v2/web/index';
    runtime.page.url.mockImplementation(() => currentUrl);
    runtime.page.goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            onLessonClassrooms: [
              {
                classroomName: 'test',
                courseName: 'test',
                lessonId: 'lesson-1'
              }
            ]
          }
        })
      })
    );
    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      traceStore,
      activeLessonEnterDelayMs: 20
    });

    await manager.start();
    currentUrl = 'https://www.yuketang.cn/v2/web/index';
    window.history.replaceState({}, '', '/v2/web/index');
    runtime.page.goto.mockClear();
    const startedAt = Date.now();
    await manager.startQuestionDetection(vi.fn());

      await vi.waitFor(() => {
        expect(runtime.page.goto).toHaveBeenCalledWith(expect.stringContaining('/lesson/fullscreen/v3/lesson-1'));
      });
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(15);
      expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'classroom_detected',
            message: '检测到课堂，1秒后进入课堂'
          }),
          expect.objectContaining({
            type: 'classroom_entered',
            message: '已成功进入课堂'
        })
      ])
    );
  });

  it('returns to the home page when the lesson-ended detector event fires', async () => {
    const runtime = createRuntime();
    let currentUrl = 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1';
    runtime.page.url.mockImplementation(() => currentUrl);
    runtime.page.goto.mockImplementation(async (url: string) => {
      currentUrl = url;
    });
    runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
    document.body.innerHTML = '<main><div>课程结束</div></main><div id="app"></div>';
    window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1');
    const app = document.querySelector('#app') as { __vue__?: any };
    app.__vue__ = {
      $route: {
        name: 'lesson',
        params: { lessonID: 'lesson-1' },
        path: '/lesson/fullscreen/v3/lesson-1'
      },
      $store: {
        state: {
          cards: []
        }
      },
      $children: [{}],
      $watch: (source: () => unknown, callback: () => void, options?: { immediate?: boolean }) => {
        source();
        if (options?.immediate) {
          callback();
        }
        return () => undefined;
      }
    };
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    await manager.start();
    runtime.page.goto.mockClear();
    await manager.startQuestionDetection(vi.fn());
    const endedBinding = runtime.page.exposeBinding.mock.calls[2]?.[1];
    await endedBinding?.({}, {
      lessonId: 'lesson-1',
      currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
    });

    expect(runtime.page.goto).toHaveBeenCalledWith('https://www.yuketang.cn/v2/web/index');
  });

  it('keeps detection enabled across browser restarts and re-emits the current unresolved question', async () => {
    const firstRuntime = createRuntime();
    const secondRuntime = createRuntime();
    secondRuntime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/14');
    let launchCount = 0;
    const manager = new BrowserManager({
      launchBrowser: vi.fn(async () => {
        launchCount += 1;
        return launchCount === 1 ? firstRuntime.browser : secondRuntime.browser;
      })
    });
    const onEvent = vi.fn();
    firstRuntime.page.evaluate.mockResolvedValue(null);
    secondRuntime.page.evaluate.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '14',
      problemId: 'problem-14',
      problemType: 1,
      pageIndex: 7,
      questionText: '14 题题干',
      options: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/v3/lesson-1/exercise/14'
    });

    await manager.startQuestionDetection(onEvent);
    await manager.start();
    await manager.stop();
    await manager.start();

    expect(firstRuntime.page.addInitScript).toHaveBeenCalledTimes(1);
    expect(secondRuntime.page.addInitScript).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        problemId: 'problem-14',
        routePath: '/v3/lesson-1/exercise/14'
      })
    );
  });

  it('stops question detection idempotently and ignores later browser events', async () => {
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue(null);
    const manager = new BrowserManager({ launchBrowser: runtime.launch });
    const onEvent = vi.fn();

    await manager.start();
    await manager.startQuestionDetection(onEvent);
    const binding = runtime.page.exposeBinding.mock.calls[0]?.[1];

    await manager.stopQuestionDetection();
    await manager.stopQuestionDetection();
    await binding?.({}, {
      lessonId: 'lesson-1',
      exerciseIndex: '15',
      problemId: 'problem-15',
      problemType: 1,
      routePath: '/v3/lesson-1/exercise/15',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-16T00:00:00.000Z'
    });

    expect(runtime.page.evaluate).toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
  });
});
