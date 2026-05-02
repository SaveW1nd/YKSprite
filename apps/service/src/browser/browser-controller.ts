export type BrowserStatus = {
  status: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  engine: 'http';
  mode: 'http' | 'qr-login' | null;
  startedAt: string | null;
  pageUrl: string | null;
  lastError: string | null;
};

export type BrowserCookie = {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None' | string;
};

export type StoredSession = {
  cookies: BrowserCookie[];
  savedAt: string;
  origin: string;
  currentUrl?: string | null;
  pageTitle?: string | null;
  mode?: string | null;
};

export type SessionState = {
  hasSession: boolean;
  savedAt: string | null;
  origin: string | null;
  cookieCount: number;
  currentUrl: string | null;
  pageTitle: string | null;
  mode: 'http' | 'qr-login' | string | null;
};

export type PageSnapshot = {
  currentUrl: string | null;
  pageTitle: string | null;
  html: string | null;
  text?: string | null;
};

export type LessonCandidate = {
  id: string;
  classroomId?: string | null;
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
  runtimeState?: ExerciseRuntimeState | null;
};

export type LessonPresentationSlide = {
  lessonId: string;
  exerciseIndex: string | null;
  pageIndex: number | null;
  problemId: string | null;
  problemType: number | null;
  imageUrl: string | null;
  imageThumbnailUrl: string | null;
  raw: unknown;
} | null;

export type LessonPresentationSlideList = Array<Exclude<LessonPresentationSlide, null>>;

export type ScreenshotPayload = {
  mimeType: 'image/png';
  data: string;
} | null;

type BrowserNetworkEvent = {
  url: string;
  method: string;
  resourceType: string | null;
  status: number | null;
  ok: boolean | null;
  contentType: string | null;
  bodyPreview: string | null;
  failureText: string | null;
  at: string;
};

export type BrowserDebugState = {
  snapshot: PageSnapshot;
  network: BrowserNetworkEvent[];
  runtime: {
    hasVue: boolean;
    routeName: string | null;
    routePath: string | null;
    storeStateKeys: string[];
    interestingState: Record<string, unknown>;
  };
};

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

export type DetectedQuestionEvent = {
  lessonId: string;
  courseTitle?: string | null;
  problemId: string;
  problemType: number;
  exerciseIndex: string | null;
  routePath: string | null;
  isComplete: boolean;
  imageUrl: string | null;
  detectedAt: string;
  presentationId?: string | null;
  pageIndex?: number | null;
  remainingHint?: string | null;
  source?: 'runtime-state' | 'curr-slide-event' | 'presentation-slide' | 'wsapp-unlockproblem';
};

export type DetectedClassroomEvent = {
  lessonId: string;
  eventType: 'lesson_started' | 'lesson_finished';
  source: 'wsapp' | 'http';
  code: string | null;
  title: string | null;
  detectedAt: string;
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
  supportsPushedQuestionDetection?(): boolean;
  supportsDeferredActiveLessonEntry?(): boolean;
  start(): Promise<BrowserStatus>;
  startLogin?(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
  getSessionState(): Promise<SessionState>;
  saveSession(): Promise<SessionState>;
  navigateHome(): Promise<BrowserStatus>;
  navigate(url: string): Promise<BrowserStatus>;
  discoverLessons(): Promise<LessonCandidate[]>;
  listExerciseEntries(): Promise<ExerciseEntry[]>;
  listLessonPresentationSlides?(lessonId: string, presentationId?: string | null): Promise<LessonPresentationSlideList>;
  readCurrentQuestionPresentationSlide?(
    lessonId: string,
    input?: { problemId?: string | null; presentationId?: string | null }
  ): Promise<LessonPresentationSlide>;
  openCurrentExercise(): Promise<string | null>;
  inspectPage(): Promise<PageSnapshot>;
  getDebugState(): Promise<BrowserDebugState>;
  captureScreenshot(): Promise<ScreenshotPayload>;
  ensureExercisePageReady(url: string): Promise<ExerciseRuntimeState>;
  readExerciseRuntimeState(): Promise<ExerciseRuntimeState | null>;
  startQuestionDetection(onEvent: (event: DetectedQuestionEvent) => void | Promise<void>): Promise<void>;
  startClassroomDetection?(onEvent: (event: DetectedClassroomEvent) => void | Promise<void>): Promise<void>;
  stopQuestionDetection(): Promise<void>;
  stopClassroomDetection?(): Promise<void>;
  submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult>;
}
