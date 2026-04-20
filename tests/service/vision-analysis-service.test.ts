import { describe, expect, it, vi, afterEach } from 'vitest';
import { VisionAnalysisService } from '../../apps/service/src/assist/vision-analysis-service';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { ApiConfigRepository } from '../../apps/service/src/api-config/api-config-repository';
import { ApiConfigService } from '../../apps/service/src/api-config/api-config-service';

describe('VisionAnalysisService', () => {
  afterEach(() => {
    delete process.env.QWEN_VL_API_KEY;
  });

  it('records a failed qwen request when the api key is missing', async () => {
    delete process.env.QWEN_VL_API_KEY;

    const traceStore = new AutoplayDebugTraceStore();
    const repository = {
      getLatestCaptureByQuestionId: vi.fn().mockReturnValue({
        id: 1,
        questionId: 'q-1',
        filePath: '/tmp/question.png',
        mimeType: 'image/png',
        width: null,
        height: null,
        sha256: null,
        createdAt: '2026-04-20T00:00:00.000Z'
      }),
      getQuestionByQuestionId: vi.fn().mockReturnValue({
        id: 1,
        questionId: 'q-1',
        courseTitle: 'test',
        type: 'single_choice',
        body: '测试题干',
        options: [
          { key: 'A', value: 'A' },
          { key: 'B', value: 'B' }
        ]
      }),
      saveVisionAnalysis: vi.fn(),
      getCurrentAnalysisByQuestionId: vi.fn()
    };
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const apiConfigService = new ApiConfigService(new ApiConfigRepository(databaseClient));
    const service = new VisionAnalysisService(repository as never, undefined, traceStore, apiConfigService);

    await expect(service.analyzeQuestionImage({ questionId: 'q-1' })).rejects.toThrow(
      'QWEN_VL_API_KEY is not configured'
    );

    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'ai_request_failed',
          message: 'api key未配置，无法调用 AI 解题',
          data: expect.objectContaining({
            questionId: 'q-1',
            provider: 'qwen_vl',
            reason: 'QWEN_VL_API_KEY is not configured'
          })
        })
      ])
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[vision-analysis] Qwen request failed',
      expect.objectContaining({
        questionId: 'q-1',
        provider: 'qwen_vl',
        reason: 'api key未配置，无法调用 AI 解题'
      })
    );

    consoleErrorSpy.mockRestore();
  });
});
