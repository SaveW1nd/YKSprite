import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import type { BrowserController } from '../../apps/service/src/browser/browser-controller';

const createBrowserController = (): BrowserController => ({
  getStatus: () => ({
    status: 'idle',
    engine: 'chromium',
    headless: true,
    startedAt: null,
    pageUrl: null,
    lastError: null
  }),
  start: async () => ({
    status: 'running',
    engine: 'chromium',
    headless: true,
    startedAt: '2026-04-14T00:00:00.000Z',
    pageUrl: 'about:blank',
    lastError: null
  }),
  stop: async () => ({
    status: 'idle',
    engine: 'chromium',
    headless: true,
    startedAt: null,
    pageUrl: null,
    lastError: null
  })
});

describe('browser routes', () => {
  it('exposes browser status and control endpoints', async () => {
    const app = buildServiceApp({
      browserController: createBrowserController()
    });

    try {
      const statusResponse = await app.inject({ method: 'GET', url: '/browser' });
      const startResponse = await app.inject({ method: 'POST', url: '/browser/start' });
      const stopResponse = await app.inject({ method: 'POST', url: '/browser/stop' });

      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({ status: 'idle', engine: 'chromium' });

      expect(startResponse.statusCode).toBe(200);
      expect(startResponse.json()).toMatchObject({ status: 'running', pageUrl: 'about:blank' });

      expect(stopResponse.statusCode).toBe(200);
      expect(stopResponse.json()).toMatchObject({ status: 'idle' });
    } finally {
      await app.close();
    }
  });
});
