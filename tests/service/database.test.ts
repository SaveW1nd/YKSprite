import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { SessionRepository } from '../../apps/service/src/db/session-repository';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('database client', () => {
  it('creates the sqlite database file on first boot', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');

    const client = createDatabaseClient({ databasePath });
    client.close();

    expect(existsSync(databasePath)).toBe(true);
  });

  it('imports a legacy cookies file into the sessions table', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);

    const legacySessionPath = path.join(root, 'legacy', 'cookies.json');
    const databasePath = path.join(root, 'data', 'yksprite.db');
    mkdirSync(path.dirname(legacySessionPath), { recursive: true });
    writeFileSync(
      legacySessionPath,
      JSON.stringify({
        cookies: [
          {
            name: 'sessionid',
            value: 'legacy-cookie',
            domain: '.yuketang.cn',
            path: '/',
            expires: -1,
            httpOnly: true,
            secure: true,
            sameSite: 'Lax'
          }
        ],
        savedAt: '2026-04-14T00:00:00.000Z',
        origin: 'www.yuketang.cn'
      }),
      'utf8'
    );

    const client = createDatabaseClient({ databasePath, legacySessionPath });
    const repository = new SessionRepository(client);
    const active = repository.getActive();
    client.close();

    expect(active).toMatchObject({
      origin: 'www.yuketang.cn',
      savedAt: '2026-04-14T00:00:00.000Z'
    });
    expect(active?.cookies).toHaveLength(1);
  });
});
