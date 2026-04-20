export type QwenApiKeyRecord = {
  id: number;
  name: string;
  apiKey: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type QwenApiKeySnapshot = {
  id: number;
  name: string;
  apiKeyMasked: string;
  isActive: boolean;
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

export type QwenRuntimeConfig = {
  apiKey: string | null;
  baseUrl: string;
  model: string;
};
