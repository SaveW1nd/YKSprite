import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationStore } from '../../apps/service/src/automation/automation-store';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { SessionRepository } from '../../apps/service/src/db/session-repository';
import { TaskRepository } from '../../apps/service/src/db/task-repository';

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

  it('lists later events first when timestamps are identical', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');

    const client = createDatabaseClient({ databasePath });
    const repository = new TaskRepository(client);
    const time = '2026-04-14T00:00:00.000Z';

    repository.addEvent({
      id: 'event-1',
      level: 'live',
      title: 'Task started',
      description: 'First event',
      time
    });
    repository.addEvent({
      id: 'event-2',
      level: 'info',
      title: 'Task succeeded',
      description: 'Second event',
      time
    });

    const events = repository.listEvents();
    client.close();

    expect(events.map((event) => event.id)).toEqual(['event-2', 'event-1']);
  });

  it('continues task and event ids after process restart', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');

    const client = createDatabaseClient({ databasePath });
    const repository = new TaskRepository(client);

    repository.upsertTask({
      id: 'task-1',
      type: 'runtime_scan',
      status: 'succeeded',
      startedAt: '2026-04-14T00:00:00.000Z',
      finishedAt: '2026-04-14T00:00:01.000Z',
      lastError: null,
      attempt: 1,
      payloadSummary: 'Existing task'
    });
    repository.addEvent({
      id: 'event-1',
      level: 'info',
      title: 'Existing event',
      description: 'Before restart',
      time: '2026-04-14T00:00:00.000Z'
    });

    const store = new AutomationStore(repository);
    await store.executeTask('runtime_scan', 'Scan current lesson page', async () => 'ok');

    const tasks = repository.listTasks();
    const events = repository.listEvents();
    client.close();

    expect(tasks.some((task) => task.id === 'task-2')).toBe(true);
    expect(events.some((event) => event.id === 'event-2')).toBe(true);
    expect(events.some((event) => event.id === 'event-3')).toBe(true);
  });
});
