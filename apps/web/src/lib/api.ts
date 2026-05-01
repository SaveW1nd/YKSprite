export type ManagedAccount = {
  id: number;
  userId: string | null;
  name: string | null;
  monitoringEnabled?: boolean;
  activeLessonEnterDelayMs?: number;
  accountKey: string;
  platform: string;
  status: 'healthy' | 'error';
  lastCheckedAt: string | null;
  lastErrorReason: string | null;
  note: string | null;
  createdAt: string;
  monitorStatus?: 'idle' | 'starting' | 'monitoring' | 'error';
  monitorUpdatedAt?: string | null;
  monitorLastError?: string | null;
  currentClassroom?: {
    lessonId: string;
    classroomId: string | null;
    courseTitle: string;
    classroomTitle: string | null;
    status: 'in_class' | 'idle';
    detectedAt: string;
  } | null;
  recentLogs?: Array<{
    id: number;
    at: string;
    type: string;
    message: string;
  }>;
};

export type AccountLoginState = {
  loginSessionId: string | null;
  accountId: number | null;
  status: 'idle' | 'pending' | 'completed' | 'error';
  qrCodeDataUrl: string | null;
  lastError: string | null;
  notice?: string | null;
  updatedAt: string | null;
};

type StartAccountLoginInput = {
  platform: string;
};

export type AutomationTask = {
  id: string;
  type: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  attempt: number;
  payloadSummary: string;
};

export type AutomationEvent = {
  id: string;
  level: 'info' | 'alert' | 'live';
  title: string;
  description: string;
  time: string;
};

export type AnswerHistoryItem = {
  id: string;
  runId: string;
  account: {
    id: number | null;
    name: string;
    userId: string | null;
    platform: string | null;
  };
  courseTitle: string | null;
  lessonId: string | null;
  problemId: string;
  problemType: number;
  questionText: string | null;
  answerJson: string | null;
  submitStatus: string;
  submittedAt: string | null;
  lastError: string | null;
  capture: {
    id: number;
    url: string;
    mimeType: string;
    width: number | null;
    height: number | null;
    createdAt: string;
  } | null;
};

type ApiCheckStatus = 'unchecked' | 'success' | 'error';

type QwenApiKeySnapshot = {
  id: number;
  name: string;
  apiKeyMasked: string;
  isActive: boolean;
  lastCheckStatus: ApiCheckStatus;
  lastCheckReason: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiConfigSnapshot = {
  model: string;
  hasActiveKey: boolean;
  activeKeyId: number | null;
  activeKeyName: string | null;
  keys: QwenApiKeySnapshot[];
};

type ApiConfigCheckResult = {
  status: 'success' | 'error';
  reason: string | null;
  checkedAt: string;
  activated: boolean;
};

export type ApiConfigMutationResult = {
  snapshot: ApiConfigSnapshot;
  check: ApiConfigCheckResult;
};

const readApiError = async (response: Response, fallback: string) => {
  const body = await response.json().catch(() => null) as { message?: string } | null;
  return body?.message || `${fallback}: ${response.status}`;
};

export const fetchAccounts = async (): Promise<ManagedAccount[]> => {
  const response = await fetch('/api/accounts');
  if (!response.ok) {
    throw new Error(`Failed to fetch accounts: ${response.status}`);
  }

  return (await response.json()) as ManagedAccount[];
};

export const subscribeAccountEvents = (onChange: () => void): (() => void) => {
  if (typeof EventSource === 'undefined') {
    return () => undefined;
  }

  const source = new EventSource('/api/accounts/stream');
  const handleChange = () => onChange();

  source.addEventListener('accounts_changed', handleChange);

  return () => {
    source.removeEventListener('accounts_changed', handleChange);
    source.close();
  };
};

export const subscribeDashboardEvents = (onChange: () => void): (() => void) => {
  if (typeof EventSource === 'undefined') {
    return () => undefined;
  }

  const source = new EventSource('/api/accounts/stream');
  const eventTypes = ['accounts_changed', 'automation_changed', 'api_config_changed'] as const;
  let refreshTimer: ReturnType<typeof window.setTimeout> | null = null;

  const handleChange = () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
    }
    refreshTimer = window.setTimeout(() => {
      refreshTimer = null;
      onChange();
    }, 120);
  };

  eventTypes.forEach((eventType) => {
    source.addEventListener(eventType, handleChange);
  });

  return () => {
    if (refreshTimer) {
      window.clearTimeout(refreshTimer);
      refreshTimer = null;
    }
    eventTypes.forEach((eventType) => {
      source.removeEventListener(eventType, handleChange);
    });
    source.close();
  };
};

