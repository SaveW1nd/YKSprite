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
  it('adds, enables, and deletes qwen api keys', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-api-config-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const app = buildServiceApp({ databaseClient });

    try {
      const createPrimaryResponse = await app.inject({
        method: 'POST',
        url: '/api-config/qwen-keys',
        payload: {
          name: '主账号 key',
          apiKey: 'qwen-test-key-1'
        }
      });
      const createSecondaryResponse = await app.inject({
        method: 'POST',
        url: '/api-config/qwen-keys',
        payload: {
          name: '备用 key',
          apiKey: 'qwen-test-key-2'
        }
      });

      expect(createPrimaryResponse.statusCode).toBe(200);
      expect(createSecondaryResponse.statusCode).toBe(200);
      const createdSnapshot = createSecondaryResponse.json();

      const enableResponse = await app.inject({
        method: 'PATCH',
        url: `/api-config/qwen-keys/${createdSnapshot.keys[1].id}/enable`
      });
      expect(enableResponse.statusCode).toBe(200);
      expect(enableResponse.json()).toMatchObject({
        activeKeyName: '备用 key',
        hasActiveKey: true,
        model: 'qwen3-vl-flash-2026-01-22'
      });

      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/api-config/qwen-keys/${createdSnapshot.keys[0].id}`
      });
      expect(deleteResponse.statusCode).toBe(200);
      expect(deleteResponse.json()).toMatchObject({
        keys: [
          expect.objectContaining({
            name: '备用 key',
            isActive: true
          })
        ]
      });
    } finally {
      await app.close();
    }
  });
});
