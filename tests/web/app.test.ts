import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPromises, mount } from '@vue/test-utils';
import App from '../../apps/web/src/App.vue';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('App shell', () => {
  it('renders the commercial dashboard shell', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ status: 'ok', name: 'YKSprite' })
      })
    );

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
  });

  it('calls browser control endpoints from the action buttons', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', name: 'YKSprite' })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasSession: false,
          savedAt: null,
          origin: null,
          cookieCount: 0,
          currentUrl: null,
          pageTitle: null,
          mode: null
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'idle',
          engine: 'chromium',
          headless: true,
          startedAt: null,
          pageUrl: null,
          lastError: null
        })
      })
      .mockResolvedValue({
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
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          status: 'running',
          engine: 'chromium',
          headless: true,
          mode: 'visible-login',
          startedAt: '2026-04-14T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn',
          lastError: null
        })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          hasSession: true,
          savedAt: '2026-04-14T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 1,
          currentUrl: 'https://www.yuketang.cn',
          pageTitle: '雨课堂',
          mode: 'visible-login'
        })
      });

    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(App);
    await flushPromises();

    const buttons = () => wrapper.findAll('button');
    const startButton = () => buttons().find((button) => button.text().includes('启动浏览器接管'));
    const stopButton = () => buttons().find((button) => button.text().includes('停止浏览器'));
    const refreshButton = () => buttons().find((button) => button.text().includes('刷新状态'));
    const loginButton = () => buttons().find((button) => button.text().includes('扫码登录'));
    const saveSessionButton = () => buttons().find((button) => button.text().includes('保存当前会话'));

    expect(startButton()).toBeTruthy();
    expect(stopButton()).toBeTruthy();
    expect(refreshButton()).toBeTruthy();
    expect(loginButton()).toBeTruthy();
    expect(saveSessionButton()).toBeTruthy();

    await startButton()!.trigger('click');
    await flushPromises();
    await loginButton()!.trigger('click');
    await flushPromises();
    await saveSessionButton()!.trigger('click');
    await flushPromises();
    await stopButton()!.trigger('click');
    await flushPromises();
    await refreshButton()!.trigger('click');

    expect(fetchMock).toHaveBeenCalledWith('/browser/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/login/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/session/save', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/stop', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser');
    expect(fetchMock).toHaveBeenCalledWith('/browser/session');
  });
});
