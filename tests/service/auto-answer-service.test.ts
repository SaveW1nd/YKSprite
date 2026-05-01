import { describe, expect, it, vi } from 'vitest';
vi.mock('../../apps/service/src/assist/question-image-download', () => ({
  downloadQuestionImage: vi.fn()
}));

import { AutoAnswerService } from '../../apps/service/src/auto-answer/auto-answer-service';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';
import { downloadQuestionImage } from '../../apps/service/src/assist/question-image-download';
import { buildRuntimeStateFromPresentationSlide } from '../../apps/service/src/browser/question-runtime';

const createCollectService = (traceStore?: AutoplayDebugTraceStore) => {
  const browserController = {
    getStatus: vi.fn(() => ({
      status: 'running',
      engine: 'http',
      mode: 'http',
      startedAt: '2026-04-20T00:00:00.000Z',
      pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20',
      lastError: null
    })),
    navigate: vi.fn(),
    readExerciseRuntimeState: vi.fn(),
    readCurrentQuestionPresentationSlide: vi.fn(),
    captureScreenshot: vi.fn()
  };
  const runtimeRepository = {
    updateExerciseProcessingState: vi.fn(),
    saveSnapshot: vi.fn(),
    getCurrentQuestion: vi.fn(() => ({
      id: 1,
      questionId: 'exercise-20'
    }))
  };
  const assistRepository = {
    saveQuestionCapture: vi.fn()
  };
  const autoAnswerRepository = {
    upsertAttempt: vi.fn(),
    getAttempt: vi.fn(),
    findLatestSuccessfulAttemptForProblem: vi.fn(() => null)
  };
  const service = new AutoAnswerService({
    browserController: browserController as never,
    runtimeRepository: runtimeRepository as never,
    assistRepository: assistRepository as never,
    autoAnswerRepository: autoAnswerRepository as never,
    questionSolveService: {} as never,
    automationStore: {
      executeTask: vi.fn(async (_type: string, _summary: string, task: () => Promise<unknown>) => task())
    } as never,
    traceStore
  });

  return {
    service,
    browserController,
    runtimeRepository,
    assistRepository,
    autoAnswerRepository
  };
};

