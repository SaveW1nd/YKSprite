import { extractOcrResult } from '../assist/ocr-service.js';
import type { AutomationStore } from '../automation/automation-store.js';
import type {
  BrowserController,
  ExerciseRuntimeState,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult,
  LessonCandidate
} from '../browser/browser-controller.js';
import type { AssistRepository } from '../db/assist-repository.js';
import type { RuntimeRepository } from '../db/runtime-repository.js';
import { extractQuestionsFromHtml } from '../runtime/question-extractor.js';
import { probeRuntimeStatus } from '../runtime/runtime-probe.js';
import type { AutoAnswerRepository } from './auto-answer-repository.js';
import type {
  AutoAnswerAttemptRecord,
  AutoAnswerRunRecord,
  AutoAnswerStatus,
  SolvedAnswer
} from './auto-answer-types.js';
import { QuestionSolveService } from './question-solve-service.js';

type CollectResult = {
  attempt: AutoAnswerAttemptRecord;
  questionId: string;
  exerciseUrl: string;
};

type AutoAnswerServiceOptions = {
  browserController: BrowserController;
  runtimeRepository: RuntimeRepository;
  assistRepository: AssistRepository;
  autoAnswerRepository: AutoAnswerRepository;
  questionSolveService: QuestionSolveService;
  automationStore: AutomationStore;
  solveConcurrency?: number;
};

const HOME_PAGE_URL = 'https://www.yuketang.cn/v2/web/index';

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

const parseLessonIdFromUrl = (url: string | null) => url?.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/)?.[1] ?? null;

const runLimited = async <T, R>(items: T[], concurrency: number, worker: (item: T, index: number) => Promise<R>) => {
  if (items.length === 0) {
    return [] as R[];
  }

  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const limit = Math.max(1, concurrency);
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex++;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  });
  await Promise.all(runners);
  return results;
};

export class AutoAnswerService {
  private readonly browserController: BrowserController;
  private readonly runtimeRepository: RuntimeRepository;
  private readonly assistRepository: AssistRepository;
  private readonly autoAnswerRepository: AutoAnswerRepository;
  private readonly questionSolveService: QuestionSolveService;
  private readonly automationStore: AutomationStore;
  private readonly solveConcurrency: number;

  private status: AutoAnswerStatus = createInitialStatus();
  private activePromise: Promise<void> | null = null;
  private stopRequested = false;

