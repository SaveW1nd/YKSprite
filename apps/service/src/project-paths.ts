import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';

const isProjectRoot = (targetPath: string) => {
  const packageJsonPath = path.join(targetPath, 'package.json');
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as { name?: string };
    return parsed.name === 'yksprite';
  } catch {
    return false;
  }
};

export const resolveProjectRoot = (moduleUrl: string) => {
  let currentPath = path.dirname(fileURLToPath(moduleUrl));

  while (true) {
    if (isProjectRoot(currentPath)) {
      return currentPath;
    }

    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      throw new Error(`Unable to resolve project root from ${moduleUrl}`);
    }

    currentPath = parentPath;
  }
};

export const resolveProjectPath = (moduleUrl: string, ...segments: string[]) =>
  path.resolve(resolveProjectRoot(moduleUrl), ...segments);
