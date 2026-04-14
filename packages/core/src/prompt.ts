import type { Problem } from './problem';

export function formatProblemPrompt(problem: Problem): string {
  const optionLines = (problem.options ?? []).map((option) => `${option.key}. ${option.value}`);

  return [`Question: ${problem.body}`, optionLines.length ? 'Options:' : '', ...optionLines]
    .filter(Boolean)
    .join('\n');
}
