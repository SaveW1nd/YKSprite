import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import {
  accountsTable,
  autoAnswerAttemptsTable,
  autoAnswerRunsTable,
  questionCapturesTable,
  questionsTable,
  runtimeSnapshotsTable
} from '../../apps/service/src/db/schema';

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('answers routes', () => {
  it('returns answer history with account and capture metadata', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-answers-'));
    cleanupPaths.push(root);
    const databasePath = path.join(root, 'data', 'yksprite.db');
    const captureDir = path.join(root, 'captures');
    mkdirSync(captureDir, { recursive: true });
    const capturePath = path.join(captureDir, 'question.png');
    writeFileSync(capturePath, Buffer.from('png'));

    const databaseClient = createDatabaseClient({ databasePath });
    const accountResult = databaseClient.db.insert(accountsTable).values({
      userId: '59475153',
      name: '丁俊杰',
      accountKey: '丁俊杰',
      platform: 'changjiang-rain-classroom',
      status: 'healthy',
      lastCheckedAt: '2026-05-01T10:00:00.000Z',
      lastErrorReason: null,
      note: null,
      createdAt: '2026-05-01T09:00:00.000Z'
    }).run();
    const accountId = Number(accountResult.lastInsertRowid);
    const snapshotResult = databaseClient.db.insert(runtimeSnapshotsTable).values({
      connected: true,
      loggedIn: true,
      courseTitle: '高等数学',
      lessonState: 'in_class',
      checkinAvailable: false,
      questionDetected: true,
      currentUrl: 'https://example.test/lesson',
      pageTitle: null,
      scannedAt: '2026-05-01T10:00:00.000Z'
    }).run();
    const questionResult = databaseClient.db.insert(questionsTable).values({
      questionId: 'exercise-problem-1',
      courseTitle: null,
      type: 'single_choice',
      body: '函数 f(x) 的导数是？',
      slideIndex: 1,
      source: 'mixed',
      detectedAt: '2026-05-01T10:00:01.000Z',
      runtimeSnapshotId: Number(snapshotResult.lastInsertRowid)
    }).run();
    const questionRowId = Number(questionResult.lastInsertRowid);
    const captureResult = databaseClient.db.insert(questionCapturesTable).values({
      questionRowId,
      sourceType: 'runtime_ppt',
      filePath: capturePath,
      mimeType: 'image/png',
      width: 640,
      height: 360,
      sha256: 'sha',
      createdAt: '2026-05-01T10:00:02.000Z'
    }).run();
    databaseClient.db.insert(autoAnswerRunsTable).values({
      id: 'run-1',
      status: 'succeeded',
      accountId,
      accountUserId: '59475153',
      lessonId: 'lesson-1',
      courseTitle: '高等数学',
      startedAt: '2026-05-01T10:00:00.000Z',
      finishedAt: '2026-05-01T10:00:06.000Z',
      totalCount: 1,
      collectedCount: 1,
      solvedCount: 1,
      successCount: 1,
      failedCount: 0,
      lastError: null
    }).run();
    databaseClient.db.insert(autoAnswerAttemptsTable).values({
      id: 'attempt-1',
      runId: 'run-1',
      questionRowId,
      exerciseEntryId: 'preferred-problem-1',
      problemId: 'problem-1',
      problemType: 1,
      provider: 'qwen_vl',
      model: 'qwen3-vl-flash-2026-01-22',
      answerJson: '["A"]',
      confidence: 'high',
      reasoningSummary: '选 A',
      collectStatus: 'ready',
      solveStatus: 'done',
      submitStatus: 'submitted',
      submitAttempt: 1,
      submitResponseJson: '{}',
      submittedAt: '2026-05-01T10:00:05.000Z',
      lastError: null
    }).run();
    const app = buildServiceApp({ databaseClient });

    try {
      const listResponse = await app.inject({ method: 'GET', url: '/answers' });
      const captureResponse = await app.inject({
        method: 'GET',
        url: `/answers/captures/${Number(captureResult.lastInsertRowid)}`
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json()).toEqual([
        expect.objectContaining({
          id: 'attempt-1',
          account: expect.objectContaining({
            id: accountId,
            name: '丁俊杰',
            userId: '59475153'
          }),
          courseTitle: '高等数学',
          questionText: '函数 f(x) 的导数是？',
          answerJson: '["A"]',
          capture: expect.objectContaining({
            url: `/api/answers/captures/${Number(captureResult.lastInsertRowid)}`,
            mimeType: 'image/png'
          })
        })
      ]);
      expect(captureResponse.statusCode).toBe(200);
      expect(captureResponse.headers['content-type']).toContain('image/png');
      expect(captureResponse.body).toBe('png');
    } finally {
      await app.close();
    }
  });
});
