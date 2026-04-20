export type ApiProvider = 'qwen_vl' | 'openai';

export type ApiProviderConfigRecord = {
  provider: ApiProvider;
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
  updatedAt: string;
};

export type ApiProviderConfigInput = {
  enabled: boolean;
  apiKey: string | null;
  baseUrl: string | null;
  model: string | null;
};

export type ApiProviderConfigSnapshot = {
  provider: ApiProvider;
  label: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  baseUrl: string | null;
  model: string | null;
  source: 'database' | 'unset';
  lastError: string | null;
};

export type ApiConfigSnapshot = {
  defaultVisionProvider: ApiProvider;
  providers: Record<ApiProvider, ApiProviderConfigSnapshot>;
};
