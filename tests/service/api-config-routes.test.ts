import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { accountsTable } from '../../apps/service/src/db/schema';

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

  it('refreshes api-related account health when a qwen key is added or enabled', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-api-config-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });

    databaseClient.db.insert(accountsTable).values([
      {
        userId: 'api-error-user',
        name: 'API 异常账号',
        accountKey: 'API 异常账号',
        platform: 'rain-classroom',
        status: 'error',
        lastCheckedAt: '2026-04-30T00:00:00.000Z',
        lastErrorReason: 'api key未配置，无法调用 AI 解题',
        note: null,
        createdAt: '2026-04-30T00:00:00.000Z'
      },
      {
        userId: 'login-error-user',
        name: '登录异常账号',
        accountKey: '登录异常账号',
        platform: 'rain-classroom',
        status: 'error',
        lastCheckedAt: '2026-04-30T00:00:00.000Z',
        lastErrorReason: '未登录',
        note: null,
        createdAt: '2026-04-30T00:00:01.000Z'
      }
    ]).run();

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
      expect(createPrimaryResponse.statusCode).toBe(200);

      const afterCreate = await app.inject({ method: 'GET', url: '/accounts' });
      expect(afterCreate.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'api-error-user',
            status: 'healthy',
            lastErrorReason: null
          }),
          expect.objectContaining({
            userId: 'login-error-user',
            status: 'error',
            lastErrorReason: '未登录'
          })
        ])
      );

      databaseClient.db
        .update(accountsTable)
        .set({
          status: 'error',
          lastErrorReason: 'Qwen 接口连接失败，请检查当前网络或接口地址'
        })
        .run();

      const createSecondaryResponse = await app.inject({
        method: 'POST',
        url: '/api-config/qwen-keys',
        payload: {
          name: '备用 key',
          apiKey: 'qwen-test-key-2'
        }
      });
      const secondaryKeyId = createSecondaryResponse.json().keys[1].id;
      databaseClient.db
        .update(accountsTable)
        .set({
          status: 'error',
          lastErrorReason: 'Qwen 接口连接失败，请检查当前网络或接口地址'
        })
        .run();

      const enableResponse = await app.inject({
        method: 'PATCH',
        url: `/api-config/qwen-keys/${secondaryKeyId}/enable`
      });
      expect(enableResponse.statusCode).toBe(200);

      const afterEnable = await app.inject({ method: 'GET', url: '/accounts' });
      expect(afterEnable.json()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: 'api-error-user',
            status: 'healthy',
            lastErrorReason: null
          }),
          expect.objectContaining({
            userId: 'login-error-user',
            status: 'healthy',
            lastErrorReason: null
          })
        ])
      );
    } finally {
      await app.close();
    }
  });
});
