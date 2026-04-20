import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { ApiConfigRepository } from '../../apps/service/src/api-config/api-config-repository';
import { ApiConfigService } from '../../apps/service/src/api-config/api-config-service';

describe('ApiConfigService', () => {
  it('stores multiple qwen keys and exposes the active one in the snapshot', () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const service = new ApiConfigService(repository);

    const first = service.addQwenKey({
      name: '主账号 key',
      apiKey: 'qwen-test-key-1'
    });
    const second = service.addQwenKey({
      name: '备用 key',
      apiKey: 'qwen-test-key-2'
    });

    const snapshot = service.enableQwenKey(second.keys[1]!.id);

    expect(first.keys).toHaveLength(1);
    expect(snapshot.model).toBe('qwen3-vl-flash-2026-01-22');
    expect(snapshot.hasActiveKey).toBe(true);
    expect(snapshot.activeKeyName).toBe('备用 key');
    expect(snapshot.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '主账号 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: false
        }),
        expect.objectContaining({
          name: '备用 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: true
        })
      ])
    );
  });

  it('returns the active qwen runtime config and clears it when the active key is deleted', () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const service = new ApiConfigService(repository);

    const snapshot = service.addQwenKey({
      name: '主账号 key',
      apiKey: ' qwen-active-key '
    });

    expect(service.getActiveQwenRuntimeConfig()).toEqual({
      apiKey: 'qwen-active-key',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen3-vl-flash-2026-01-22'
    });

    const afterDelete = service.deleteQwenKey(snapshot.keys[0]!.id);

    expect(afterDelete.hasActiveKey).toBe(false);
    expect(service.getActiveQwenRuntimeConfig()).toEqual({
      apiKey: null,
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen3-vl-flash-2026-01-22'
    });
  });
});
