import { describe, expect, it, vi } from 'vitest';
vi.mock('../../apps/service/src/assist/question-image-download', () => ({
  downloadQuestionImage: vi.fn()
}));

vi.mock('../../apps/service/src/assist/ocr-service', () => ({
  extractOcrResult: vi.fn()
}));

import { AutoAnswerService } from '../../apps/service/src/auto-answer/auto-answer-service';
import { AutoplayDebugTraceStore } from '../../apps/service/src/debug/autoplay-debug-trace';
import { downloadQuestionImage } from '../../apps/service/src/assist/question-image-download';
import { extractOcrResult } from '../../apps/service/src/assist/ocr-service';
import { buildRuntimeStateFromPresentationSlide } from '../../apps/service/src/browser/question-runtime';

const createCollectService = () => {
  const browserController = {
    getStatus: vi.fn(() => ({
      status: 'running',
      engine: 'chromium',
      headless: true,
      mode: 'headless',
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
    saveQuestionCapture: vi.fn(),
    saveOcrResult: vi.fn()
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
    } as never
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
  it('uses preferredQuestion.routePath as the only answer target when a pushed question is provided', async () => {
    const service = new AutoAnswerService({
      browserController: {
        getStatus: vi.fn(() => ({
          status: 'running',
          engine: 'chromium',
          headless: true,
          mode: 'headless',
          startedAt: '2026-04-20T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          lastError: null
        })),
        getSessionState: vi.fn(async () => ({
          hasSession: true,
          savedAt: '2026-04-20T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 2,
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          pageTitle: '雨课堂',
          mode: 'headless'
        })),
        discoverLessons: vi.fn(async () => [
          {
            id: 'lesson-1',
            classroomId: 'classroom-1',
            courseTitle: '高等数学',
            lessonTitle: '第一讲',
            lessonState: 'in_class',
            href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
          }
        ]),
        listExerciseEntries: vi.fn(async () => {
          throw new Error('listExerciseEntries should not be used');
        }),
        readExerciseRuntimeState: vi.fn(async () => null)
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
      {
        id: 'lesson-1',
        classroomId: 'classroom-1',
        courseTitle: '高等数学',
        lessonTitle: '第一讲',
        lessonState: 'in_class',
        href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
      },
      {
        lessonId: 'lesson-1',
        problemId: 'problem-20',
        problemType: 2,
        exerciseIndex: null,
        routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
        isComplete: false,
        imageUrl: null,
        detectedAt: '2026-04-20T06:00:00.000Z',
        pageIndex: 20,
        source: 'curr-slide-event'
      }
    );

    expect(target).toEqual(
      expect.objectContaining({
        entryId: 'preferred-problem-20',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/18'
      })
    );
  });

  it('prefers the current question slide over a mismatched pushed routePath', async () => {
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
    const service = new AutoAnswerService({
      browserController: {
        getStatus: vi.fn(() => ({
          status: 'running',
          engine: 'chromium',
          headless: true,
          mode: 'headless',
          startedAt: '2026-04-20T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          lastError: null
        })),
        listLessonPresentationSlides: vi.fn(async () => [slide]),
        getSessionState: vi.fn(async () => ({
          hasSession: true,
          savedAt: '2026-04-20T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 2,
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1',
          pageTitle: '雨课堂',
          mode: 'headless'
        })),
        discoverLessons: vi.fn(async () => []),
        listExerciseEntries: vi.fn(async () => []),
        readExerciseRuntimeState: vi.fn(async () => null)
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
      {
        id: 'lesson-1',
        classroomId: 'classroom-1',
        courseTitle: '高等数学',
        lessonTitle: '第一讲',
        lessonState: 'in_class',
        href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
      },
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
        source: 'wsapp-unlockproblem'
      }
    );

    expect(target).toEqual(
      expect.objectContaining({
        entryId: 'preferred-problem-20',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4',
        runtimeState
      })
    );
  });

  it('builds the answer target from the presentation slide when a pushed question has no routePath', async () => {
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
          engine: 'chromium',
          headless: true,
          mode: 'headless',
          startedAt: '2026-04-20T00:00:00.000Z',
          pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4',
          lastError: null
        })),
        listLessonPresentationSlides: vi.fn(async () => [slide]),
        getSessionState: vi.fn(async () => ({
          hasSession: true,
          savedAt: '2026-04-20T00:00:00.000Z',
          origin: 'www.yuketang.cn',
          cookieCount: 2,
          currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/4',
          pageTitle: '雨课堂',
          mode: 'headless'
        })),
        discoverLessons: vi.fn(async () => []),
        listExerciseEntries: vi.fn(async () => []),
        readExerciseRuntimeState: vi.fn(async () => null)
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
      {
        id: 'lesson-1',
        classroomId: 'classroom-1',
        courseTitle: '高等数学',
        lessonTitle: '第一讲',
        lessonState: 'in_class',
        href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
      },
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
        source: 'presentation-slide'
      }
    );

    expect(target).toEqual(
      expect.objectContaining({
        entryId: 'preferred-problem-20',
        exerciseUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/4',
        runtimeState
      })
    );
  });

  it('fails early when no preferredQuestion is provided to the answer execution path', async () => {
    const service = new AutoAnswerService({
      browserController: {} as any,
      runtimeRepository: {} as any,
      assistRepository: {} as any,
      autoAnswerRepository: { upsertRun: vi.fn() } as any,
      questionSolveService: {} as any,
      automationStore: {
        executeTask: vi.fn(async (_t: string, _s: string, task: () => Promise<unknown>) => task())
      } as any
    });

    await expect(
      (service as any).discoverCurrentTarget(
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        },
        null
      )
    ).resolves.toBeNull();
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

  it('downloads the current question image from presentation fetch without using runtimeState.imageUrl', async () => {
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
    const { service, browserController, assistRepository } = createCollectService();
    browserController.readCurrentQuestionPresentationSlide.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      pageIndex: 20,
      problemId: 'problem-20',
      problemType: 1,
      imageUrl: 'https://example.com/presentation-20.jpg',
      imageThumbnailUrl: 'https://example.com/presentation-20-thumb.jpg',
      raw: {}
    });
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
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20',
      runtimeState
    );

    expect(result).not.toBeNull();
    expect(browserController.readCurrentQuestionPresentationSlide).toHaveBeenCalledWith('lesson-1', {
      problemId: 'problem-20'
    });
    expect(downloadQuestionImage).toHaveBeenCalledWith('https://example.com/presentation-20.jpg');
    expect(assistRepository.saveQuestionCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        questionRowId: 1,
        sourceType: 'runtime_ppt',
        filePath: '/tmp/presentation-20.jpg'
      })
    );
    expect(browserController.captureScreenshot).not.toHaveBeenCalled();
    expect(extractOcrResult).not.toHaveBeenCalled();
  });

  it('collects the current question from the presentation slide when runtime state cannot be read from the page', async () => {
    const { service, browserController, assistRepository } = createCollectService();
    browserController.readExerciseRuntimeState.mockResolvedValue(null);
    browserController.readCurrentQuestionPresentationSlide.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '2',
      pageIndex: 8,
      problemId: 'problem-20',
      problemType: 5,
      imageUrl: 'https://example.com/presentation-20.jpg',
      imageThumbnailUrl: 'https://example.com/presentation-20-thumb.jpg',
      raw: {
        index: 8,
        problem: {
          problemId: 'problem-20',
          problemType: 5,
          body: '主观题内容'
        }
      }
    });
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
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/3',
      null
    );

    expect(result).not.toBeNull();
    expect(result?.runtimeState).toEqual(
      expect.objectContaining({
        lessonId: 'lesson-1',
        exerciseIndex: '2',
        problemId: 'problem-20',
        problemType: 5,
        routePath: '/lesson/fullscreen/v3/lesson-1/subjective/2'
      })
    );
    expect(browserController.navigate).toHaveBeenCalledWith(
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/3'
    );
    expect(browserController.readCurrentQuestionPresentationSlide).toHaveBeenCalledWith('lesson-1', {
      problemId: null
    });
    expect(downloadQuestionImage).toHaveBeenCalledWith('https://example.com/presentation-20.jpg');
    expect(assistRepository.saveQuestionCapture).toHaveBeenCalledWith(
      expect.objectContaining({
        questionRowId: 1,
        sourceType: 'runtime_ppt',
        filePath: '/tmp/presentation-20.jpg'
      })
    );
  });

  it('retries runtime resolution until the current question slide becomes available', async () => {
    const { service, browserController } = createCollectService();
    browserController.readExerciseRuntimeState
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        lessonId: 'lesson-1',
        exerciseIndex: '5',
        problemId: 'problem-20',
        problemType: 1,
        pageIndex: 9,
        questionText: '题目内容',
        options: [],
        imageUrl: 'https://example.com/runtime.jpg',
        imageThumbnailUrl: null,
        isComplete: false,
        routePath: '/lesson/fullscreen/v3/lesson-1/exercise/5'
      });
    browserController.readCurrentQuestionPresentationSlide
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({
        lessonId: 'lesson-1',
        exerciseIndex: '4',
        pageIndex: 10,
        problemId: 'problem-20',
        problemType: 1,
        imageUrl: 'https://example.com/presentation-20.jpg',
        imageThumbnailUrl: 'https://example.com/presentation-20-thumb.jpg',
        raw: {
          index: 10,
          problem: {
            problemId: 'problem-20',
            problemType: 1,
            body: '题目内容'
          }
        }
      });
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
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/5',
      null
    );

    expect(result).not.toBeNull();
    expect(browserController.readExerciseRuntimeState).toHaveBeenCalledTimes(3);
    expect(browserController.readCurrentQuestionPresentationSlide).toHaveBeenCalledTimes(3);
  });

  it('fails collect when the presentation slide has no image instead of falling back to screenshot', async () => {
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
    browserController.readCurrentQuestionPresentationSlide.mockResolvedValue({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      pageIndex: 20,
      problemId: 'problem-20',
      problemType: 1,
      imageUrl: null,
      imageThumbnailUrl: null,
      raw: {}
    });

    const result = await (service as any).collectEntry(
      { id: 'run-1', lessonId: 'lesson-1' },
      'entry-20',
      'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20',
      runtimeState
    );

    expect(result).toBeNull();
    expect(browserController.captureScreenshot).not.toHaveBeenCalled();
    expect(assistRepository.saveOcrResult).not.toHaveBeenCalled();
    expect(autoAnswerRepository.upsertAttempt).toHaveBeenCalledWith(
      expect.objectContaining({
        collectStatus: 'failed',
        lastError: 'No presentation slide image available for entry-20'
      })
    );
  });
});
