export type OcrResult = {
  text: string;
  sourceImage: string | null;
  savedImagePath: string | null;
  confidenceNote: string;
};

export type DraftAnswer = {
  questionId: string;
  draft: string;
  reasoningSummary: string;
  confidence: 'low' | 'medium' | 'high';
  generatedAt: string;
};
