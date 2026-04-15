export type HealthResponse = {
  status: string;
  name: string;
};

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

export type RuntimeStatus = {
  connected: boolean;
  loggedIn: boolean;
  courseTitle: string | null;
  lessonState: 'idle' | 'in_class' | 'waiting' | 'ended';
  checkinAvailable: boolean;
  questionDetected: boolean;
  currentUrl: string | null;
  pageTitle: string | null;
  lastScannedAt: string | null;
};

export type RuntimeMonitorStatus = {
  enabled: boolean;
  phase: 'idle' | 'home_polling' | 'class_monitoring' | 'returning_home' | 'error_backoff';
  currentCourse: string | null;
  currentLessonId: string | null;
  lastCheckedAt: string | null;
  lastTransitionAt: string | null;
  lastError: string | null;
};

export type QuestionOption = {
  key: string;
  value: string;
};

export type CurrentQuestion = {
  id: number;
  questionId: string;
  courseTitle: string | null;
  type: string;
  body: string;
  options: QuestionOption[];
  slideIndex: number | null;
  source: 'dom' | 'image' | 'mixed';
  detectedAt: string;
};

export type RuntimeExerciseEntry = {
  entryId: string;
  lessonId: string | null;
  status: 'unanswered' | 'answered' | 'expired';
  analysisStatus?: 'pending' | 'processing' | 'done' | 'failed';
  isActive: boolean;
  pageHint: string | null;
  remainingHint: string | null;
  thumbnailUrl: string | null;
  exerciseUrl: string | null;
  updatedAt: string | null;
  lastProcessedAt?: string | null;
  lastError?: string | null;
};

export type QuestionCapture = {
  id: number;
  questionId: string;
  filePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sha256: string | null;
  createdAt: string;
};

export type VisionAnalysis = {
  id: number;
  questionId: string;
  captureId: number;
  provider: 'openai' | 'qwen_vl';
  model: string;
  promptVersion: string;
  questionType: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  questionText: string;
  options: QuestionOption[];
  suggestedAnswer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoningSummary: string;
  rawResponseJson: string;
  createdAt: string;
};

export type TaskRecord = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  attempt: number;
  payloadSummary: string;
  sourceRef: string | null;
};

export type EventRecord = {
  id: string;
  level: 'info' | 'alert' | 'live';
  title: string;
  description: string;
  time: string;
  taskId?: string | null;
  eventType?: string | null;
};

export async function fetchHealth(): Promise<HealthResponse> {
  const response = await fetch('/health');
  if (!response.ok) {
    throw new Error(`Health request failed with status ${response.status}`);
  }
  return response.json() as Promise<HealthResponse>;
}

const readBrowserResponse = async (response: Response): Promise<BrowserStatus> => {
  if (!response.ok) {
    throw new Error(`Browser request failed with status ${response.status}`);
  }

  return response.json() as Promise<BrowserStatus>;
};

const readSessionResponse = async (response: Response): Promise<SessionState> => {
  if (!response.ok) {
    throw new Error(`Session request failed with status ${response.status}`);
  }

  return response.json() as Promise<SessionState>;
};

const readRuntimeResponse = async (response: Response): Promise<RuntimeStatus> => {
  if (!response.ok) {
    throw new Error(`Runtime request failed with status ${response.status}`);
  }

  return response.json() as Promise<RuntimeStatus>;
};

const readQuestionResponse = async (response: Response): Promise<CurrentQuestion | null> => {
  if (!response.ok) {
    throw new Error(`Question request failed with status ${response.status}`);
  }

  return response.json() as Promise<CurrentQuestion | null>;
};

const readMonitorResponse = async (response: Response): Promise<RuntimeMonitorStatus> => {
  if (!response.ok) {
    throw new Error(`Monitor request failed with status ${response.status}`);
  }

  return response.json() as Promise<RuntimeMonitorStatus>;
};

const readCaptureResponse = async (response: Response): Promise<QuestionCapture | null> => {
  if (!response.ok) {
    throw new Error(`Capture request failed with status ${response.status}`);
  }

  return response.json() as Promise<QuestionCapture | null>;
};

const readAnalysisResponse = async (response: Response): Promise<VisionAnalysis | null> => {
  if (!response.ok) {
    throw new Error(`Analysis request failed with status ${response.status}`);
  }

  return response.json() as Promise<VisionAnalysis | null>;
};

const readExercisesResponse = async (response: Response): Promise<RuntimeExerciseEntry[]> => {
  if (!response.ok) {
    throw new Error(`Exercises request failed with status ${response.status}`);
  }

  return response.json() as Promise<RuntimeExerciseEntry[]>;
};

const readTasksResponse = async (response: Response): Promise<TaskRecord[]> => {
  if (!response.ok) {
    throw new Error(`Tasks request failed with status ${response.status}`);
  }

  return response.json() as Promise<TaskRecord[]>;
};

const readEventsResponse = async (response: Response): Promise<EventRecord[]> => {
  if (!response.ok) {
    throw new Error(`Events request failed with status ${response.status}`);
  }

  return response.json() as Promise<EventRecord[]>;
};

export async function fetchBrowserStatus(): Promise<BrowserStatus> {
  const response = await fetch('/browser');
  return readBrowserResponse(response);
}

export async function startBrowser(): Promise<BrowserStatus> {
  const response = await fetch('/browser/start', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function stopBrowser(): Promise<BrowserStatus> {
  const response = await fetch('/browser/stop', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function startLoginSession(): Promise<BrowserStatus> {
  const response = await fetch('/browser/login/start', {
    method: 'POST'
  });
  return readBrowserResponse(response);
}

export async function fetchSessionState(): Promise<SessionState> {
  const response = await fetch('/browser/session');
  return readSessionResponse(response);
}

export async function saveSession(): Promise<SessionState> {
  const response = await fetch('/browser/session/save', {
    method: 'POST'
  });
  return readSessionResponse(response);
}

export async function fetchRuntimeStatus(): Promise<RuntimeStatus> {
  const response = await fetch('/runtime/status');
  return readRuntimeResponse(response);
}

export async function fetchRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor');
  return readMonitorResponse(response);
}

export async function startRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor/start', {
    method: 'POST'
  });
  return readMonitorResponse(response);
}

export async function stopRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor/stop', {
    method: 'POST'
  });
  return readMonitorResponse(response);
}

export async function fetchCurrentQuestion(): Promise<CurrentQuestion | null> {
  const response = await fetch('/runtime/questions/current');
  return readQuestionResponse(response);
}

export async function fetchRuntimeExercises(): Promise<RuntimeExerciseEntry[]> {
  const response = await fetch('/runtime/exercises');
  return readExercisesResponse(response);
}

export async function fetchQuestionCapture(questionId: string): Promise<QuestionCapture | null> {
  const response = await fetch(`/assist/capture/${questionId}`);
  return readCaptureResponse(response);
}

export async function fetchQuestionAnalysis(questionId: string): Promise<VisionAnalysis | null> {
  const response = await fetch(`/assist/analysis/${questionId}`);
  return readAnalysisResponse(response);
}

export async function fetchTasks(): Promise<TaskRecord[]> {
  const response = await fetch('/tasks');
  return readTasksResponse(response);
}

export async function fetchEvents(): Promise<EventRecord[]> {
  const response = await fetch('/events');
  return readEventsResponse(response);
}
