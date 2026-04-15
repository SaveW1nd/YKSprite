import { requestOpenAICompatibleJson } from './openai-compatible.js';

export const analyzeWithQwenVl = async (input: {
  imagePath: string;
  prompt: string;
}) => {
  const apiKey = process.env.QWEN_VL_API_KEY;
  if (!apiKey) {
    throw new Error('QWEN_VL_API_KEY is not configured');
  }

  return requestOpenAICompatibleJson(
    {
      apiKey,
      endpoint: process.env.QWEN_VL_BASE_URL ?? 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: process.env.QWEN_VL_MODEL ?? 'qwen-vl-max'
    },
    input
  );
};
