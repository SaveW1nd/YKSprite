import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';

describe('service health route', () => {
  it('returns product metadata', async () => {
    const app = buildServiceApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/health' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        status: 'ok',
        name: 'YKSprite'
      });
    } finally {
      await app.close();
    }
  });
});
