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
          startedAt: '2026-04-14T00:00:00.000Z',
          pageUrl: 'about:blank',
          lastError: null
        })
      });

    vi.stubGlobal('fetch', fetchMock);

    const wrapper = mount(App);
    await flushPromises();

    const buttons = () => wrapper.findAll('button');
    const startButton = () => buttons().find((button) => button.text().includes('启动浏览器接管'));
    const stopButton = () => buttons().find((button) => button.text().includes('停止浏览器'));
    const refreshButton = () => buttons().find((button) => button.text().includes('刷新状态'));

    expect(startButton()).toBeTruthy();
    expect(stopButton()).toBeTruthy();
    expect(refreshButton()).toBeTruthy();

    await startButton()!.trigger('click');
    await flushPromises();
    await stopButton()!.trigger('click');
    await flushPromises();
    await refreshButton()!.trigger('click');

    expect(fetchMock).toHaveBeenCalledWith('/browser/start', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser/stop', expect.any(Object));
    expect(fetchMock).toHaveBeenCalledWith('/browser');
  });
});
