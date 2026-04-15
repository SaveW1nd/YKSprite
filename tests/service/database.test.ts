import { mkdtempSync, writeFileSync, rmSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AutomationStore } from '../../apps/service/src/automation/automation-store';
import { AssistRepository } from '../../apps/service/src/db/assist-repository';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { RuntimeRepository } from '../../apps/service/src/db/runtime-repository';
import { questionsTable } from '../../apps/service/src/db/schema';
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

  it('stores a saved capture and current AI analysis for a question', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');

    const client = createDatabaseClient({ databasePath });
    client.db.insert(questionsTable).values({
      questionId: 'q-1',
      courseTitle: '高等数学',
      type: 'single_choice',
      body: '函数 f(x) 的导数是？',
      slideIndex: 0,
      source: 'dom',
      detectedAt: '2026-04-14T00:00:00.000Z',
      runtimeSnapshotId: 1
    }).run();

    const repository = new AssistRepository(client);
    const captureId = repository.saveQuestionCapture({
      questionRowId: 1,
      sourceType: 'runtime_question',
      filePath: '/tmp/capture.png',
      mimeType: 'image/png',
      width: 1180,
      height: 820,
      sha256: 'abc123'
    });

    repository.saveVisionAnalysis({
      questionRowId: 1,
      captureId,
      provider: 'openai',
      model: 'gpt-4.1-mini',
      promptVersion: 'single_choice.v1',
      questionType: 'single_choice',
      questionText: '函数 f(x) 的导数是？',
      options: [{ key: 'A', value: 'x' }],
      suggestedAnswer: 'A',
      confidence: 'medium',
      reasoningSummary: '截图中的选项 A 与题意最匹配。',
      rawResponseJson: '{}'
    });

    expect(repository.getLatestCaptureByQuestionId('q-1')).toMatchObject({
      filePath: '/tmp/capture.png',
      mimeType: 'image/png'
    });
    expect(repository.getCurrentAnalysisByQuestionId('q-1')).toMatchObject({
      provider: 'openai',
      suggestedAnswer: 'A'
    });

    client.close();
  });

  it('stores and lists unanswered exercise queue entries for a lesson', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-db-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');

    const client = createDatabaseClient({ databasePath });
    const repository = new RuntimeRepository(client);

    repository.replaceExerciseEntries('lesson-1', [
      {
        entryId: 'timeline-4',
        lessonId: 'lesson-1',
        status: 'unanswered',
        analysisStatus: 'pending',
        isActive: true,
        pageHint: '第5页',
        remainingHint: '3分钟前',
        thumbnailUrl: 'https://example.com/problem-4.png',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4'
      },
      {
        entryId: 'timeline-5',
        lessonId: 'lesson-1',
        status: 'answered',
        analysisStatus: 'done',
        isActive: false,
        pageHint: '第6页',
        remainingHint: '1分钟前',
        thumbnailUrl: 'https://example.com/problem-5.png',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/5'
      }
    ]);

    expect(repository.listExerciseEntries()).toEqual([
      expect.objectContaining({
        lessonId: 'lesson-1',
        entryId: 'timeline-4',
        status: 'unanswered',
        analysisStatus: 'pending',
        isActive: true
      }),
      expect.objectContaining({
        lessonId: 'lesson-1',
        entryId: 'timeline-5',
        status: 'answered',
        analysisStatus: 'done',
        isActive: false
      })
    ]);

    repository.updateExerciseProcessingState('lesson-1', 'timeline-4', {
      analysisStatus: 'done',
      lastProcessedAt: '2026-04-14T00:00:10.000Z'
    });

    repository.replaceExerciseEntries('lesson-1', [
      {
        entryId: 'timeline-4',
        lessonId: 'lesson-1',
        status: 'unanswered',
        analysisStatus: 'pending',
        isActive: true,
        pageHint: '第5页',
        remainingHint: '2分钟前',
        thumbnailUrl: 'https://example.com/problem-4.png',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4'
      }
    ]);

    expect(repository.listExerciseEntries()[0]).toMatchObject({
      entryId: 'timeline-4',
      analysisStatus: 'done',
      lastProcessedAt: '2026-04-14T00:00:10.000Z'
    });

    client.close();
  });
});