describe('AutoAnswerService', () => {
  it('finishes immediately when the preferred pushed question was already submitted locally', async () => {
    const traceStore = new AutoplayDebugTraceStore();
    const autoAnswerRepository = {
      upsertRun: vi.fn(),
      findLatestSuccessfulAttemptForProblem: vi.fn(() => ({ id: 'old-attempt' }))
    };
    const service = new AutoAnswerService({
      browserController: {} as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: autoAnswerRepository as any,
      questionSolveService: {} as any,
      automationStore: {} as any,
      traceStore
    });
    const run = {
      id: 'run-1',
      status: 'running',
      lessonId: 'lesson-1',
      startedAt: '2026-04-20T00:00:00.000Z',
      finishedAt: null,
      totalCount: 0,
      collectedCount: 0,
      solvedCount: 0,
      successCount: 0,
      failedCount: 0,
      lastError: null
    };

    await (service as any).completeRunForAlreadySubmittedQuestion(run, {
      lessonId: 'lesson-1',
      problemId: 'problem-20',
      problemType: 1,
      exerciseIndex: '20',
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20',
      isComplete: false,
      imageUrl: null,
      detectedAt: '2026-04-20T06:00:00.000Z'
    });

    expect(run).toEqual(
      expect.objectContaining({
        status: 'succeeded',
        totalCount: 1,
        successCount: 1,
        failedCount: 0,
        lastError: null
      })
    );
    expect(autoAnswerRepository.upsertRun).toHaveBeenCalledWith(run);
    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'submit_result',
          data: expect.objectContaining({
            exerciseEntryId: 'preferred-problem-20',
            ok: true,
            message: 'LOCAL_ALREADY_COMPLETED'
          })
        })
      ])
    );
  });

  it('builds the answer target only from the presentation slide for a pushed question', async () => {
    const slide = {
      lessonId: 'lesson-1',
      exerciseIndex: '4',
      pageIndex: 10,
      problemId: 'problem-20',
      problemType: 1,
      imageUrl: 'https://example.com/problem-20.jpg',
      imageThumbnailUrl: 'https://example.com/problem-20-thumb.jpg',
      raw: {
        index: 10,
        problem: {
          problemId: 'problem-20',
          problemType: 1,
          body: '题目内容'
        }
      }
    } as const;
    const runtimeState = buildRuntimeStateFromPresentationSlide('lesson-1', slide, 10);
    const listLessonPresentationSlides = vi.fn(async () => [slide]);
    const service = new AutoAnswerService({
      browserController: {
        getStatus: vi.fn(() => ({
          status: 'running',
          engine: 'http',
          mode: 'http',
          startedAt: '2026-04-20T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          lastError: null
        })),
        listLessonPresentationSlides,
        navigate: vi.fn(),
        discoverLessons: vi.fn(),
        listExerciseEntries: vi.fn(),
        readExerciseRuntimeState: vi.fn()
      } as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {
        upsertRun: vi.fn(),
        listRuns: vi.fn(() => []),
        getRun: vi.fn(() => null),
        listAttemptsByRunId: vi.fn(() => [])
      } as any,
      questionSolveService: {} as any,
      automationStore: {
        executeTask: vi.fn(async (_t: string, _s: string, task: () => Promise<unknown>) => task())
      } as any
    });

    const target = await (service as any).discoverCurrentTarget(
      'lesson-1',
      {
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 1,
        exerciseIndex: null,
        routePath: '/lesson/fullscreen/v3/lesson-1/exercise/5',
        isComplete: false,
        imageUrl: null,
        detectedAt: '2026-04-20T06:00:00.000Z',
        pageIndex: 10,
        presentationId: 'presentation-1',
        source: 'wsapp-unlockproblem'
      }
    );

    expect(listLessonPresentationSlides).toHaveBeenCalledWith('lesson-1', 'presentation-1');
    expect(target).toEqual(
      expect.objectContaining({
        entryId: 'preferred-problem-20',
        runtimeState,
        presentationImageUrl: 'https://example.com/problem-20.jpg'
      })
    );
  });

  it('fails when the pushed question is missing presentation id', async () => {
    const service = new AutoAnswerService({
      browserController: {
        listLessonPresentationSlides: vi.fn()
      } as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {
        upsertRun: vi.fn()
      } as any,
      questionSolveService: {} as any,
      automationStore: {} as any
    });

    await expect(
      (service as any).discoverCurrentTarget('lesson-1', {
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 1,
        exerciseIndex: null,
        routePath: null,
        isComplete: false,
        imageUrl: null,
        detectedAt: '2026-04-20T06:00:00.000Z',
        pageIndex: 10,
        presentationId: null,
        source: 'wsapp-unlockproblem'
      })
    ).rejects.toThrow('Detected question event is missing presentation id');
  });

  it('fails when the presentation slide cannot be found for the pushed problem', async () => {
    const service = new AutoAnswerService({
      browserController: {
        listLessonPresentationSlides: vi.fn(async () => [])
      } as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {
        upsertRun: vi.fn()
      } as any,
      questionSolveService: {} as any,
      automationStore: {} as any
    });

    await expect(
      (service as any).discoverCurrentTarget('lesson-1', {
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 1,
        exerciseIndex: null,
        routePath: '/lesson/fullscreen/v3/lesson-1/exercise/5',
        isComplete: false,
        imageUrl: null,
        detectedAt: '2026-04-20T06:00:00.000Z',
        pageIndex: 10,
        presentationId: 'presentation-1',
        source: 'wsapp-unlockproblem'
      })
    ).rejects.toThrow('Presentation slide was not found for problem problem-20');
  });

  it('keeps subjective slide targeting on the presentation data path', async () => {
    const slide = {
      lessonId: 'lesson-1',
      exerciseIndex: '4',
      pageIndex: 11,
      problemId: 'problem-20',
      problemType: 5,
      imageUrl: 'https://example.com/problem-20.jpg',
      imageThumbnailUrl: 'https://example.com/problem-20-thumb.jpg',
      raw: {
        index: 11,
        cover: 'https://example.com/problem-20.jpg',
        thumbnail: 'https://example.com/problem-20-thumb.jpg',
        problem: {
          problemId: 'problem-20',
          problemType: 5,
          body: '题目内容'
        }
      }
    } as const;
    const runtimeState = buildRuntimeStateFromPresentationSlide('lesson-1', slide, 10);
    const service = new AutoAnswerService({
      browserController: {
        getStatus: vi.fn(() => ({
          status: 'running',
          engine: 'http',
          mode: 'http',
          startedAt: '2026-04-20T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4',
          lastError: null
        })),
        listLessonPresentationSlides: vi.fn(async () => [slide])
      } as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: {
        upsertRun: vi.fn(),
        listRuns: vi.fn(() => []),
        getRun: vi.fn(() => null),
        listAttemptsByRunId: vi.fn(() => [])
      } as any,
      questionSolveService: {} as any,
      automationStore: {
        executeTask: vi.fn(async (_t: string, _s: string, task: () => Promise<unknown>) => task())
      } as any
    });

    const target = await (service as any).discoverCurrentTarget(
      'lesson-1',
      {
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 5,
        exerciseIndex: null,
        routePath: null,
        isComplete: false,
        imageUrl: 'https://example.com/problem-20.jpg',
        detectedAt: '2026-04-20T06:00:00.000Z',
        pageIndex: 11,
        presentationId: 'presentation-1',
        source: 'presentation-slide'
      }
    );

    expect(target).toEqual(
      expect.objectContaining({
        entryId: 'preferred-problem-20',
        runtimeState,
        presentationImageUrl: 'https://example.com/problem-20.jpg'
      })
    );
  });

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

  it('downloads the question image from the selected presentation slide only', async () => {
    const runtimeState = {
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      problemId: 'problem-20',
      problemType: 1,
      pageIndex: 20,
      questionText: '第20题',
      options: [],
      imageUrl: 'https://example.com/runtime-should-not-be-used.jpg',
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20'
    };
    const traceStore = new AutoplayDebugTraceStore();
    const { service, browserController, assistRepository } = createCollectService(traceStore);
    vi.mocked(downloadQuestionImage).mockResolvedValue({
      filePath: '/tmp/presentation-20.jpg',
      mimeType: 'image/jpeg',
      width: null,
      height: null,
      sha256: 'hash-20'
    });

    const result = await (service as any).collectEntry(
      { id: 'run-1', lessonId: 'lesson-1' },
      'entry-20',
      runtimeState,
      'https://example.com/presentation-20.jpg'
    );

    expect(result).not.toBeNull();
    expect(downloadQuestionImage).toHaveBeenCalledWith('https://example.com/presentation-20.jpg');
    expect(assistRepository.saveQuestionCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        questionRowId: 1,
        sourceType: 'runtime_ppt',
        filePath: '/tmp/presentation-20.jpg'
      })
    );
    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'question_collect_started',
          data: expect.objectContaining({
            exerciseEntryId: 'entry-20'
          })
        }),
        expect.objectContaining({
          type: 'question_collect_ready',
          data: expect.objectContaining({
            exerciseEntryId: 'entry-20',
            problemId: 'problem-20',
            imageSha256: 'hash-20'
          })
        })
      ])
    );
    expect(browserController.readExerciseRuntimeState).not.toHaveBeenCalled();
    expect(browserController.readCurrentQuestionPresentationSlide).not.toHaveBeenCalled();
    expect(browserController.captureScreenshot).not.toHaveBeenCalled();
  });

  it('records submit_result when runtime state says the question is already completed', async () => {
    const traceStore = new AutoplayDebugTraceStore();
    const attempt = {
      id: 'attempt-1',
      runId: 'run-1',
      questionRowId: 1,
      exerciseEntryId: 'preferred-problem-20',
      problemId: 'problem-20',
      problemType: 1,
      provider: 'qwen_vl',
      model: 'model-1',
      answerJson: '["A"]',
      confidence: 'high',
      reasoningSummary: 'ok',
      collectStatus: 'ready',
      solveStatus: 'done',
      submitStatus: 'pending',
      submitAttempt: 0,
      submitResponseJson: null,
      submittedAt: null,
      lastError: null
    };
    const browserController = {
      getStatus: vi.fn(() => ({
        status: 'running',
        engine: 'http',
        mode: 'http',
        startedAt: '2026-04-20T00:00:00.000Z',
        pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20',
        lastError: null
      })),
      navigate: vi.fn(),
      readExerciseRuntimeState: vi.fn(),
      readCurrentQuestionPresentationSlide: vi.fn(),
      submitLessonProblem: vi.fn()
    };
    const runtimeRepository = {
      updateExerciseProcessingState: vi.fn()
    };
    const autoAnswerRepository = {
      getAttempt: vi.fn(() => attempt),
      upsertAttempt: vi.fn(),
      findLatestSuccessfulAttemptForProblem: vi.fn(() => null)
    };
    const service = new AutoAnswerService({
      browserController: browserController as any,
      runtimeRepository: runtimeRepository as any,
      assistRepository: {} as any,
      autoAnswerRepository: autoAnswerRepository as any,
      questionSolveService: {} as any,
      automationStore: {
        executeTask: vi.fn(async (_type: string, _summary: string, task: () => Promise<unknown>) => task())
      } as any,
      traceStore
    });
    (service as any).status.lessonId = 'lesson-1';

    const submitted = await (service as any).submitEntry(
      'attempt-1',
      {
        lessonId: 'lesson-1',
        exerciseIndex: '20',
        problemId: 'problem-20',
        problemType: 1,
        pageIndex: 20,
        questionText: '题目内容',
        options: [],
        imageUrl: null,
        imageThumbnailUrl: null,
        isComplete: true,
        routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20'
      },
      {
        provider: 'qwen_vl',
        model: 'model-1',
        confidence: 'high',
        reasoningSummary: 'ok',
        answerJson: '["A"]',
        submitPayloadResult: ['A'],
        rawResponseJson: '{}',
        isSubmittable: true
      }
    );

    expect(submitted).toBe(true);
    expect(browserController.submitLessonProblem).not.toHaveBeenCalled();
    expect(autoAnswerRepository.upsertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        submitStatus: 'already_completed',
        lastError: null
      })
    );
    expect(runtimeRepository.updateExerciseProcessingState).toHaveBeenCalledWith('lesson-1', 'preferred-problem-20', {
      analysisStatus: 'done',
      lastProcessedAt: expect.any(String),
      lastError: null
    });
    expect(traceStore.list({ afterId: 0, limit: 10 })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'submit_result',
          data: expect.objectContaining({
            exerciseEntryId: 'preferred-problem-20',
            ok: true,
            message: 'RUNTIME_ALREADY_COMPLETED'
          })
        })
      ])
    );
  });

  it('fails collect when the selected presentation image cannot be downloaded', async () => {
    const runtimeState = {
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      problemId: 'problem-20',
      problemType: 1,
      pageIndex: 20,
      questionText: '第20题',
      options: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20'
    };
    const { service, browserController, assistRepository, autoAnswerRepository } = createCollectService();
    vi.mocked(downloadQuestionImage).mockRejectedValue(new Error('image download failed'));

    const result = await (service as any).collectEntry(
      { id: 'run-1', lessonId: 'lesson-1' },
      'entry-20',
      runtimeState,
      'https://example.com/presentation-20.jpg'
    );

    expect(result).toBeNull();
    expect(browserController.readExerciseRuntimeState).not.toHaveBeenCalled();
    expect(browserController.readCurrentQuestionPresentationSlide).not.toHaveBeenCalled();
    expect(browserController.captureScreenshot).not.toHaveBeenCalled();
    expect(autoAnswerRepository.upsertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        collectStatus: 'failed',
        lastError: 'image download failed'
      })
    );
  });
});
