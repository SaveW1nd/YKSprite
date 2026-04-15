import { requestOpenAICompatibleJson } from './openai-compatible.js';

export const analyzeWithOpenAI = async (input: {
  imagePath: string;
  prompt: string;
}) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return requestOpenAICompatibleJson(
    {
      apiKey,
      endpoint: process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1/chat/completions',
      model: process.env.OPENAI_MODEL ?? 'gpt-4.1-mini'
    },
    input
  );
};
