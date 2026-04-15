import type { Problem } from './problem.js';

export function formatProblemPrompt(problem: Problem): string {
  const optionLines = (problem.options ?? []).map((option) => `${option.key}. ${option.value}`);

  return [`Question: ${problem.body}`, optionLines.length ? 'Options:' : '', ...optionLines]
    .filter(Boolean)
    .join('\n');
}

export type VisionPromptType = 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';

export function formatVisionPrompt(template: string, problem: Problem): string {
  return template.replaceAll('{{question_type}}', problem.type);
}
