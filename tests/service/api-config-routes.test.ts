import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import { createDatabaseClient } from '../../apps/service/src/db/client';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('api-config routes', () => {
  it('reads and updates the qwen provider config snapshot', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-api-config-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const app = buildServiceApp({ databaseClient });

    try {
      const updateResponse = await app.inject({
        method: 'PATCH',
        url: '/api-config/providers/qwen_vl',
        payload: {
          enabled: true,
          apiKey: 'qwen-test-key',
          baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
          model: 'qwen-vl-max'
        }
      });

      expect(updateResponse.statusCode).toBe(200);

      const getResponse = await app.inject({
        method: 'GET',
        url: '/api-config'
      });

      expect(getResponse.statusCode).toBe(200);
      expect(getResponse.json()).toMatchObject({
        defaultVisionProvider: 'qwen_vl',
        providers: {
          qwen_vl: {
            hasApiKey: true,
            model: 'qwen-vl-max'
          }
        }
      });
    } finally {
      await app.close();
    }
  });
});
