import { describe, expect, it } from 'vitest';
import {
  getRainClassroomPlatform,
  normalizeRainClassroomPlatformId,
  resolveRainClassroomPlatformByOrigin
} from '../../apps/service/src/browser/rain-classroom-platforms';

describe('rain classroom platforms', () => {
  it('resolves built-in platform configs by id', () => {
    expect(getRainClassroomPlatform('rain-classroom')).toMatchObject({
      id: 'rain-classroom',
      label: '雨课堂',
      host: 'www.yuketang.cn',
      loginUrl: 'https://www.yuketang.cn/web',
      homeUrl: 'https://www.yuketang.cn/v2/web/index',
      wsUrl: 'wss://www.yuketang.cn/wsapp/'
    });

    expect(getRainClassroomPlatform('changjiang-rain-classroom')).toMatchObject({
      id: 'changjiang-rain-classroom',
      label: '长江雨课堂',
      host: 'changjiang.yuketang.cn',
      loginUrl: 'https://changjiang.yuketang.cn/web',
      homeUrl: 'https://changjiang.yuketang.cn/v2/web/index',
      wsUrl: 'wss://changjiang.yuketang.cn/wsapp/'
    });

    expect(getRainClassroomPlatform('hotang-rain-classroom')).toMatchObject({
      id: 'hotang-rain-classroom',
      label: '荷塘雨课堂',
      host: 'pro.yuketang.cn'
    });

    expect(getRainClassroomPlatform('huanghe-rain-classroom')).toMatchObject({
      id: 'huanghe-rain-classroom',
      label: '黄河雨课堂',
      host: 'huanghe.yuketang.cn'
    });
  });

  it('normalizes legacy labels and aliases to built-in platform ids', () => {
    expect(normalizeRainClassroomPlatformId('Yuketang')).toBe('rain-classroom');
    expect(normalizeRainClassroomPlatformId('雨课堂')).toBe('rain-classroom');
    expect(normalizeRainClassroomPlatformId('长江雨课堂')).toBe('changjiang-rain-classroom');
    expect(normalizeRainClassroomPlatformId('yangtze-rain-classroom')).toBe('changjiang-rain-classroom');
    expect(normalizeRainClassroomPlatformId('荷花雨课堂')).toBe('hotang-rain-classroom');
    expect(normalizeRainClassroomPlatformId('lotus-rain-classroom')).toBe('hotang-rain-classroom');
    expect(normalizeRainClassroomPlatformId('荷塘雨课堂')).toBe('hotang-rain-classroom');
    expect(normalizeRainClassroomPlatformId('黄河雨课堂')).toBe('huanghe-rain-classroom');
  });

  it('resolves platform configs from stored session origins', () => {
    expect(resolveRainClassroomPlatformByOrigin('www.yuketang.cn')?.id).toBe('rain-classroom');
    expect(resolveRainClassroomPlatformByOrigin('https://changjiang.yuketang.cn/v2/web/index')?.id).toBe('changjiang-rain-classroom');
    expect(resolveRainClassroomPlatformByOrigin('pro.yuketang.cn')?.id).toBe('hotang-rain-classroom');
    expect(resolveRainClassroomPlatformByOrigin('huanghe.yuketang.cn')?.id).toBe('huanghe-rain-classroom');
  });
});
