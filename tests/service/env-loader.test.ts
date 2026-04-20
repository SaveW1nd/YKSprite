import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadEnvFile } from '../../apps/service/src/env-loader';

const cleanupPaths: string[] = [];

afterEach(() => {
  delete process.env.APP_PORT;
  delete process.env.VISION_DEFAULT_PROVIDER;
  delete process.env.QWEN_VL_API_KEY;
  delete process.env.QWEN_VL_MODEL;
  delete process.env.OPENAI_API_KEY;

  while (cleanupPaths.length > 0) {
    rmSync(cleanupPaths.pop()!, { recursive: true, force: true });
  }
});

describe('env loader', () => {
  it('ignores legacy ai provider config keys that should now come from the database', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-env-'));
    cleanupPaths.push(root);
    const envPath = path.join(root, '.env');

    writeFileSync(
      envPath,
      [
        'VISION_DEFAULT_PROVIDER=openai',
        'QWEN_VL_API_KEY=qwen-test-key',
        'QWEN_VL_MODEL=qwen-vl-max',
        'OPENAI_API_KEY=openai-test-key'
      ].join('\n'),
      'utf8'
    );

    loadEnvFile(envPath);

    expect(process.env.VISION_DEFAULT_PROVIDER).toBeUndefined();
    expect(process.env.QWEN_VL_API_KEY).toBeUndefined();
    expect(process.env.QWEN_VL_MODEL).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });

  it('still loads unrelated env keys without overwriting exported values', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'yksprite-env-'));
    cleanupPaths.push(root);
    const envPath = path.join(root, '.env');

    writeFileSync(envPath, 'APP_PORT=3000\n', 'utf8');
    process.env.APP_PORT = '4000';

    loadEnvFile(envPath);

    expect(process.env.APP_PORT).toBe('4000');
  });
});
