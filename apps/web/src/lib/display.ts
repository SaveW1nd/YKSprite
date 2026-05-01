export const formatTimestamp = (value: string | null, emptyLabel = '未记录', includeSeconds = true) => {
  if (!value) {
    return emptyLabel;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {})
  });
};

export const formatAnswer = (answerJson: string | null) => {
  if (!answerJson) {
    return '暂无答案';
  }

  try {
    const parsed = JSON.parse(answerJson) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.join('、') || '暂无答案';
    }
    if (typeof parsed === 'string') {
      return parsed || '暂无答案';
    }
    if (parsed && typeof parsed === 'object' && 'content' in parsed && typeof parsed.content === 'string') {
      return parsed.content || '暂无答案';
    }
    return JSON.stringify(parsed);
  } catch {
    return answerJson;
  }
};

export const isSubmittedStatus = (status: string) => ['submitted', 'already_completed'].includes(status);

export const answerStatusLabel = (status: string) => {
  switch (status) {
    case 'submitted':
      return '已提交';
    case 'already_completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'pending':
      return '待提交';
    default:
      return status || '未知';
  }
};

export const platformLabel = (platform: string | null) => {
  switch (platform) {
    case 'rain-classroom':
      return '雨课堂';
    case 'changjiang-rain-classroom':
      return '长江';
    case 'hotang-rain-classroom':
      return '荷塘';
    case 'huanghe-rain-classroom':
      return '黄河';
    default:
      return platform || '未知';
  }
};
