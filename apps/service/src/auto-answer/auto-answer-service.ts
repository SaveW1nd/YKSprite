import { downloadQuestionImage } from '../assist/question-image-download.js';
import { normalizeAiErrorMessage } from '../assist/ai-error-message.js';
import type { AutomationStore } from '../automation/automation-store.js';
import type {
  BrowserController,
  DetectedQuestionEvent,
  ExerciseRuntimeState,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult
} from '../browser/browser-controller.js';
import type { AssistRepository } from '../db/assist-repository.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import type { QuestionRecord, RuntimeStatus } from '../runtime/runtime-types.js';
import type { AutoAnswerRepository } from './auto-answer-repository.js';
import type {
  AutoAnswerAttemptRecord,
  AutoAnswerRunRecord,
  AutoAnswerStatus,
  SolvedAnswer
} from './auto-answer-types.js';
import { QuestionSolveService } from './question-solve-service.js';
import type { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';
import { buildRuntimeStateFromPresentationSlide } from '../browser/question-runtime.js';

type CollectResult = {
  attempt: AutoAnswerAttemptRecord;
  questionId: string;
  runtimeState: ExerciseRuntimeState;
};

type AutoAnswerServiceOptions = {
  accountId?: number | null;
  accountUserId?: string | null;
  browserController: BrowserController;
  runtimeRepository: RuntimeRepository;
  assistRepository: AssistRepository;
  autoAnswerRepository: AutoAnswerRepository;
  questionSolveService: QuestionSolveService;
  automationStore: AutomationStore;
  traceStore?: AutoplayDebugTraceStore;
};

const normalizeRuntimeQuestionType = (problemType: number, defaultType: string) => {
  switch (problemType) {
    case 1:
      return 'single_choice';
    case 2:
      return 'multiple_choice';
    case 4:
      return 'fill_in';
    case 5:
      return 'subjective';
    default:
      return defaultType;
  }
};

const createInitialStatus = (): AutoAnswerStatus => ({
  runId: null,
  status: 'idle',
  stage: 'idle',
  lessonId: null,
  currentExerciseEntryId: null,
  totalCount: 0,
  collectedCount: 0,
  solvedCount: 0,
  successCount: 0,
  failedCount: 0,
  lastError: null
});

const buildQuestionIdFromRuntimeState = (runtimeState: ExerciseRuntimeState) => {
  const suffix = runtimeState.exerciseIndex ?? runtimeState.problemId;
  if (runtimeState.routePath?.includes('/subjective/')) {
    return `subjective-${suffix}`;
  }
  return `exercise-${suffix}`;
};

const buildQuestionRecordFromRuntimeState = (
  runtimeState: ExerciseRuntimeState,
  courseTitle: string | null
): QuestionRecord => ({
  questionId: buildQuestionIdFromRuntimeState(runtimeState),
  courseTitle,
  type: normalizeRuntimeQuestionType(runtimeState.problemType, 'single_choice'),
  body: runtimeState.questionText?.trim() ?? '',
  options: runtimeState.options,
  slideIndex: runtimeState.pageIndex,
  detectedAt: new Date().toISOString(),
  source: 'mixed'
});

const buildRuntimeStatusForQuestion = (runtimeState: ExerciseRuntimeState, currentUrl: string, courseTitle: string | null): RuntimeStatus => ({
  connected: true,
  loggedIn: true,
  courseTitle,
  lessonState: 'in_class',
  checkinAvailable: false,
  questionDetected: true,
  currentUrl,
  pageTitle: null,
  lastScannedAt: new Date().toISOString()
});

type AutoAnswerTarget = {
  entryId: string;
  runtimeState: ExerciseRuntimeState;
  presentationImageUrl: string;
};

export class AutoAnswerService {
  private readonly browserController: BrowserController;
  private readonly runtimeRepository: RuntimeRepository;
  private readonly assistRepository: AssistRepository;
  private readonly autoAnswerRepository: AutoAnswerRepository;
  private readonly questionSolveService: QuestionSolveService;
  private readonly automationStore: AutomationStore;
  private readonly traceStore: AutoplayDebugTraceStore | null;
  private readonly accountId: number | null;
  private readonly accountUserId: string | null;

  private status: AutoAnswerStatus = createInitialStatus();
  private activePromise: Promise<void> | null = null;
  private stopRequested = false;

  constructor(options: AutoAnswerServiceOptions) {
    this.accountId = options.accountId ?? null;
    this.accountUserId = options.accountUserId ?? null;
    this.browserController = options.browserController;
    this.runtimeRepository = options.runtimeRepository;
    this.assistRepository = options.assistRepository;
    this.autoAnswerRepository = options.autoAnswerRepository;
    this.questionSolveService = options.questionSolveService;
    this.automationStore = options.automationStore;
    this.traceStore = options.traceStore ?? null;
  }

  getStatus() {
    return { ...this.status };
  }

  listRuns() {
    return this.autoAnswerRepository.listRuns();
  }

  getRunDetail(runId: string) {
    const run = this.autoAnswerRepository.getRun(runId);
    if (!run) {
      return null;
    }

    return {
      run,
      attempts: this.autoAnswerRepository.listAttemptsByRunId(runId)
    };
  }

  async start(input: { preferredQuestion: DetectedQuestionEvent }) {
    if (this.activePromise) {
      return this.getStatus();
    }

    const run: AutoAnswerRunRecord = {
      id: `run-${Date.now()}`,
      status: 'running',
      accountId: this.accountId,
      accountUserId: this.accountUserId,
      lessonId: null,
      courseTitle: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      totalCount: 0,
      collectedCount: 0,
      solvedCount: 0,
      successCount: 0,
      failedCount: 0,
      lastError: null
    };

    this.stopRequested = false;
    this.status = {
      runId: run.id,
      status: 'running',
      stage: 'collecting',
      lessonId: null,
      currentExerciseEntryId: null,
      totalCount: 0,
      collectedCount: 0,
      solvedCount: 0,
      successCount: 0,
      failedCount: 0,
      lastError: null
    };
    this.autoAnswerRepository.upsertRun(run);

    this.activePromise = this.executeRun(run, input.preferredQuestion).finally(() => {
      this.activePromise = null;
      this.stopRequested = false;
    });

    return this.getStatus();
  }

  async stop() {
    this.stopRequested = true;
    return this.getStatus();
  }

  private async executeRun(run: AutoAnswerRunRecord, preferredQuestion: DetectedQuestionEvent) {
    try {
      const lessonId = preferredQuestion.lessonId;
      if (!lessonId || !preferredQuestion.problemId) {
        throw new Error('Detected question event is missing lesson or problem id');
      }
      if (!preferredQuestion.presentationId) {
        throw new Error('Detected question event is missing presentation id');
      }

      run.lessonId = lessonId;
      run.courseTitle = preferredQuestion.courseTitle ?? null;
      this.status.lessonId = lessonId;
      this.autoAnswerRepository.upsertRun(run);

      if (this.hasRecentlySubmittedProblem(lessonId, preferredQuestion.problemId)) {
        await this.completeRunForAlreadySubmittedQuestion(run, preferredQuestion);
        return;
      }

      const currentTarget = await this.discoverCurrentTarget(lessonId, preferredQuestion);
      run.totalCount = 1;
      this.status.totalCount = run.totalCount;
      this.autoAnswerRepository.upsertRun(run);

      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      this.status.currentExerciseEntryId = currentTarget.entryId;
      const collected = await this.collectEntry(run, currentTarget.entryId, currentTarget.runtimeState, currentTarget.presentationImageUrl);
      if (collected) {
        run.collectedCount = 1;
        this.status.collectedCount = 1;
        this.autoAnswerRepository.upsertRun(run);
      } else {
        run.failedCount = 1;
        this.status.failedCount = 1;
        this.autoAnswerRepository.upsertRun(run);
      }

      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      this.status.stage = 'solving';
      const solved = collected ? await this.solveEntry(collected.attempt.id, collected.questionId) : null;

      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      this.status.stage = 'submitting';
      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      if (!collected || !solved || !solved.isSubmittable) {
        if (collected && solved && !solved.isSubmittable) {
          const attempt = this.autoAnswerRepository.getAttempt(collected.attempt.id);
          if (attempt) {
            attempt.submitStatus = 'failed';
            attempt.lastError = 'AI returned an empty answer';
            this.autoAnswerRepository.upsertAttempt(attempt);
          }
        }
        run.failedCount = 1;
        this.status.failedCount = 1;
        this.autoAnswerRepository.upsertRun(run);
      } else {
        this.status.currentExerciseEntryId = collected.attempt.exerciseEntryId;
        const submitted = await this.submitEntry(collected.attempt.id, collected.runtimeState, solved);
        run.successCount = submitted ? 1 : 0;
        run.failedCount = submitted ? 0 : 1;
        this.status.successCount = run.successCount;
        this.status.failedCount = run.failedCount;
        this.autoAnswerRepository.upsertRun(run);
      }

      run.status = 'succeeded';
      run.finishedAt = new Date().toISOString();
      this.status.status = 'succeeded';
      this.status.stage = 'idle';
      this.status.currentExerciseEntryId = null;
      this.autoAnswerRepository.upsertRun(run);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown autoplay error';
      run.status = 'failed';
      run.finishedAt = new Date().toISOString();
      run.lastError = message;
      this.status.status = 'failed';
      this.status.stage = 'idle';
      this.status.currentExerciseEntryId = null;
      this.status.lastError = message;
      this.autoAnswerRepository.upsertRun(run);
    }
  }

  private async cancelRun(run: AutoAnswerRunRecord) {
    run.status = 'cancelled';
    run.finishedAt = new Date().toISOString();
    this.status.status = 'cancelled';
    this.status.stage = 'idle';
    this.status.currentExerciseEntryId = null;
    this.autoAnswerRepository.upsertRun(run);
  }

  private async discoverCurrentTarget(
    lessonId: string,
    preferredQuestion: DetectedQuestionEvent
  ): Promise<AutoAnswerTarget> {
    if (preferredQuestion.lessonId !== lessonId) {
      throw new Error(`Detected question belongs to another lesson: ${preferredQuestion.lessonId}`);
    }
    if (!this.browserController.listLessonPresentationSlides) {
      throw new Error('Presentation fetch is not available for autoplay');
    }
    if (!preferredQuestion.presentationId) {
      throw new Error('Detected question event is missing presentation id');
    }

    const slides = await this.browserController.listLessonPresentationSlides(lessonId, preferredQuestion.presentationId);
    const slide = slides.find((item) => item.problemId === preferredQuestion.problemId) ?? null;
    if (!slide) {
      throw new Error(`Presentation slide was not found for problem ${preferredQuestion.problemId}`);
    }

    const runtimeState = buildRuntimeStateFromPresentationSlide(
      lessonId,
      slide,
      preferredQuestion.pageIndex ?? slide.pageIndex ?? 0
    );
    if (!runtimeState) {
      throw new Error(`Presentation slide could not build runtime state for problem ${preferredQuestion.problemId}`);
    }
    if (!slide.imageUrl) {
      throw new Error(`No presentation slide image available for problem ${preferredQuestion.problemId}`);
    }

    return {
      entryId: `preferred-${preferredQuestion.problemId}`,
      runtimeState,
      presentationImageUrl: slide.imageUrl
    };
  }

  private hasRecentlySubmittedProblem(lessonId: string, problemId: string | null) {
    if (!problemId) {
      return false;
    }

    return Boolean(this.autoAnswerRepository.findLatestSuccessfulAttemptForProblem(lessonId, problemId));
  }

  private async completeRunForAlreadySubmittedQuestion(run: AutoAnswerRunRecord, preferredQuestion: DetectedQuestionEvent) {
    const entryId = `preferred-${preferredQuestion.problemId}`;
    run.totalCount = 1;
    run.successCount = 1;
    run.status = 'succeeded';
    run.finishedAt = new Date().toISOString();
    run.lastError = null;
    this.status = {
      ...this.status,
      status: 'succeeded',
      stage: 'idle',
      currentExerciseEntryId: null,
      totalCount: 1,
      successCount: 1,
      failedCount: 0,
      lastError: null
    };
    this.traceStore?.record('submit_result', `Skipped already completed question ${entryId}`, {
      attemptId: null,
      exerciseEntryId: entryId,
      problemId: preferredQuestion.problemId,
      ok: true,
      code: 0,
      message: 'LOCAL_ALREADY_COMPLETED',
      responseJson: {
        status: 'already_completed',
        source: 'local_history'
      }
    });
    this.autoAnswerRepository.upsertRun(run);
  }

  private async collectEntry(
    run: AutoAnswerRunRecord,
    entryId: string,
    runtimeState: ExerciseRuntimeState,
    presentationImageUrl: string
  ): Promise<CollectResult | null> {
    return this.automationStore.executeTask<CollectResult | null>('auto_answer_collect', `Collect runtime question for ${entryId}`, async () => {
      try {
        this.traceStore?.record('question_collect_started', `Collecting question for ${entryId}`, {
          runId: run.id,
          lessonId: run.lessonId,
          exerciseEntryId: entryId
        });
        this.runtimeRepository.updateExerciseProcessingState(run.lessonId, entryId, {
          analysisStatus: 'processing',
          lastError: null
        });
        const questionRecord = buildQuestionRecordFromRuntimeState(runtimeState, run.courseTitle ?? null);
        const runtimeStatus = buildRuntimeStatusForQuestion(
          runtimeState,
          runtimeState.routePath ?? this.browserController.getStatus().pageUrl ?? '',
          run.courseTitle ?? null
        );
        this.runtimeRepository.saveSnapshot(runtimeStatus, [questionRecord]);
        const currentQuestion = this.runtimeRepository.getCurrentQuestion();
        if (!currentQuestion) {
          throw new Error(`No current question detected for ${entryId}`);
        }
        const downloaded = await downloadQuestionImage(presentationImageUrl);
        this.assistRepository.saveQuestionCapture({
          questionRowId: currentQuestion.id,
          sourceType: 'runtime_ppt',
          filePath: downloaded.filePath,
          mimeType: downloaded.mimeType,
          width: downloaded.width,
          height: downloaded.height,
          sha256: downloaded.sha256
        });
        this.traceStore?.record('question_collect_ready', `Collected question image for ${entryId}`, {
          runId: run.id,
          lessonId: run.lessonId,
          exerciseEntryId: entryId,
          questionId: currentQuestion.questionId,
          problemId: runtimeState.problemId,
          problemType: runtimeState.problemType,
          imageSha256: downloaded.sha256,
          imageMimeType: downloaded.mimeType
        });

        const attempt: AutoAnswerAttemptRecord = {
          id: `attempt-${run.id}-${entryId}`,
          runId: run.id,
          questionRowId: currentQuestion.id,
          exerciseEntryId: entryId,
          problemId: runtimeState.problemId,
          problemType: runtimeState.problemType,
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
        this.autoAnswerRepository.upsertAttempt(attempt);
        return {
          attempt,
          questionId: currentQuestion.questionId,
          runtimeState
        } satisfies CollectResult;
      } catch (error) {
        this.traceStore?.record('question_collect_failed', `Question collect failed for ${entryId}`, {
          runId: run.id,
          lessonId: run.lessonId,
          exerciseEntryId: entryId,
          reason: error instanceof Error ? error.message : 'Unknown collect error'
        });
        const failedAttempt: AutoAnswerAttemptRecord = {
          id: `attempt-${run.id}-${entryId}`,
          runId: run.id,
          questionRowId: null,
          exerciseEntryId: entryId,
          problemId: '',
          problemType: 0,
          provider: null,
          model: null,
          answerJson: null,
          confidence: null,
          reasoningSummary: null,
          collectStatus: 'failed',
          solveStatus: 'pending',
          submitStatus: 'pending',
          submitAttempt: 0,
          submitResponseJson: null,
          submittedAt: null,
          lastError: error instanceof Error ? error.message : 'Unknown collect error'
        };
        this.autoAnswerRepository.upsertAttempt(failedAttempt);
        this.runtimeRepository.updateExerciseProcessingState(run.lessonId, entryId, {
          analysisStatus: 'failed',
          lastProcessedAt: new Date().toISOString(),
          lastError: failedAttempt.lastError
        });
        return null;
      }
    });
  }

  private async solveEntry(attemptId: string, questionId: string): Promise<SolvedAnswer | null> {
    const attempt = this.autoAnswerRepository.getAttempt(attemptId);
    if (!attempt) {
      return null;
    }

    attempt.solveStatus = 'running';
    attempt.lastError = null;
    this.autoAnswerRepository.upsertAttempt(attempt);

    try {
      const solved = await this.automationStore.executeTask<SolvedAnswer>('auto_answer_solve', `Solve question ${questionId}`, async () =>
        this.questionSolveService.solveQuestion(questionId)
      );
      attempt.provider = solved.provider;
      attempt.model = solved.model;
      attempt.answerJson = solved.answerJson;
      attempt.confidence = solved.confidence;
      attempt.reasoningSummary = solved.reasoningSummary;
      attempt.solveStatus = 'done';
      this.status.solvedCount += 1;
      this.autoAnswerRepository.upsertAttempt(attempt);
      return solved;
    } catch (error) {
      attempt.solveStatus = 'failed';
      const reason = error instanceof Error ? error.message : 'Unknown solve error';
      const displayReason = normalizeAiErrorMessage(reason, 'qwen_vl');
      attempt.lastError = displayReason;
      this.traceStore?.record('ai_request_failed', attempt.lastError, {
        attemptId,
        exerciseEntryId: attempt.exerciseEntryId,
        questionId,
        provider: 'qwen_vl',
        reason
      });
      this.autoAnswerRepository.upsertAttempt(attempt);
      return null;
    }
  }

  private async submitEntry(
    attemptId: string,
    runtimeState: ExerciseRuntimeState,
    solved: SolvedAnswer
  ): Promise<boolean> {
    const attempt = this.autoAnswerRepository.getAttempt(attemptId);
    if (!attempt) {
      return false;
    }

    const payloadForAttempt = (): LessonProblemSubmitPayload | 'already_completed' => {
      if (runtimeState.isComplete) {
        return 'already_completed';
      }
      return {
        problemId: runtimeState.problemId || attempt.problemId,
        problemType: runtimeState.problemType || attempt.problemType,
        dt: Date.now(),
        result: solved.submitPayloadResult
      };
    };

    const trySubmit = async () => {
      const payload = await payloadForAttempt();
      if (payload === 'already_completed') {
        attempt.submitStatus = 'already_completed';
        attempt.submittedAt = new Date().toISOString();
        this.traceStore?.record('submit_result', `Skipped already completed question ${attempt.exerciseEntryId}`, {
          attemptId,
          exerciseEntryId: attempt.exerciseEntryId,
          questionRowId: attempt.questionRowId,
          ok: true,
          code: 0,
          message: 'RUNTIME_ALREADY_COMPLETED',
          responseJson: {
            status: 'already_completed',
            source: 'runtime_state'
          }
        });
        this.autoAnswerRepository.upsertAttempt(attempt);
        this.runtimeRepository.updateExerciseProcessingState(this.status.lessonId, attempt.exerciseEntryId, {
          analysisStatus: 'done',
          lastProcessedAt: attempt.submittedAt,
          lastError: null
        });
        return true;
      }

      this.traceStore?.record('submit_payload', `Submitting answer for ${attempt.exerciseEntryId}`, {
        attemptId,
        exerciseEntryId: attempt.exerciseEntryId,
        questionRowId: attempt.questionRowId,
        payload
      });
      const result = await this.browserController.submitLessonProblem(payload);
      const treatedAsSuccess = result.ok || isAlreadyAnsweredSubmitResult(result);
      attempt.submitAttempt += 1;
      attempt.submitResponseJson = JSON.stringify(result.responseJson);
      this.traceStore?.record('submit_result', `Submit ${treatedAsSuccess ? 'succeeded' : 'failed'} for ${attempt.exerciseEntryId}`, {
        attemptId,
        exerciseEntryId: attempt.exerciseEntryId,
        ok: treatedAsSuccess,
        code: result.code,
        message: result.message,
        responseJson: result.responseJson
      });
      if (treatedAsSuccess) {
        attempt.submitStatus = result.ok ? 'submitted' : 'already_completed';
        attempt.submittedAt = new Date().toISOString();
        attempt.lastError = null;
        this.autoAnswerRepository.upsertAttempt(attempt);
        this.runtimeRepository.updateExerciseProcessingState(this.status.lessonId, attempt.exerciseEntryId, {
          analysisStatus: 'done',
          lastProcessedAt: attempt.submittedAt,
          lastError: null
        });
        return true;
      }

      attempt.lastError = result.message;
      this.autoAnswerRepository.upsertAttempt(attempt);
      return false;
    };

    return this.automationStore.executeTask<boolean>('auto_answer_submit', `Submit answer for ${attempt.exerciseEntryId}`, async () => {
      const submitted = await trySubmit();
      if (!submitted) {
        attempt.submitStatus = 'failed';
        this.autoAnswerRepository.upsertAttempt(attempt);
        this.runtimeRepository.updateExerciseProcessingState(this.status.lessonId, attempt.exerciseEntryId, {
          analysisStatus: 'failed',
          lastProcessedAt: new Date().toISOString(),
          lastError: attempt.lastError
        });
      }
      return submitted;
    }).catch(() => false);
  }
}

const isAlreadyAnsweredSubmitResult = (result: LessonProblemSubmitResult) =>
  result.code === 50028 || result.message === 'LESSON_PROBLEM_ALREADY_ANSWERED';
