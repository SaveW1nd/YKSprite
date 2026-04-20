import { describe, expect, it, vi } from 'vitest';
import { AutoAnswerService } from '../../apps/service/src/auto-answer/auto-answer-service';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';

describe('AutoAnswerService', () => {
  it('records an ai_request_failed trace when solving throws an api error', async () => {
    const traceStore = new AutoplayDebugTraceStore();
    const attempt = {
      id: 'attempt-1',
      runId: 'run-1',
      questionRowId: 1,
      exerciseEntryId: 'entry-1',
      problemId: 'problem-1',
      problemType: 1,
      provider: null,
      model: null,
      answerJson: null,
      confidence: null,
      reasoningSummary: null,
      collectStatus: 'ready',
      solveStatus: 'pending',
      submitStatus: 'pending',
      submitAttempt: 0,
      submitResponseJson: null,
      submittedAt: null,
      lastError: null
    };
    const autoAnswerRepository = {
      getAttempt: vi.fn().mockReturnValue(attempt),
      upsertAttempt: vi.fn()
    };
    const service = new AutoAnswerService({
      browserController: {} as never,
      runtimeRepository: {} as never,
      assistRepository: {} as never,
      autoAnswerRepository: autoAnswerRepository as never,
      questionSolveService: {
        solveQuestion: vi.fn().mockRejectedValue(new Error('QWEN_VL_API_KEY is not configured'))
      } as never,
      automationStore: {
        executeTask: vi.fn(async (_type: string, _summary: string, task: () => Promise<unknown>) => task())
      } as never,
      traceStore
    });

    await expect((service as any).solveEntry('attempt-1', 'q-1')).resolves.toBeNull();

    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_request_failed',
          message: 'api key未配置，无法调用 AI 解题',
          data: expect.objectContaining({
            attemptId: 'attempt-1',
            exerciseEntryId: 'entry-1',
            questionId: 'q-1',
            provider: 'qwen_vl'
          })
        })
      ])
    );
  });

  it('normalizes qwen network fetch failures into a readable message', async () => {
    const traceStore = new AutoplayDebugTraceStore();
    const attempt = {
      id: 'attempt-2',
      runId: 'run-2',
      questionRowId: 1,
      exerciseEntryId: 'entry-2',
      problemId: 'problem-2',
      problemType: 1,
      provider: null,
      model: null,
      answerJson: null,
      confidence: null,
      reasoningSummary: null,
      collectStatus: 'ready',
      solveStatus: 'pending',
      submitStatus: 'pending',
      submitAttempt: 0,
      submitResponseJson: null,
      submittedAt: null,
      lastError: null
    };
    const autoAnswerRepository = {
      getAttempt: vi.fn().mockReturnValue(attempt),
      upsertAttempt: vi.fn()
    };
    const service = new AutoAnswerService({
      browserController: {} as never,
      runtimeRepository: {} as never,
      assistRepository: {} as never,
      autoAnswerRepository: autoAnswerRepository as never,
      questionSolveService: {
        solveQuestion: vi.fn().mockRejectedValue(new Error('fetch failed'))
      } as never,
      automationStore: {
        executeTask: vi.fn(async (_type: string, _summary: string, task: () => Promise<unknown>) => task())
      } as never,
      traceStore
    });

    await expect((service as any).solveEntry('attempt-2', 'q-2')).resolves.toBeNull();

    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_request_failed',
          message: 'Qwen 接口连接失败，请检查当前网络或接口地址',
          data: expect.objectContaining({
            attemptId: 'attempt-2',
            exerciseEntryId: 'entry-2',
            questionId: 'q-2',
            provider: 'qwen_vl',
            reason: 'fetch failed'
          })
        })
      ])
    );
  });
});
