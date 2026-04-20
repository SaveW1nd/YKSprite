import { MISSING_AI_API_KEY_MESSAGE } from '../assist/ai-error-message.js';
import { ApiConfigRepository } from './api-config-repository.js';
import type { ApiConfigSnapshot, QwenApiKeyRecord, QwenApiKeySnapshot, QwenRuntimeConfig } from './api-config-types.js';

const FIXED_QWEN_MODEL = 'qwen3-vl-flash-2026-01-22';
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

const maskApiKey = (apiKey: string) => `${apiKey.trim().slice(0, 8)}••••`;

const toSnapshot = (record: QwenApiKeyRecord): QwenApiKeySnapshot => ({
  id: record.id,
  name: record.name,
  apiKeyMasked: maskApiKey(record.apiKey),
  isActive: record.isActive,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt
});

export class ApiConfigService {
  constructor(private readonly repository: ApiConfigRepository) {}

  getSnapshot(): ApiConfigSnapshot {
    const keys = this.repository.listQwenKeys();
    const activeKey = keys.find((key) => key.isActive) ?? null;

    return {
      model: FIXED_QWEN_MODEL,
      hasActiveKey: Boolean(activeKey),
      activeKeyId: activeKey?.id ?? null,
      activeKeyName: activeKey?.name ?? null,
      keys: keys.map(toSnapshot)
    };
  }

  addQwenKey(input: { name: string; apiKey: string }) {
    this.repository.createQwenKey({
      name: input.name.trim(),
      apiKey: input.apiKey.trim()
    });

    return this.getSnapshot();
  }

  enableQwenKey(id: number) {
    const target = this.repository.getQwenKey(id);
    if (!target) {
      throw new Error('Qwen API key not found');
    }

    this.repository.enableQwenKey(id);
    return this.getSnapshot();
  }

  deleteQwenKey(id: number) {
    const target = this.repository.getQwenKey(id);
    if (!target) {
      throw new Error('Qwen API key not found');
    }

    this.repository.deleteQwenKey(id);
    return this.getSnapshot();
  }

  getActiveQwenRuntimeConfig(): QwenRuntimeConfig {
    const activeKey = this.repository.getActiveQwenKey();

    return {
      apiKey: activeKey?.apiKey.trim() || null,
      baseUrl: DEFAULT_QWEN_BASE_URL,
      model: FIXED_QWEN_MODEL
    };
  }

  getMissingKeyMessage() {
    return MISSING_AI_API_KEY_MESSAGE;
  }
}
