export type LessonState = 'idle' | 'in_class' | 'waiting' | 'ended';

export type MonitorPhase = 'idle' | 'home_polling' | 'class_monitoring' | 'returning_home' | 'error_backoff';

export type RuntimeStatus = {
  connected: boolean;
  loggedIn: boolean;
  courseTitle: string | null;
  lessonState: LessonState;
  checkinAvailable: boolean;
  questionDetected: boolean;
  currentUrl: string | null;
  pageTitle: string | null;
  lastScannedAt: string | null;
};

export type QuestionOption = {
  key: string;
  value: string;
};

export type QuestionRecord = {
  questionId: string;
  courseTitle: string | null;
  type: string;
  body: string;
  options: QuestionOption[];
  slideIndex: number | null;
  detectedAt: string;
  source: 'dom' | 'image' | 'mixed';
};

export type RuntimeMonitorStatus = {
  enabled: boolean;
  phase: MonitorPhase;
  currentCourse: string | null;
  currentLessonId: string | null;
  lastCheckedAt: string | null;
  lastTransitionAt: string | null;
  lastError: string | null;
};