export const startAccountLogin = async (input: StartAccountLoginInput): Promise<AccountLoginState> => {
  const response = await fetch('/api/accounts/login/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(input)
  });

  if (!response.ok) {
    throw new Error(`Failed to start account login: ${response.status}`);
  }

  return (await response.json()) as AccountLoginState;
};

export const fetchAccountLoginState = async (loginSessionId: string): Promise<AccountLoginState> => {
  const response = await fetch(`/api/accounts/login/${loginSessionId}/status`);

  if (!response.ok) {
    throw new Error(`Failed to fetch account login state: ${response.status}`);
  }

  return (await response.json()) as AccountLoginState;
};

export const stopAccountLogin = async (loginSessionId: string): Promise<AccountLoginState> => {
  const response = await fetch(`/api/accounts/login/${loginSessionId}/stop`, {
    method: 'POST'
  });

  if (!response.ok) {
    throw new Error(`Failed to stop account login: ${response.status}`);
  }

  return (await response.json()) as AccountLoginState;
};

export const updateAccountMonitoring = async (accountId: number, enabled: boolean): Promise<ManagedAccount> => {
  const response = await fetch(`/api/accounts/${accountId}/monitoring`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ enabled })
  });

  if (!response.ok) {
    throw new Error(`Failed to update account monitoring: ${response.status}`);
  }

  return (await response.json()) as ManagedAccount;
};

export const updateAccountActiveLessonEnterDelay = async (accountId: number, delayMs: number): Promise<ManagedAccount> => {
  const response = await fetch(`/api/accounts/${accountId}/active-lesson-enter-delay`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ delayMs })
  });

  if (!response.ok) {
    throw new Error(`Failed to update account active lesson enter delay: ${response.status}`);
  }

  return (await response.json()) as ManagedAccount;
};

export const deleteAccount = async (accountId: number): Promise<void> => {
  const response = await fetch(`/api/accounts/${accountId}`, {
    method: 'DELETE'
  });

  if (!response.ok) {
    throw new Error(`Failed to delete account: ${response.status}`);
  }
};

export const fetchAutomationTasks = async (): Promise<AutomationTask[]> => {
  const response = await fetch('/api/tasks');
  if (!response.ok) {
    throw new Error(`Failed to fetch automation tasks: ${response.status}`);
  }

  return (await response.json()) as AutomationTask[];
};

export const fetchAutomationEvents = async (): Promise<AutomationEvent[]> => {
  const response = await fetch('/api/events');
  if (!response.ok) {
    throw new Error(`Failed to fetch automation events: ${response.status}`);
  }

  return (await response.json()) as AutomationEvent[];
};

export const fetchAnswerHistory = async (): Promise<AnswerHistoryItem[]> => {
  const response = await fetch('/api/answers');
  if (!response.ok) {
    throw new Error(`Failed to fetch answer history: ${response.status}`);
  }

  return (await response.json()) as AnswerHistoryItem[];
};

export const fetchApiConfig = async (): Promise<ApiConfigSnapshot> => {
  const response = await fetch('/api/api-config');
  if (!response.ok) {
    throw new Error(`Failed to fetch api config: ${response.status}`);
  }

  return (await response.json()) as ApiConfigSnapshot;
};

export const addQwenApiKey = async (payload: { name: string; apiKey: string }): Promise<ApiConfigMutationResult> => {
  const response = await fetch('/api/api-config/qwen-keys', {
    method: 'POST',
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, 'Failed to add qwen api key'));
  }

  return (await response.json()) as ApiConfigMutationResult;
};

export const enableQwenApiKey = async (id: number): Promise<ApiConfigMutationResult> => {
  const response = await fetch(`/api/api-config/qwen-keys/${id}/enable`, {
    method: 'PATCH',
  });
  if (!response.ok) {
    throw new Error(await readApiError(response, 'Failed to enable qwen api key'));
  }

  return (await response.json()) as ApiConfigMutationResult;
};

export const deleteQwenApiKey = async (id: number): Promise<ApiConfigSnapshot> => {
  const response = await fetch(`/api/api-config/qwen-keys/${id}`, {
    method: 'DELETE'
  });
  if (!response.ok) {
    throw new Error(`Failed to delete qwen api key: ${response.status}`);
  }
  return (await response.json()) as ApiConfigSnapshot;
};
