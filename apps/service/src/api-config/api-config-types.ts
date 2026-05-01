export type QwenApiKeyRecord = {
  id: number;
  name: string;
  apiKey: string;
  isActive: boolean;
  lastCheckStatus: ApiCheckStatus;
  lastCheckReason: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApiCheckStatus = 'unchecked' | 'success' | 'error';

export type QwenApiKeySnapshot = {
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

export type ApiConfigCheckResult = {
  status: 'success' | 'error';
  reason: string | null;
  checkedAt: string;
  activated: boolean;
};

export type ApiConfigMutationResult = {
  snapshot: ApiConfigSnapshot;
  check: ApiConfigCheckResult;
};

export type QwenRuntimeConfig = {
  apiKey: string | null;
  baseUrl: string;
  model: string;
};
