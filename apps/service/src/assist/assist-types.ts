export type OcrResult = {
  text: string;
  sourceImage: string | null;
  savedImagePath: string | null;
  confidenceNote: string;
};

export type QuestionCapture = {
  id: number;
  questionId: string;
  filePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sha256: string | null;
  createdAt: string;
};

export type QuestionCaptureRecord = {
  questionRowId: number;
  sourceType: 'runtime_question' | 'runtime_ppt';
  filePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sha256: string | null;
};

export type VisionAnalysis = {
  id: number;
  questionId: string;
  captureId: number;
  provider: 'openai' | 'qwen_vl';
  model: string;
  promptVersion: string;
  questionType: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  questionText: string;
  options: Array<{ key: string; value: string }>;
  suggestedAnswer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoningSummary: string;
  rawResponseJson: string;
  createdAt: string;
};

export type VisionAnalysisRecord = {
  questionRowId: number;
  captureId: number;
  provider: 'openai' | 'qwen_vl';
  model: string;
  promptVersion: string;
  questionType: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  questionText: string;
  options: Array<{ key: string; value: string }>;
  suggestedAnswer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoningSummary: string;
  rawResponseJson: string;
};

export type DraftAnswer = {
  questionId: string;
  draft: string;
  reasoningSummary: string;
  confidence: 'low' | 'medium' | 'high';
  generatedAt: string;
};
