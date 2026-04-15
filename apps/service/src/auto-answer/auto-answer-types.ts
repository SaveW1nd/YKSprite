export type AutoAnswerRunStatus = 'running' | 'succeeded' | 'failed' | 'cancelled';

export type AutoAnswerRunRecord = {
  id: string;
  status: AutoAnswerRunStatus;
  lessonId: string | null;
  startedAt: string;
  finishedAt: string | null;
  totalCount: number;
  collectedCount: number;
  solvedCount: number;
  successCount: number;
  failedCount: number;
  lastError: string | null;
};

export type AutoAnswerAttemptStatus = 'pending' | 'ready' | 'running' | 'done' | 'failed' | 'submitted' | 'already_completed';

export type AutoAnswerAttemptRecord = {
  id: string;
  runId: string;
  questionRowId: number | null;
  exerciseEntryId: string;
  problemId: string;
  problemType: number;
  provider: string | null;
  model: string | null;
  answerJson: string | null;
  confidence: string | null;
  reasoningSummary: string | null;
  collectStatus: AutoAnswerAttemptStatus;
  solveStatus: AutoAnswerAttemptStatus;
  submitStatus: AutoAnswerAttemptStatus;
  submitAttempt: number;
  submitResponseJson: string | null;
  submittedAt: string | null;
  lastError: string | null;
};

export type AutoAnswerStage = 'idle' | 'collecting' | 'solving' | 'submitting';

export type AutoAnswerStatus = {
  runId: string | null;
  status: AutoAnswerRunStatus | 'idle';
  stage: AutoAnswerStage;
  lessonId: string | null;
  currentExerciseEntryId: string | null;
  totalCount: number;
  collectedCount: number;
  solvedCount: number;
  successCount: number;
  failedCount: number;
  lastError: string | null;
};

export type SolvedAnswer = {
  provider: string;
  model: string;
  confidence: 'low' | 'medium' | 'high';
  reasoningSummary: string;
  answerJson: string;
  submitPayloadResult: string[] | string | Record<string, unknown>;
  rawResponseJson: string;
};
