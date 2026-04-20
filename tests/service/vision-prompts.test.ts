import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { VisionAnalysisService } from '../../apps/service/src/assist/vision-analysis-service';

const promptDir = path.resolve(process.cwd(), 'apps/service/prompts/vision');

describe('vision prompts', () => {
  it('frame every question as the current student answering an in-class problem', () => {
    for (const filename of ['single_choice.txt', 'multiple_choice.txt', 'fill_in.txt', 'subjective.txt']) {
      const template = readFileSync(path.join(promptDir, filename), 'utf8');
      expect(template).toContain('学生');
      expect(template).toContain('上课');
    }
  });

  it('resolves the built-in prompt directory correctly even when the service starts from apps/service', () => {
    const originalCwd = process.cwd();
    process.chdir(path.resolve(originalCwd, 'apps/service'));

    try {
      const service = new VisionAnalysisService({} as never);
      expect((service as unknown as { promptDir: string }).promptDir).toBe(
        path.resolve(originalCwd, 'apps/service/prompts/vision')
      );
    } finally {
      process.chdir(originalCwd);
    }
  });
});
