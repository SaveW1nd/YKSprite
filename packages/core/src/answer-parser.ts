export function parseAnswerLetters(input: string): string[] {
  const matches = input.match(/[A-Z]/g) ?? [];
  return [...new Set(matches)];
}
