import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { ApiConfigRepository } from '../../apps/service/src/api-config/api-config-repository';
import { ApiConfigService } from '../../apps/service/src/api-config/api-config-service';

describe('ApiConfigService', () => {
  it('persists qwen config and projects it into the runtime snapshot', () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const service = new ApiConfigService(repository);

    service.updateProviderConfig('qwen_vl', {
      enabled: true,
      apiKey: 'qwen-test-key',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-vl-max'
    });

    service.setDefaultVisionProvider('qwen_vl');
    const snapshot = service.getSnapshot();

    expect(snapshot.defaultVisionProvider).toBe('qwen_vl');
    expect(snapshot.providers.qwen_vl.hasApiKey).toBe(true);
    expect(snapshot.providers.qwen_vl.apiKeyMasked).toBe('qwen-tes••••');
    expect(snapshot.providers.qwen_vl.source).toBe('database');
  });
});
