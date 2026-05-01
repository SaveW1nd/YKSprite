import { describe, expect, it, vi } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { ApiConfigRepository } from '../../apps/service/src/api-config/api-config-repository';
import { ApiConfigService } from '../../apps/service/src/api-config/api-config-service';

describe('ApiConfigService', () => {
  it('stores multiple qwen keys and exposes the active one in the snapshot', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const validationFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new ApiConfigService(repository, validationFetch);

    const first = await service.addQwenKey({
      name: '主账号 key',
      apiKey: 'qwen-test-key-1'
    });
    const second = await service.addQwenKey({
      name: '备用 key',
      apiKey: 'qwen-test-key-2'
    });

    const result = await service.enableQwenKey(second.snapshot.keys[1]!.id);
    const snapshot = result.snapshot;

    expect(first.snapshot.keys).toHaveLength(1);
    expect(snapshot.model).toBe('qwen3-vl-flash-2026-01-22');
    expect(snapshot.hasActiveKey).toBe(true);
    expect(snapshot.activeKeyName).toBe('备用 key');
    expect(snapshot.keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: '主账号 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: false,
          lastCheckStatus: 'success'
        }),
        expect.objectContaining({
          name: '备用 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: true,
          lastCheckStatus: 'success'
        })
      ])
    );
  });

  it('keeps a failed key disabled and records the failure reason', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const validationFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid API-key provided.' } }), { status: 401 })
    );
    const service = new ApiConfigService(repository, validationFetch);

    const result = await service.addQwenKey({
      name: '错误 key',
      apiKey: 'bad-key'
    });

    expect(result.check).toMatchObject({
      status: 'error',
      activated: false,
      reason: 'Invalid API-key provided.'
    });
    expect(result.snapshot.hasActiveKey).toBe(false);
    expect(result.snapshot.keys).toHaveLength(0);
  });

  it('rejects duplicate qwen key names or api keys before validation', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const validationFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new ApiConfigService(repository, validationFetch);

    await service.addQwenKey({
      name: '主账号 key',
      apiKey: 'qwen-test-key-1'
    });
    const duplicateName = await service.addQwenKey({
      name: '主账号 key',
      apiKey: 'qwen-test-key-2'
    });
    const duplicateApiKey = await service.addQwenKey({
      name: '备用 key',
      apiKey: ' qwen-test-key-1 '
    });

    expect(duplicateName.check).toMatchObject({
      status: 'error',
      reason: 'API 名称已存在',
      activated: false
    });
    expect(duplicateApiKey.check).toMatchObject({
      status: 'error',
      reason: 'API Key 已存在',
      activated: false
    });
    expect(duplicateApiKey.snapshot.keys).toHaveLength(1);
    expect(validationFetch).toHaveBeenCalledTimes(1);
  });

  it('returns the active qwen runtime config and clears it when the active key is deleted', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const validationFetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const service = new ApiConfigService(repository, validationFetch);

    const result = await service.addQwenKey({
      name: '主账号 key',
      apiKey: ' qwen-active-key '
    });
    const snapshot = result.snapshot;

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
