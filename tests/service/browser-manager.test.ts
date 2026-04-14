import { describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../../apps/service/src/browser/browser-manager';

type FakePage = {
  goto: ReturnType<typeof vi.fn>;
  url: ReturnType<typeof vi.fn>;
};

type FakeContext = {
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
    url: vi.fn().mockReturnValue('about:blank')
  };

  const context: FakeContext = {
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
      pageUrl: 'about:blank',
      lastError: null
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
});
