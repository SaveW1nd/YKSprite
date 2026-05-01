type RainClassroomPlatformId =
  | 'rain-classroom'
  | 'changjiang-rain-classroom'
  | 'hotang-rain-classroom'
  | 'huanghe-rain-classroom';

export type RainClassroomPlatform = {
  id: RainClassroomPlatformId;
  label: string;
  host: string;
  originUrl: string;
  loginUrl: string;
  homeUrl: string;
  wsUrl: string;
  cookieHost: string;
};

const platformDefinitions: RainClassroomPlatform[] = [
  {
    id: 'rain-classroom',
    label: '雨课堂',
    host: 'www.yuketang.cn',
    originUrl: 'https://www.yuketang.cn',
    loginUrl: 'https://www.yuketang.cn/web',
    homeUrl: 'https://www.yuketang.cn/v2/web/index',
    wsUrl: 'wss://www.yuketang.cn/wsapp/',
    cookieHost: 'www.yuketang.cn'
  },
  {
    id: 'changjiang-rain-classroom',
    label: '长江雨课堂',
    host: 'changjiang.yuketang.cn',
    originUrl: 'https://changjiang.yuketang.cn',
    loginUrl: 'https://changjiang.yuketang.cn/web',
    homeUrl: 'https://changjiang.yuketang.cn/v2/web/index',
    wsUrl: 'wss://changjiang.yuketang.cn/wsapp/',
    cookieHost: 'changjiang.yuketang.cn'
  },
  {
    id: 'hotang-rain-classroom',
    label: '荷塘雨课堂',
    host: 'pro.yuketang.cn',
    originUrl: 'https://pro.yuketang.cn',
    loginUrl: 'https://pro.yuketang.cn/web',
    homeUrl: 'https://pro.yuketang.cn/v2/web/index',
    wsUrl: 'wss://pro.yuketang.cn/wsapp/',
    cookieHost: 'pro.yuketang.cn'
  },
  {
    id: 'huanghe-rain-classroom',
    label: '黄河雨课堂',
    host: 'huanghe.yuketang.cn',
    originUrl: 'https://huanghe.yuketang.cn',
    loginUrl: 'https://huanghe.yuketang.cn/web',
    homeUrl: 'https://huanghe.yuketang.cn/v2/web/index',
    wsUrl: 'wss://huanghe.yuketang.cn/wsapp/',
    cookieHost: 'huanghe.yuketang.cn'
  }
];

const platformById = new Map(platformDefinitions.map((platform) => [platform.id, platform]));

const legacyPlatformAliases: Record<string, RainClassroomPlatformId> = {
  Yuketang: 'rain-classroom',
  '雨课堂': 'rain-classroom',
  'rain-classroom': 'rain-classroom',
  '长江雨课堂': 'changjiang-rain-classroom',
  'yangtze-rain-classroom': 'changjiang-rain-classroom',
  'changjiang-rain-classroom': 'changjiang-rain-classroom',
  '荷花雨课堂': 'hotang-rain-classroom',
  '荷塘雨课堂': 'hotang-rain-classroom',
  'lotus-rain-classroom': 'hotang-rain-classroom',
  'hotang-rain-classroom': 'hotang-rain-classroom',
  '黄河雨课堂': 'huanghe-rain-classroom',
  'yellow-river-rain-classroom': 'huanghe-rain-classroom',
  'huanghe-rain-classroom': 'huanghe-rain-classroom'
};

const normalizeHost = (value: string) => {
  try {
    return new URL(value).hostname;
  } catch {
    return value.replace(/^https?:\/\//, '').split('/')[0] ?? value;
  }
};

export const normalizeRainClassroomPlatformId = (value: string | null | undefined): RainClassroomPlatformId => {
  const normalized = value?.trim();
  if (normalized && normalized in legacyPlatformAliases) {
    return legacyPlatformAliases[normalized];
  }
  return 'rain-classroom';
};

export const tryNormalizeRainClassroomPlatformId = (value: string | null | undefined): RainClassroomPlatformId | null => {
  const normalized = value?.trim();
  if (normalized && normalized in legacyPlatformAliases) {
    return legacyPlatformAliases[normalized];
  }
  return null;
};

export const getRainClassroomPlatform = (platformId: string | null | undefined): RainClassroomPlatform =>
  platformById.get(normalizeRainClassroomPlatformId(platformId)) ?? platformDefinitions[0];

export const resolveRainClassroomPlatformByOrigin = (originOrHost: string | null | undefined): RainClassroomPlatform | null => {
  if (!originOrHost?.trim()) {
    return null;
  }

  const host = normalizeHost(originOrHost.trim());
  return platformDefinitions.find((platform) => platform.host === host) ?? null;
};

export const resolveRainClassroomPlatformByUrl = (url: string | null | undefined) => {
  if (!url?.trim()) {
    return null;
  }

  try {
    return resolveRainClassroomPlatformByOrigin(new URL(url).hostname);
  } catch {
    return null;
  }
};

export const buildRainClassroomHomeUrl = (originOrHost: string | null | undefined) => {
  const platform = resolveRainClassroomPlatformByOrigin(originOrHost) ?? getRainClassroomPlatform('rain-classroom');
  return platform.homeUrl;
};

export const isRainClassroomHomePageUrl = (url: string | null | undefined) => {
  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    return parsed.pathname === '/v2/web/index';
  } catch {
    return false;
  }
};
