export type BrowserStatus = {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  engine: 'chromium';
  headless: true;
  mode: 'headless' | 'visible-login' | null;
  startedAt: string | null;
  pageUrl: string | null;
  lastError: string | null;
};

export type SessionState = {
  hasSession: boolean;
  savedAt: string | null;
  origin: string | null;
  cookieCount: number;
  currentUrl: string | null;
  pageTitle: string | null;
  mode: 'headless' | 'visible-login' | null;
};

export type PageSnapshot = {
  currentUrl: string | null;
  pageTitle: string | null;
  html: string | null;
  text?: string | null;
};

export type LessonCandidate = {
  id: string;
  courseTitle: string;
  lessonTitle: string | null;
  lessonState: 'in_class' | 'waiting' | 'ended' | 'unknown';
  href: string | null;
};

export type ExerciseEntry = {
  entryId: string;
  lessonId: string | null;
  status: 'unanswered' | 'answered' | 'expired';
  isActive: boolean;
  pageHint: string | null;
  remainingHint: string | null;
  thumbnailUrl: string | null;
  exerciseUrl: string | null;
};

export type ScreenshotPayload = {
  mimeType: 'image/png';
  data: string;
} | null;

export type ExerciseRuntimeState = {
  lessonId: string | null;
  exerciseIndex: string | null;
  problemId: string;
  problemType: number;
  pageIndex: number | null;
  questionText: string;
  options: Array<{ key: string; value: string }>;
  imageUrl: string | null;
  imageThumbnailUrl: string | null;
  isComplete: boolean;
  routePath: string | null;
};

export type LessonProblemSubmitPayload = {
  problemId: string;
  problemType: number;
  dt: number;
  result: string[] | string | Record<string, unknown>;
};

export type LessonProblemSubmitResult = {
  ok: boolean;
  code: number;
  message: string;
  responseJson: unknown;
};

export interface BrowserController {
  getStatus(): BrowserStatus;
  start(): Promise<BrowserStatus>;
  startLogin(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
  getSessionState(): Promise<SessionState>;
  saveSession(): Promise<SessionState>;
  navigateHome(): Promise<BrowserStatus>;
  navigate(url: string): Promise<BrowserStatus>;
  discoverLessons(): Promise<LessonCandidate[]>;
  listExerciseEntries(): Promise<ExerciseEntry[]>;
  openCurrentExercise(): Promise<string | null>;
  inspectPage(): Promise<PageSnapshot>;
  captureScreenshot(): Promise<ScreenshotPayload>;
  ensureExercisePageReady(url: string): Promise<ExerciseRuntimeState>;
  readExerciseRuntimeState(): Promise<ExerciseRuntimeState | null>;
  submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult>;
}
