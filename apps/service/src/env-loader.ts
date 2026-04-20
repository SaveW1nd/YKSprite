import { existsSync, readFileSync } from 'node:fs';

const BLOCKED_ENV_KEYS = new Set([
  'VISION_DEFAULT_PROVIDER',
  'QWEN_VL_API_KEY',
  'QWEN_VL_BASE_URL',
  'QWEN_VL_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL'
]);

export const loadEnvFile = (envPath: string) => {
  if (!existsSync(envPath)) {
    return;
  }

  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');

    if (!key || process.env[key] !== undefined || BLOCKED_ENV_KEYS.has(key)) {
      continue;
    }

    process.env[key] = value;
  }
};
