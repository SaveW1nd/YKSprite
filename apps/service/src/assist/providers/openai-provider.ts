import { requestOpenAICompatibleJson } from './openai-compatible.js';
import type { QwenRuntimeConfig } from '../../api-config/api-config-types.js';

export const analyzeWithOpenAI = async (input: {
  imagePath: string;
  prompt: string;
  config: QwenRuntimeConfig;
}) => {
  const apiKey = input.config.apiKey;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is not configured');
  }

  return requestOpenAICompatibleJson(
    {
      apiKey,
      endpoint: input.config.baseUrl,
      model: input.config.model
    },
    {
      imagePath: input.imagePath,
      prompt: input.prompt
    }
  );
};
