import { MISSING_AI_API_KEY_MESSAGE } from '../assist/ai-error-message.js';
import { ApiConfigRepository } from './api-config-repository.js';
import type {
  ApiConfigCheckResult,
  ApiConfigMutationResult,
  ApiConfigSnapshot,
  QwenApiKeyRecord,
  QwenApiKeySnapshot,
  QwenRuntimeConfig
} from './api-config-types.js';

const FIXED_QWEN_MODEL = 'qwen3-vl-flash-2026-01-22';
const DEFAULT_QWEN_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
type ApiConfigFetch = (input: string, init?: RequestInit) => Promise<Response>;

const maskApiKey = (apiKey: string) => `${apiKey.trim().slice(0, 8)}••••`;

const toSnapshot = (record: QwenApiKeyRecord): QwenApiKeySnapshot => ({
  id: record.id,
  name: record.name,
  apiKeyMasked: maskApiKey(record.apiKey),
  isActive: record.isActive,
  lastCheckStatus: record.lastCheckStatus,
  lastCheckReason: record.lastCheckReason,
  lastCheckedAt: record.lastCheckedAt,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt
});

const extractQwenErrorReason = async (response: Response) => {
  const body = await response.text().catch(() => '');

  if (!body) {
    return `接口返回 HTTP ${response.status}`;
  }

  try {
    const parsed = JSON.parse(body) as { error?: { message?: string }; message?: string };
    return parsed.error?.message || parsed.message || `接口返回 HTTP ${response.status}`;
  } catch {
    return body.slice(0, 240);
  }
};

export class ApiConfigService {
  constructor(
    private readonly repository: ApiConfigRepository,
    private readonly validationFetch: ApiConfigFetch = (input, init) => fetch(input, init)
  ) {}

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

  private async validateQwenKey(apiKey: string, checkedAt: string): Promise<ApiConfigCheckResult> {
    try {
      const response = await this.validationFetch(DEFAULT_QWEN_BASE_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey.trim()}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: FIXED_QWEN_MODEL,
          messages: [
            {
              role: 'user',
              content: 'Return {"ok":true} only.'
            }
          ],
          response_format: {
            type: 'json_object'
          }
        })
      });

      if (!response.ok) {
        return {
          status: 'error',
          reason: await extractQwenErrorReason(response),
          checkedAt,
          activated: false
        };
      }

      return {
        status: 'success',
        reason: null,
        checkedAt,
        activated: false
      };
    } catch (error) {
      return {
        status: 'error',
        reason: error instanceof Error ? `接口连接失败：${error.message}` : '接口连接失败',
        checkedAt,
        activated: false
      };
    }
  }

  async addQwenKey(input: { name: string; apiKey: string }): Promise<ApiConfigMutationResult> {
    const checkedAt = new Date().toISOString();
    const trimmedName = input.name.trim();
    const trimmedApiKey = input.apiKey.trim();
    const existingKeys = this.repository.listQwenKeys();
    const duplicateName = existingKeys.some((key) => key.name === trimmedName);
    const duplicateApiKey = existingKeys.some((key) => key.apiKey.trim() === trimmedApiKey);

    if (duplicateName || duplicateApiKey) {
      const reason = duplicateName && duplicateApiKey
        ? 'API 名称和 API Key 已存在'
        : duplicateName
          ? 'API 名称已存在'
          : 'API Key 已存在';

      return {
        snapshot: this.getSnapshot(),
        check: {
          status: 'error',
          reason,
          checkedAt,
          activated: false
        }
      };
    }

    const check = await this.validateQwenKey(trimmedApiKey, checkedAt);
    const shouldActivate = check.status === 'success' && !this.repository.getActiveQwenKey();

    if (check.status === 'error') {
      return {
        snapshot: this.getSnapshot(),
        check
      };
    }

    this.repository.createQwenKey({
      name: trimmedName,
      apiKey: trimmedApiKey,
      isActive: shouldActivate,
      lastCheckStatus: check.status,
      lastCheckReason: check.reason,
      lastCheckedAt: checkedAt
    });

    return {
      snapshot: this.getSnapshot(),
      check: {
        ...check,
        activated: shouldActivate
      }
    };
  }

  async enableQwenKey(id: number): Promise<ApiConfigMutationResult> {
    const target = this.repository.getQwenKey(id);
    if (!target) {
      throw new Error('Qwen API key not found');
    }

    const checkedAt = new Date().toISOString();
    const check = await this.validateQwenKey(target.apiKey, checkedAt);
    if (check.status === 'error') {
      this.repository.updateQwenKeyCheckResult(id, {
        status: 'error',
        reason: check.reason,
        checkedAt
      });

      return {
        snapshot: this.getSnapshot(),
        check
      };
    }

    this.repository.enableQwenKey(id);
    this.repository.updateQwenKeyCheckResult(id, {
      status: 'success',
      reason: null,
      checkedAt
    });

    return {
      snapshot: this.getSnapshot(),
      check: {
        ...check,
        activated: true
      }
    };
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
