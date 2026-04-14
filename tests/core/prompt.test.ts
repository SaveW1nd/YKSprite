import { describe, expect, it } from 'vitest';
import { formatProblemPrompt, parseAnswerLetters } from '@yksprite/core';

describe('core prompt utilities', () => {
  it('formats a single-choice prompt with options', () => {
    const prompt = formatProblemPrompt({
      id: 'p1',
      type: 'single_choice',
      body: '2 + 2 = ?',
      options: [
        { key: 'A', value: '3' },
        { key: 'B', value: '4' }
      ]
    });

    expect(prompt).toContain('2 + 2 = ?');
    expect(prompt).toContain('A. 3');
    expect(prompt).toContain('B. 4');
  });

  it('parses multiple answer letters from a response', () => {
    expect(parseAnswerLetters('答案: A、C')).toEqual(['A', 'C']);
  });
});