  constructor(options: AutoAnswerServiceOptions) {
    this.browserController = options.browserController;
    this.runtimeRepository = options.runtimeRepository;
    this.assistRepository = options.assistRepository;
    this.autoAnswerRepository = options.autoAnswerRepository;
    this.questionSolveService = options.questionSolveService;
    this.automationStore = options.automationStore;
    this.solveConcurrency = options.solveConcurrency ?? 2;
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

  async start() {
    if (this.activePromise) {
      return this.getStatus();
    }

    const run: AutoAnswerRunRecord = {
      id: `run-${Date.now()}`,
      status: 'running',
      lessonId: null,
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

    this.activePromise = this.executeRun(run).finally(() => {
      this.activePromise = null;
      this.stopRequested = false;
    });

    return this.getStatus();
  }

  async stop() {
    this.stopRequested = true;
    return this.getStatus();
  }

  private async executeRun(run: AutoAnswerRunRecord) {
    try {
      const activeLesson = await this.ensureActiveLesson();
      if (!activeLesson?.id) {
        throw new Error('No active lesson available for autoplay');
      }

      run.lessonId = activeLesson.id;
      this.status.lessonId = activeLesson.id;
      this.autoAnswerRepository.upsertRun(run);

      const exerciseEntries = await this.refreshExerciseEntries(activeLesson);
      const unansweredEntries = exerciseEntries.filter((entry) => entry.status === 'unanswered' && entry.exerciseUrl);
      run.totalCount = unansweredEntries.length;
      this.status.totalCount = unansweredEntries.length;
      this.autoAnswerRepository.upsertRun(run);

      const collected: CollectResult[] = [];
      for (const entry of unansweredEntries) {
        if (this.stopRequested) {
          await this.cancelRun(run);
          return;
        }

        this.status.currentExerciseEntryId = entry.entryId;
        const collectedEntry = await this.collectEntry(run, entry.entryId, entry.exerciseUrl!);
        if (collectedEntry) {
          collected.push(collectedEntry);
          run.collectedCount += 1;
          this.status.collectedCount = run.collectedCount;
          this.autoAnswerRepository.upsertRun(run);
        } else {
          run.failedCount += 1;
          this.status.failedCount = run.failedCount;
          this.autoAnswerRepository.upsertRun(run);
        }
      }

      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      this.status.stage = 'solving';
      const solvedByAttemptId = new Map<string, SolvedAnswer | null>();
      await runLimited(collected, this.solveConcurrency, async (item) => {
        const solved = await this.solveEntry(item.attempt.id, item.questionId);
        solvedByAttemptId.set(item.attempt.id, solved);
      });

      if (this.stopRequested) {
        await this.cancelRun(run);
        return;
      }

      this.status.stage = 'submitting';
      for (const item of collected) {
        if (this.stopRequested) {
          await this.cancelRun(run);
          return;
        }

        this.status.currentExerciseEntryId = item.attempt.exerciseEntryId;
        const solved = solvedByAttemptId.get(item.attempt.id) ?? null;
        if (!solved) {
          run.failedCount += 1;
          this.status.failedCount = run.failedCount;
          this.autoAnswerRepository.upsertRun(run);
          continue;
        }

        const submitted = await this.submitEntry(item.attempt.id, item.exerciseUrl, solved);
        if (submitted) {
          run.successCount += 1;
          this.status.successCount = run.successCount;
        } else {
          run.failedCount += 1;
          this.status.failedCount = run.failedCount;
        }
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

  private async ensureActiveLesson() {
    const snapshot = await this.browserController.inspectPage();
    const runtimeStatus = probeRuntimeStatus(snapshot);
    const currentLessonId = parseLessonIdFromUrl(runtimeStatus.currentUrl);
    if (runtimeStatus.lessonState === 'in_class' && currentLessonId) {
      return {
        id: currentLessonId,
        courseTitle: runtimeStatus.courseTitle ?? '未命名课程',
        lessonTitle: runtimeStatus.pageTitle ?? null,
        lessonState: 'in_class',
        href: runtimeStatus.currentUrl
      } satisfies LessonCandidate;
    }

    if (runtimeStatus.currentUrl !== HOME_PAGE_URL) {
      await this.browserController.navigateHome();
    }

    const lessons = await this.browserController.discoverLessons();
    const lesson = lessons.find((item) => item.lessonState === 'in_class' && item.href);
    if (lesson?.href) {
      await this.browserController.navigate(lesson.href);
      return lesson;
    }

    return null;
  }

  private async refreshExerciseEntries(activeLesson: LessonCandidate) {
    const entries = await this.browserController.listExerciseEntries();
    this.runtimeRepository.replaceExerciseEntries(activeLesson.id, entries);
    return this.runtimeRepository
      .listExerciseEntries()
      .filter((entry) => entry.lessonId === activeLesson.id);
  }

  private async collectEntry(run: AutoAnswerRunRecord, entryId: string, exerciseUrl: string): Promise<CollectResult | null> {
    return this.automationStore.executeTask<CollectResult | null>('auto_answer_collect', `Collect runtime question for ${entryId}`, async () => {
      try {
        this.runtimeRepository.updateExerciseProcessingState(run.lessonId, entryId, {
          analysisStatus: 'processing',
          lastError: null
        });
        const runtimeState = await this.browserController.ensureExercisePageReady(exerciseUrl);
        const snapshot = await this.browserController.inspectPage();
        const runtimeStatus = probeRuntimeStatus(snapshot);
        const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle, snapshot.text ?? null, snapshot.currentUrl);
        this.runtimeRepository.saveSnapshot(runtimeStatus, questions);
        const currentQuestion = this.runtimeRepository.getCurrentQuestion();
        if (!currentQuestion) {
          throw new Error(`No current question detected for ${entryId}`);
        }

        const screenshot = await this.browserController.captureScreenshot();
        const ocr = extractOcrResult(snapshot, screenshot);
        this.assistRepository.saveOcrResult(currentQuestion.id, ocr);
        if (ocr.savedImagePath) {
          this.assistRepository.saveQuestionCapture({
            questionRowId: currentQuestion.id,
            sourceType: 'runtime_question',
            filePath: ocr.savedImagePath,
            mimeType: screenshot?.mimeType ?? 'image/png',
            width: null,
            height: null,
            sha256: null
          });
        }

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
          exerciseUrl
        } satisfies CollectResult;
      } catch (error) {
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
      attempt.lastError = error instanceof Error ? error.message : 'Unknown solve error';
      this.autoAnswerRepository.upsertAttempt(attempt);
      return null;
    }
  }

  private async submitEntry(attemptId: string, exerciseUrl: string, solved: SolvedAnswer): Promise<boolean> {
    const attempt = this.autoAnswerRepository.getAttempt(attemptId);
    if (!attempt) {
      return false;
    }

    const payloadForAttempt = async (): Promise<LessonProblemSubmitPayload | 'already_completed'> => {
      const runtimeState = await this.browserController.ensureExercisePageReady(exerciseUrl);
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
        this.autoAnswerRepository.upsertAttempt(attempt);
        this.runtimeRepository.updateExerciseProcessingState(this.status.lessonId, attempt.exerciseEntryId, {
          analysisStatus: 'done',
          lastProcessedAt: attempt.submittedAt,
          lastError: null
        });
        return true;
      }

      const result = await this.browserController.submitLessonProblem(payload);
      attempt.submitAttempt += 1;
      attempt.submitResponseJson = JSON.stringify(result.responseJson);
      if (result.ok) {
        attempt.submitStatus = 'submitted';
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
      if (await trySubmit()) {
        return true;
      }

      const retrySucceeded = await trySubmit();
      if (!retrySucceeded) {
        attempt.submitStatus = 'failed';
        this.autoAnswerRepository.upsertAttempt(attempt);
        this.runtimeRepository.updateExerciseProcessingState(this.status.lessonId, attempt.exerciseEntryId, {
          analysisStatus: 'failed',
          lastProcessedAt: new Date().toISOString(),
          lastError: attempt.lastError
        });
      }
      return retrySucceeded;
    }).catch(() => false);
  }
}
