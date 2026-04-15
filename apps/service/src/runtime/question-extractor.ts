import type { QuestionOption, QuestionRecord } from './runtime-types.js';

const extractOptions = (html: string): QuestionOption[] => {
  const optionMatches = [...html.matchAll(/<li[^>]*data-option-key=["']?([A-Z])["']?[^>]*>(.*?)<\/li>/gis)];
  return optionMatches.map((match) => ({
    key: match[1],
    value: match[2].replace(/<[^>]+>/g, '').trim()
  }));
};

const extractExerciseOptions = (html: string): QuestionOption[] => {
  const optionMatches = [...html.matchAll(/<div[^>]*class=["'][^"']*option[^"']*["'][^>]*>(.*?)<\/div>/gis)];
  return optionMatches
    .map((match) => match[1].replace(/<[^>]+>/g, '').trim())
    .filter(Boolean)
    .map((value) => ({
      key: value,
      value
    }));
};

const inferQuestionType = (html: string) => {
  if (/多选/.test(html)) return 'multiple_choice';
  if (/填空/.test(html)) return 'fill_in';
  if (/简答|主观/.test(html)) return 'subjective';
  return 'single_choice';
};

const extractExerciseOptionsFromText = (text: string): QuestionOption[] =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Z]$/.test(line))
    .map((line) => ({ key: line, value: line }));

export const extractQuestionsFromHtml = (
  html: string,
  courseTitle: string | null,
  visibleText?: string | null,
  currentUrl?: string | null
): QuestionRecord[] => {
  const questionMatches = [...html.matchAll(/<section[^>]*data-question-id=["']?([^"'>\s]+)["']?[^>]*>(.*?)<\/section>/gis)];
  const routeMatch = currentUrl?.match(/\/(exercise|subjective)\/([^/?#]+)/);
  const routeKind = routeMatch?.[1] ?? null;
  const routeId = routeMatch?.[2] ?? 'current';

  if (questionMatches.length === 0 && (routeKind === 'exercise' || /page-exercise/.test(html))) {
    const bodyMatch = html.match(/<div[^>]*class=["'][^"']*problem-title[^"']*["'][^>]*>(.*?)<\/div>/is);
    const body = bodyMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    const options = extractExerciseOptions(html);
    const fallbackOptions = options.length > 0 ? options : extractExerciseOptionsFromText(visibleText ?? '');

    return [
      {
        questionId: `exercise-${routeId}`,
        courseTitle,
        type: inferQuestionType(html),
        body,
        options: fallbackOptions,
        slideIndex: 0,
        detectedAt: new Date().toISOString(),
        source: 'dom'
      }
    ];
  }

  if (questionMatches.length === 0 && (routeKind === 'subjective' || /page-subjective/.test(html))) {
    return [
      {
        questionId: `subjective-${routeId}`,
        courseTitle,
        type: 'subjective',
        body: '',
        options: [],
        slideIndex: 0,
        detectedAt: new Date().toISOString(),
        source: 'mixed'
      }
    ];
  }

  return questionMatches.map((match, index) => {
    const sectionHtml = match[2];
    const bodyMatch = sectionHtml.match(/<div[^>]*class=["'][^"']*question-body[^"']*["'][^>]*>(.*?)<\/div>/is);
    const body = bodyMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '';
    const options = extractOptions(sectionHtml);

    return {
      questionId: match[1],
      courseTitle,
      type: inferQuestionType(sectionHtml),
      body,
      options,
      slideIndex: index,
      detectedAt: new Date().toISOString(),
      source: options.length > 0 ? 'dom' : 'mixed'
    };
  });
};
