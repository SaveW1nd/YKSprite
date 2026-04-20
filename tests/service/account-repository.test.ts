import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { AccountRepository } from '../../apps/service/src/db/account-repository';
import { accountsTable } from '../../apps/service/src/db/schema';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('AccountRepository', () => {
  it('refreshes an existing account by userId and removes stale placeholder rows on login save', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-account-repo-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const repository = new AccountRepository(databaseClient);

    const existing = databaseClient.db.insert(accountsTable).values({
      userId: '47489393',
      name: '别点我我不会',
      accountKey: '别点我我不会',
      platform: 'Yuketang',
      status: 'healthy',
      lastCheckedAt: '2026-04-17T10:00:00.000Z',
      lastErrorReason: null,
      note: null,
      cookieCount: 1,
      cookiesJson: JSON.stringify([{ name: 'sessionid', value: 'old' }]),
      sessionSavedAt: '2026-04-17T10:00:00.000Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'qr-login',
      createdAt: '2026-04-17T10:00:00.000Z'
    }).run();
    const stalePlaceholder = databaseClient.db.insert(accountsTable).values({
      userId: null,
      name: null,
      accountKey: '待登录账号-1',
      platform: 'Yuketang',
      status: 'error',
      lastCheckedAt: null,
      lastErrorReason: '未登录',
      note: null,
      createdAt: '2026-04-17T10:05:00.000Z'
    }).run();

    const result = repository.saveSessionForLogin({
      cookies: [{ name: 'sessionid', value: 'new' } as any],
      savedAt: '2026-04-17T10:06:00.000Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'qr-login'
    }, {
      userId: '47489393',
      name: '别点我我不会'
    });

    expect(result).toEqual({
      accountId: Number(existing.lastInsertRowid),
      refreshedExistingAccount: true
    });
    expect(repository.getById(Number(stalePlaceholder.lastInsertRowid))).toBeNull();
    expect(repository.getStoredSession(Number(existing.lastInsertRowid))?.cookies).toEqual([
      { name: 'sessionid', value: 'new' }
    ]);
  });

  it('cleans anonymous duplicate session rows from the account list', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-account-repo-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const repository = new AccountRepository(databaseClient);

    databaseClient.db.insert(accountsTable).values([
      {
        userId: '47489393',
        name: '别点我我不会',
        accountKey: '别点我我不会',
        platform: 'Yuketang',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        cookiesJson: JSON.stringify([{ name: 'sessionid', value: 'same' }]),
        cookieCount: 1,
        sessionSavedAt: '2026-04-17T10:00:00.000Z',
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        pageTitle: '雨课堂',
        mode: 'qr-login',
        createdAt: '2026-04-17T10:00:00.000Z'
      },
      {
        userId: null,
        name: null,
        accountKey: '雨课堂账号-1',
        platform: 'Yuketang',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:01:00.000Z',
        lastErrorReason: null,
        cookiesJson: JSON.stringify([{ name: 'sessionid', value: 'same' }]),
        cookieCount: 1,
        sessionSavedAt: '2026-04-17T10:01:00.000Z',
        origin: 'www.yuketang.cn',
        currentUrl: 'https://www.yuketang.cn/v2/web/index',
        pageTitle: '雨课堂',
        mode: 'qr-login',
        createdAt: '2026-04-17T10:01:00.000Z'
      }
    ]).run();

    const accounts = repository.list();

    expect(accounts).toHaveLength(1);
    expect(accounts[0]?.userId).toBe('47489393');
  });

  it('does not create a new anonymous healthy account when identity extraction fails', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-account-repo-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const repository = new AccountRepository(databaseClient);

    const result = repository.saveSessionForLogin({
      cookies: [{ name: 'sessionid', value: 'new' } as any],
      savedAt: '2026-04-17T10:06:00.000Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'qr-login'
    }, null);

    expect(result).toEqual({
      accountId: -1,
      refreshedExistingAccount: false
    });
    expect(repository.list()).toEqual([]);
  });

  it('treats the same userId on different rain classroom platforms as distinct accounts', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-account-repo-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const databaseClient = createDatabaseClient({ databasePath });
    const repository = new AccountRepository(databaseClient);

    const existing = databaseClient.db.insert(accountsTable).values({
      userId: '47489393',
      name: '别点我我不会',
      accountKey: '别点我我不会',
      platform: 'rain-classroom',
      status: 'healthy',
      lastCheckedAt: '2026-04-17T10:00:00.000Z',
      lastErrorReason: null,
      note: null,
      cookieCount: 1,
      cookiesJson: JSON.stringify([{ name: 'sessionid', value: 'rain' }]),
      sessionSavedAt: '2026-04-17T10:00:00.000Z',
      origin: 'www.yuketang.cn',
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      mode: 'qr-login',
      createdAt: '2026-04-17T10:00:00.000Z'
    }).run();

    const result = repository.saveSessionForLogin(
      {
        cookies: [{ name: 'sessionid', value: 'changjiang' } as any],
        savedAt: '2026-04-17T10:06:00.000Z',
        origin: 'changjiang.yuketang.cn',
        currentUrl: 'https://changjiang.yuketang.cn/v2/web/index',
        pageTitle: '长江雨课堂',
        mode: 'qr-login'
      },
      {
        userId: '47489393',
        name: '别点我我不会'
      }
    );

    expect(result.refreshedExistingAccount).toBe(false);
    expect(result.accountId).not.toBe(Number(existing.lastInsertRowid));

    const accounts = repository.list();
    expect(accounts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 'rain-classroom', userId: '47489393' }),
        expect.objectContaining({ platform: 'changjiang-rain-classroom', userId: '47489393' })
      ])
    );
  });
});
