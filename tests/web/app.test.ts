import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../../apps/web/src/App.vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

const createFetchMock = () =>
  vi.fn(async (input: string) => {
    if (input === '/health') {
      return { ok: true, json: async () => ({ status: 'ok', name: 'YKSprite' }) };
    }

    if (input === '/browser') {
      return {
        ok: true,
        json: async () => ({
          status: 'idle',
          engine: 'chromium',
          headless: true,
          mode: null,
          startedAt: null,
          pageUrl: null,
          lastError: null
        })
      };
    }

    if (input === '/browser/start') {
      return {
        ok: true,
        json: async () => ({
          status: 'running',
          engine: 'chromium',
          headless: true,
          mode: 'headless',
          startedAt: '2026-04-14T00:00:00.000Z',
          pageUrl: 'about:blank',
          lastError: null
        })
      };
    }

    if (input === '/browser/login/start') {
      return {
        ok: true,
        json: async () => ({
          status: 'running',
          engine: 'chromium',
          headless: true,
          mode: 'visible-login',
          startedAt: '2026-04-14T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/',
          lastError: null
        })
      };
    }

    if (input === '/browser/stop') {
      return {
        ok: true,
        json: async () => ({
          status: 'idle',
          engine: 'chromium',
          headless: true,
          mode: null,
          startedAt: null,
          pageUrl: null,
          lastError: null
        })
      };
    }

    if (input === '/browser/session') {
      return {
        ok: true,
        json: async () => ({
          hasSession: true,
          savedAt: '2026-04-14T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 1,
          currentUrl: 'https://www.yuketang.cn/lesson/1',
          pageTitle: '高等数学 - 雨课堂',
          mode: 'visible-login'
        })
      };
    }

    if (input === '/browser/session/save') {
      return {
        ok: true,
        json: async () => ({
          hasSession: true,
          savedAt: '2026-04-14T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 1,
          currentUrl: 'https://www.yuketang.cn/lesson/1',
          pageTitle: '高等数学 - 雨课堂',
          mode: 'visible-login'
        })
      };
    }

    if (input === '/runtime/status') {
      return {
        ok: true,
        json: async () => ({
          connected: true,
          loggedIn: true,
          courseTitle: '高等数学',
          lessonState: 'in_class',
          checkinAvailable: true,
          questionDetected: true,
          currentUrl: 'https://www.yuketang.cn/lesson/1',
          pageTitle: '高等数学 - 雨课堂',
          lastScannedAt: '2026-04-14T00:00:00.000Z'
        })
      };
    }

    if (input === '/runtime/monitor') {
      return {
        ok: true,
        json: async () => ({
          enabled: true,
          phase: 'home_polling',
          currentCourse: null,
          currentLessonId: null,
          lastCheckedAt: '2026-04-14T00:00:00.000Z',
          lastTransitionAt: '2026-04-14T00:00:00.000Z',
          lastError: null
        })
      };
    }

    if (input === '/runtime/monitor/start') {
      return {
        ok: true,
        json: async () => ({
          enabled: true,
          phase: 'class_monitoring',
          currentCourse: '高等数学',
          currentLessonId: 'lesson-1',
          lastCheckedAt: '2026-04-14T00:00:05.000Z',
          lastTransitionAt: '2026-04-14T00:00:05.000Z',
          lastError: null
        })
      };
    }

    if (input === '/runtime/monitor/stop') {
      return {
        ok: true,
        json: async () => ({
          enabled: false,
          phase: 'idle',
          currentCourse: null,
          currentLessonId: null,
          lastCheckedAt: '2026-04-14T00:00:05.000Z',
          lastTransitionAt: '2026-04-14T00:00:10.000Z',
          lastError: null
        })
      };
    }

    if (input === '/runtime/questions/current') {
      return {
        ok: true,
        json: async () => ({
          id: 1,
          questionId: 'q-1',
          courseTitle: '高等数学',
          type: 'single_choice',
          body: '函数 f(x) 的导数是？',
          options: [{ key: 'A', value: 'x' }],
          slideIndex: 0,
          source: 'dom',
          detectedAt: '2026-04-14T00:00:00.000Z'
        })
      };
    }

    if (input === '/tasks') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'task-1',
            type: 'runtime_scan',
            status: 'running',
            startedAt: '2026-04-14T00:00:00.000Z',
            finishedAt: null,
            lastError: null,
            attempt: 1,
            payloadSummary: 'Scan current lesson page',
            sourceRef: null
          }
        ]
      };
    }

    if (input === '/events') {
      return {
        ok: true,
        json: async () => [
          {
            id: 'event-1',
            level: 'live',
            title: 'Task runtime_scan started',
            description: 'Scan current lesson page',
            time: '2026-04-14T00:00:00.000Z'
          }
        ]
      };
    }

    throw new Error(`Unexpected fetch call: ${input}`);
  });

