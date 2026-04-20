import { MISSING_AI_API_KEY_MESSAGE } from '../assist/ai-error-message.js';
import { ApiConfigRepository } from './api-config-repository.js';
import type {
  ApiConfigSnapshot,
  ApiProvider,
  ApiProviderConfigInput,
  ApiProviderConfigSnapshot
} from './api-config-types.js';

const providerLabel: Record<ApiProvider, string> = {
  qwen_vl: 'Qwen VL',
  openai: 'OpenAI'
};

const maskApiKey = (apiKey: string | null) => {
  const value = apiKey?.trim() ?? '';
  if (!value) {
    return null;
  }

  return `${value.slice(0, 8)}••••`;
};

export class ApiConfigService {
  constructor(private readonly repository: ApiConfigRepository) {}

  getSnapshot(): ApiConfigSnapshot {
    const defaultVisionProvider =
      (this.repository.getSchemaMeta('vision_default_provider')?.value as ApiProvider | undefined) ?? 'qwen_vl';

    return {
      defaultVisionProvider,
      providers: {
        qwen_vl: this.buildProviderSnapshot('qwen_vl'),
        openai: this.buildProviderSnapshot('openai')
      }
    };
  }

  updateProviderConfig(provider: ApiProvider, input: ApiProviderConfigInput) {
    this.repository.saveProviderConfig(provider, input);
    return this.getSnapshot();
  }

  setDefaultVisionProvider(provider: ApiProvider) {
    this.repository.setSchemaMeta('vision_default_provider', provider);
    return this.getSnapshot();
  }

  private buildProviderSnapshot(provider: ApiProvider): ApiProviderConfigSnapshot {
    const config = this.repository.getProviderConfig(provider);
    const hasApiKey = Boolean(config?.apiKey?.trim());

    return {
      provider,
      label: providerLabel[provider],
      enabled: config?.enabled ?? true,
      hasApiKey,
      apiKeyMasked: maskApiKey(config?.apiKey ?? null),
      baseUrl: config?.baseUrl ?? null,
      model: config?.model ?? null,
      source: config ? 'database' : 'unset',
      lastError: config && config.enabled && !hasApiKey ? MISSING_AI_API_KEY_MESSAGE : null
    };
  }
}
