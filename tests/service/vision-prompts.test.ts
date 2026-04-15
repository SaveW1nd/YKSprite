import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const promptDir = path.resolve(process.cwd(), 'apps/service/prompts/vision');

describe('vision prompts', () => {
  it('frame every question as the current student answering an in-class problem', () => {
    for (const filename of ['single_choice.txt', 'multiple_choice.txt', 'fill_in.txt', 'subjective.txt']) {
      const template = readFileSync(path.join(promptDir, filename), 'utf8');
      expect(template).toContain('学生');
      expect(template).toContain('上课');
    }
  });
});
