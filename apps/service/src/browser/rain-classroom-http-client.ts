import type {
  BrowserCookie,
  LessonProblemSubmitPayload,
  LessonProblemSubmitResult
} from './browser-controller.js';

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RainClassroomHttpClientOptions = {
  originUrl: string;
  cookies: BrowserCookie[];
  fetchFn?: FetchLike;
};

export const buildCookieHeader = (cookies: BrowserCookie[]) =>
  cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

export const extractCookieValue = (cookies: BrowserCookie[], name: string) =>
  cookies.find((cookie) => cookie.name === name)?.value ?? null;

const normalizeBearerToken = (value: string | null) => {
  const token = value?.trim();
  if (!token) {
    return null;
  }

  return /^Bearer\s+/i.test(token) ? token : `Bearer ${token}`;
};

export class RainClassroomHttpClient {
  private readonly originUrl: string;
  private readonly cookies: BrowserCookie[];
  private readonly fetchFn: FetchLike;
  private authorization: string | null = null;
  private lessonToken: string | null = null;

  constructor(options: RainClassroomHttpClientOptions) {
    this.originUrl = options.originUrl.replace(/\/+$/, '');
    this.cookies = options.cookies;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async checkInLesson(lessonId: string) {
    const response = await this.fetchFn(this.resolveUrl('/api/v3/lesson/checkin'), {
      method: 'POST',
      headers: {
        ...this.buildBaseHeaders(`${this.originUrl}/lesson/fullscreen/v3/${lessonId}`),
        'content-type': 'application/json;charset=UTF-8'
      },
      body: JSON.stringify({ source: 5, lessonId })
    });
    this.authorization = normalizeBearerToken(response.headers.get('set-auth'));
    const payload = (await response.json().catch(() => null)) as { data?: { lessonToken?: string } } | null;
    this.lessonToken = payload?.data?.lessonToken ?? null;
    return {
      authorization: this.authorization,
      lessonToken: this.lessonToken
    };
  }

  async fetchPresentation(presentationId: string) {
    await this.ensureAuthorization();
    const response = await this.fetchFn(
      this.resolveUrl(`/api/v3/lesson/presentation/fetch?presentation_id=${encodeURIComponent(presentationId)}`),
      {
        method: 'GET',
        headers: this.buildBaseHeaders(`${this.originUrl}/v2/web/index`)
      }
    );

    return response.json();
  }

  async submitProblem(
    payload: LessonProblemSubmitPayload,
    lessonUrl: string
  ): Promise<LessonProblemSubmitResult> {
    await this.ensureAuthorization();
    const response = await this.fetchFn(this.resolveUrl('/api/v3/lesson/problem/answer'), {
      method: 'POST',
      headers: {
        ...this.buildBaseHeaders(lessonUrl),
        'content-type': 'application/json;charset=UTF-8',
        'x-csrftoken': extractCookieValue(this.cookies, 'csrftoken') ?? '',
        'xt-agent': 'web',
        'university-id': '0'
      },
      body: JSON.stringify(payload)
    });

    const text = await response.text();
    let responseJson: unknown = text;
    try {
      responseJson = JSON.parse(text);
    } catch {
      responseJson = text;
    }

    const code =
      typeof responseJson === 'object' &&
      responseJson !== null &&
      'code' in responseJson &&
      typeof (responseJson as { code?: unknown }).code === 'number'
        ? (responseJson as { code: number }).code
        : response.ok
          ? 0
          : response.status;
    const message =
      typeof responseJson === 'object' &&
      responseJson !== null &&
      'msg' in responseJson &&
      typeof (responseJson as { msg?: unknown }).msg === 'string'
        ? (responseJson as { msg: string }).msg
        : response.ok
          ? 'OK'
          : `HTTP ${response.status}`;

    return {
      ok: response.ok && code === 0,
      code,
      message,
      responseJson
    };
  }

  private async ensureAuthorization() {
    if (!this.authorization) {
      throw new Error('Lesson checkin is required before calling lesson APIs');
    }
  }

  private buildBaseHeaders(referrer: string): Record<string, string> {
    const headers: Record<string, string> = {
      accept: 'application/json, text/plain, */*',
      Cookie: buildCookieHeader(this.cookies),
      referer: referrer,
      xtbz: 'ykt',
      'x-client': 'h5'
    };

    if (this.authorization) {
      headers.Authorization = this.authorization;
    }

    return headers;
  }

  private resolveUrl(pathOrUrl: string) {
    return new URL(pathOrUrl, this.originUrl).toString();
  }
}