describe('App shell', () => {
  it('renders the commercial dashboard shell', async () => {
    vi.stubGlobal('fetch', createFetchMock());

    const wrapper = mount(App);
    await flushPromises();

    expect(wrapper.text()).toContain('YKSprite');
    expect(wrapper.text()).toContain('Running Tasks');
    expect(wrapper.text()).toContain('Event Stream');
    expect(wrapper.text()).toContain('System Health');
    expect(wrapper.text()).toContain('浏览器接管');
    expect(wrapper.text()).toContain('刷新状态');
    expect(wrapper.text()).toContain('最近事件');
    expect(wrapper.text()).toContain('扫码登录');
    expect(wrapper.text()).toContain('保存当前会话');
    expect(wrapper.text()).toContain('已保存会话');
    expect(wrapper.text()).toContain('Task runtime_scan started');
    expect(wrapper.text()).toContain('高等数学 · 课堂中');
    expect(wrapper.text()).toContain('自动监控');
    expect(wrapper.text()).toContain('home_polling');
  });

  it('calls browser control endpoints from the action buttons', async () => {
    const fetchMock = createFetchMock();
    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(App);
    await flushPromises();

    const buttons = () => wrapper.findAll('button');
    const startButton = () => buttons().find((button) => button.text().includes('启动浏览器接管'));
    const stopButton = () => buttons().find((button) => button.text().includes('停止浏览器'));
    const refreshButton = () => buttons().find((button) => button.text().includes('刷新状态'));
    const loginButton = () => buttons().find((button) => button.text().includes('扫码登录'));
    const saveSessionButton = () => buttons().find((button) => button.text().includes('保存当前会话'));
    const startMonitorButton = () => buttons().find((button) => button.text().includes('启动自动监控'));
    const stopMonitorButton = () => buttons().find((button) => button.text().includes('停止自动监控'));

    expect(startButton()).toBeTruthy();
    expect(stopButton()).toBeTruthy();
    expect(refreshButton()).toBeTruthy();
    expect(loginButton()).toBeTruthy();
    expect(saveSessionButton()).toBeTruthy();
    expect(startMonitorButton()).toBeTruthy();
    expect(stopMonitorButton()).toBeTruthy();

    await startButton()!.trigger('click');
    await flushPromises();
    await loginButton()!.trigger('click');
    await flushPromises();
    await saveSessionButton()!.trigger('click');
    await flushPromises();
    await stopButton()!.trigger('click');
    await flushPromises();
    await startMonitorButton()!.trigger('click');
    await flushPromises();
    await stopMonitorButton()!.trigger('click');
    await flushPromises();
    await refreshButton()!.trigger('click');

    expect(fetchMock).toHaveBeenCalledWith('/browser/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/login/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/session/save', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/stop', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser');
    expect(fetchMock).toHaveBeenCalledWith('/browser/session');
    expect(fetchMock).toHaveBeenCalledWith('/runtime/status');
    expect(fetchMock).toHaveBeenCalledWith('/runtime/monitor');
    expect(fetchMock).toHaveBeenCalledWith('/runtime/monitor/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/runtime/monitor/stop', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/runtime/questions/current');
    expect(fetchMock).toHaveBeenCalledWith('/tasks');
    expect(fetchMock).toHaveBeenCalledWith('/events');
  });
});
