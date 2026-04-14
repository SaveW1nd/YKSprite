import type { QuestionOption, QuestionRecord } from './runtime-types.js';

const extractOptions = (html: string): QuestionOption[] => {
  const optionMatches = [...html.matchAll(/<li[^>]*data-option-key=["']?([A-Z])["']?[^>]*>(.*?)<\/li>/gis)];
  return optionMatches.map((match) => ({
    key: match[1],
    value: match[2].replace(/<[^>]+>/g, '').trim()
  }));
};

const inferQuestionType = (html: string) => {
  if (/多选/.test(html)) return 'multiple_choice';
  if (/填空/.test(html)) return 'fill_in';
  if (/简答|主观/.test(html)) return 'subjective';
  return 'single_choice';
};

export const extractQuestionsFromHtml = (html: string, courseTitle: string | null): QuestionRecord[] => {
  const questionMatches = [...html.matchAll(/<section[^>]*data-question-id=["']?([^"'>\s]+)["']?[^>]*>(.*?)<\/section>/gis)];

  return questionMatches.map((match, index) => {
    const sectionHtml = match[2];
    const bodyMatch = sectionHtml.match(/<div[^>]*class=["'][^"']*question-body[^"']*["'][^>]*>(.*?)<\/div>/is);
    const body = bodyMatch?.[1]?.replace(/<[^>]+>/g, '').trim() ?? '未识别题干';
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
