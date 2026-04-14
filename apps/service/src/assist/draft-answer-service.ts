import type { QuestionRecord } from '../runtime/runtime-types.js';
import type { DraftAnswer } from './assist-types.js';

const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, '');

export const buildDraftAnswer = (question: QuestionRecord, ocrText: string): DraftAnswer => {
  const mergedText = normalized(`${question.body} ${ocrText}`);

  const matchedOption = question.options.find((option) => mergedText.includes(normalized(option.value)));
  const generatedAt = new Date().toISOString();

  if (matchedOption) {
    return {
      questionId: question.questionId,
      draft: matchedOption.key,
      reasoningSummary: `OCR 文本中出现了选项内容“${matchedOption.value}”，可作为优先候选。`,
      confidence: 'medium',
      generatedAt
    };
  }

  if (question.type === 'fill_in' || question.type === 'subjective') {
    return {
      questionId: question.questionId,
      draft: ocrText.slice(0, 120) || '待人工确认',
      reasoningSummary: '当前草稿基于 OCR 文本截断生成，请人工确认后再使用。',
      confidence: 'low',
      generatedAt
    };
  }

  return {
    questionId: question.questionId,
    draft: question.options[0]?.key ?? '待人工确认',
    reasoningSummary: '当前没有足够的匹配信号，使用最低置信度候选草稿。',
    confidence: 'low',
    generatedAt
  };
};
