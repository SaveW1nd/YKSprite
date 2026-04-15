import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from '../../apps/service/src/env-loader';

const cleanupPaths: string[] = [];

afterEach(() => {
  delete process.env.QWEN_VL_API_KEY;
  delete process.env.OPENAI_API_KEY;

  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('env loader', () => {
  it('loads missing keys from a local .env file', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-env-'));
    cleanupPaths.push(root);
    const envPath = path.join(root, '.env');

    writeFileSync(
      envPath,
      ['QWEN_VL_API_KEY=qwen-test-key', 'OPENAI_API_KEY=openai-test-key'].join('\n'),
      'utf8'
    );

    loadEnvFile(envPath);

    expect(process.env.QWEN_VL_API_KEY).toBe('qwen-test-key');
    expect(process.env.OPENAI_API_KEY).toBe('openai-test-key');
  });

  it('does not overwrite already exported environment variables', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-env-'));
    cleanupPaths.push(root);
    const envPath = path.join(root, '.env');

    writeFileSync(envPath, 'QWEN_VL_API_KEY=qwen-from-file\n', 'utf8');
    process.env.QWEN_VL_API_KEY = 'qwen-from-process';

    loadEnvFile(envPath);

    expect(process.env.QWEN_VL_API_KEY).toBe('qwen-from-process');
  });
});
