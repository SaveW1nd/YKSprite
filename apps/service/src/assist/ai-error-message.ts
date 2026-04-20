export const MISSING_AI_API_KEY_MESSAGE = 'api key未配置，无法调用 AI 解题';

export const normalizeAiErrorMessage = (reason: string, provider: 'openai' | 'qwen_vl' | null = null) => {
  if (provider === 'qwen_vl' && reason.includes('QWEN_VL_API_KEY is not configured')) {
    return MISSING_AI_API_KEY_MESSAGE;
  }

  if (provider === 'qwen_vl' && reason.includes('fetch failed')) {
    return 'Qwen 接口连接失败，请检查当前网络或接口地址';
  }

  if (provider === 'openai' && reason.includes('OPENAI_API_KEY is not configured')) {
    return MISSING_AI_API_KEY_MESSAGE;
  }

  return reason;
};
