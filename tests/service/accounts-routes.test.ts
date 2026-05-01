import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { accountsTable } from '../../apps/service/src/db/schema';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('accounts routes', () => {
  it('returns managed accounts ordered by newest first', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-accounts-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });

    databaseClient.db.insert(accountsTable).values([
      {
        userId: '47489393',
        name: '别点我我不会',
        accountKey: 'acct-openai-cn-01',
        platform: 'OpenAI',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        note: '主账号',
        createdAt: '2026-04-16T10:00:00.000Z'
      },
      {
        userId: '47489394',
        name: '另一个用户',
        accountKey: 'acct-claude-sh-02',
        platform: 'Claude',
        status: 'error',
        lastCheckedAt: '2026-04-17T09:00:00.000Z',
        lastErrorReason: '模型接口返回空结果',
        note: '异常样例',
        createdAt: '2026-04-17T11:00:00.000Z'
      }
    ]).run();

    const app = buildServiceApp({ databaseClient });

    try {
      const response = await app.inject({ method: 'GET', url: '/accounts' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          userId: '47489394',
          name: '另一个用户',
          accountKey: 'acct-claude-sh-02',
          platform: 'Claude',
          status: 'error',
          lastErrorReason: '模型接口返回空结果'
        }),
        expect.objectContaining({
          userId: '47489393',
          name: '别点我我不会',
          accountKey: 'acct-openai-cn-01',
          platform: 'OpenAI',
          status: 'healthy',
          lastErrorReason: null
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('filters managed accounts by search text and status', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-accounts-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });

    databaseClient.db.insert(accountsTable).values([
      {
        userId: '47489393',
        name: '别点我我不会',
        accountKey: 'acct-openai-cn-01',
        platform: 'OpenAI',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        note: '主账号',
        createdAt: '2026-04-16T10:00:00.000Z'
      },
      {
        userId: '47489394',
        name: '另一个用户',
        accountKey: 'acct-openai-cn-02',
        platform: 'OpenAI',
        status: 'error',
        lastCheckedAt: '2026-04-17T09:00:00.000Z',
        lastErrorReason: '认证返回字段缺失',
        note: '备用账号',
        createdAt: '2026-04-15T10:00:00.000Z'
      }
    ]).run();

    const app = buildServiceApp({ databaseClient });

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/accounts?q=备用&status=error'
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual([
        expect.objectContaining({
          userId: '47489394',
          name: '另一个用户',
          accountKey: 'acct-openai-cn-02',
          status: 'error',
          note: '备用账号'
        })
      ]);
    } finally {
      await app.close();
    }
  });

  it('exposes account qr login endpoints through the account login controller', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-accounts-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const accountLoginController = {
      start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined),
      startAccountLogin: vi.fn().mockResolvedValue({
        loginSessionId: 'login-session-1',
        accountId: null,
        status: 'pending',
        qrCodeDataUrl: 'data:image/png;base64,qr',
        lastError: null,
        notice: null,
        updatedAt: '2026-04-20T00:00:00.000Z'
      }),
      getAccountLoginState: vi.fn().mockResolvedValue({
        loginSessionId: 'login-session-1',
        accountId: 12,
        status: 'completed',
        qrCodeDataUrl: 'data:image/png;base64,qr',
        lastError: null,
        notice: '登录成功',
        updatedAt: '2026-04-20T00:00:03.000Z'
      }),
      stopAccountLogin: vi.fn().mockResolvedValue({
        loginSessionId: 'login-session-1',
        accountId: null,
        status: 'idle',
        qrCodeDataUrl: null,
        lastError: null,
        notice: null,
        updatedAt: '2026-04-20T00:00:05.000Z'
      })
    };
    const app = buildServiceApp({ databaseClient, accountLoginController: accountLoginController as any });

    try {
      const startResponse = await app.inject({
        method: 'POST',
        url: '/accounts/login/start',
        payload: {
          platform: 'changjiang-rain-classroom'
        }
      });
      const statusResponse = await app.inject({
        method: 'GET',
        url: '/accounts/login/login-session-1/status'
      });
      const stopResponse = await app.inject({
        method: 'POST',
        url: '/accounts/login/login-session-1/stop'
      });

      expect(startResponse.statusCode).toBe(200);
      expect(startResponse.json()).toMatchObject({
        loginSessionId: 'login-session-1',
        status: 'pending'
      });
      expect(statusResponse.statusCode).toBe(200);
      expect(statusResponse.json()).toMatchObject({
        loginSessionId: 'login-session-1',
        accountId: 12,
        status: 'completed'
      });
      expect(stopResponse.statusCode).toBe(200);
      expect(stopResponse.json()).toMatchObject({
        loginSessionId: 'login-session-1',
        status: 'idle'
      });
    } finally {
      await app.close();
    }
  });

  it('toggles monitoring enabled state and deletes an account', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-accounts-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });

    const inserted = databaseClient.db.insert(accountsTable).values({
      userId: '47489393',
      name: '别点我我不会',
      accountKey: '别点我我不会',
      platform: 'Yuketang',
      status: 'healthy',
      lastCheckedAt: '2026-04-17T12:29:23.916Z',
      lastErrorReason: null,
      note: null,
      cookieCount: 3,
      sessionSavedAt: '2026-04-17T12:29:23.916Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web',
      pageTitle: '雨课堂',
      mode: 'qr-login',
      monitoringEnabled: true,
      createdAt: '2026-04-17T12:29:08.850Z'
    }).run();
    const accountId = Number(inserted.lastInsertRowid);
    const app = buildServiceApp({ databaseClient });

    try {
      const disableResponse = await app.inject({
        method: 'PATCH',
        url: `/accounts/${accountId}/monitoring`,
        payload: { enabled: false }
      });
      const delayResponse = await app.inject({
        method: 'PATCH',
        url: `/accounts/${accountId}/active-lesson-enter-delay`,
        payload: { delayMs: 12_000 }
      });
      const listAfterDisable = await app.inject({ method: 'GET', url: '/accounts' });
      const deleteResponse = await app.inject({
        method: 'DELETE',
        url: `/accounts/${accountId}`
      });
      const listAfterDelete = await app.inject({ method: 'GET', url: '/accounts' });

      expect(disableResponse.statusCode).toBe(200);
      expect(disableResponse.json()).toMatchObject({
        id: accountId,
        monitoringEnabled: false
      });
      expect(delayResponse.statusCode).toBe(200);
      expect(delayResponse.json()).toMatchObject({
        id: accountId,
        activeLessonEnterDelayMs: 12_000
      });

      expect(listAfterDisable.json()).toEqual([
        expect.objectContaining({
          id: accountId,
          monitoringEnabled: false,
          activeLessonEnterDelayMs: 12_000
        })
      ]);

      expect(deleteResponse.statusCode).toBe(204);
      expect(listAfterDelete.json()).toEqual([]);
    } finally {
      await app.close();
    }
  });
});
