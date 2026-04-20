import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { resolveProjectPath, resolveProjectRoot } from '../../apps/service/src/project-paths';

describe('project paths', () => {
  it('resolves the repository root from a service src module path', () => {
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), 'apps/service/src/index.ts')).href;

    expect(resolveProjectRoot(moduleUrl)).toBe(process.cwd());
    expect(resolveProjectPath(moduleUrl, '.env')).toBe(path.resolve(process.cwd(), '.env'));
  });

  it('resolves the repository root from a built service module path', () => {
    const moduleUrl = pathToFileURL(path.resolve(process.cwd(), 'apps/service/dist/index.js')).href;

    expect(resolveProjectRoot(moduleUrl)).toBe(process.cwd());
    expect(resolveProjectPath(moduleUrl, 'apps/service/prompts/vision')).toBe(
      path.resolve(process.cwd(), 'apps/service/prompts/vision')
    );
  });
});
