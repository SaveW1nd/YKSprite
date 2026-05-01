import { AccountRepository, type AccountIdentity } from '../db/account-repository.js';
import type { BrowserCookie, BrowserStatus } from './browser-controller.js';
import type { AccountLoginController, AccountLoginState, StartAccountLoginInput } from './account-login-controller.js';
import { getRainClassroomPlatform, type RainClassroomPlatform } from './rain-classroom-platforms.js';

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

type RainClassroomHttpLoginControllerOptions = {
  accountRepository: AccountRepository;
  fetchFn?: FetchLike;
  pollIntervalMs?: number;
  loginTimeoutMs?: number;
  onAccountSessionSaved?: (accountId: number) => void | Promise<void>;
};

type ActiveLogin = {
  loginSessionId: string;
  platform: RainClassroomPlatform;
  state: string;
  qrPageUrl: string;
  uuid: string;
  cancelled: boolean;
};

type CookieJar = Map<string, BrowserCookie>;

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

const createIdleStatus = (): BrowserStatus => ({
  status: 'idle',
  engine: 'http',
  mode: null,
  startedAt: null,
  pageUrl: null,
  lastError: null
});

const createIdleAccountLoginState = (): AccountLoginState => ({
  loginSessionId: null,
  accountId: null,
  status: 'idle',
  qrCodeDataUrl: null,
  lastError: null,
  notice: null,
  updatedAt: null
});

const createLoginSessionId = () => `login-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getSetCookieHeaders = (headers: Headers) => {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] };
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie();
  }
  const value = headers.get('set-cookie');
  return value ? [value] : [];
};

const parseCookieExpiry = (attributes: string[]) => {
  const maxAge = attributes.find((attribute) => /^max-age=/i.test(attribute));
  if (maxAge) {
    const seconds = Number(maxAge.split('=')[1]);
    return Number.isFinite(seconds) ? Math.floor(Date.now() / 1000 + seconds) : -1;
  }

  const expires = attributes.find((attribute) => /^expires=/i.test(attribute));
  if (expires) {
    const timestamp = Date.parse(expires.slice(expires.indexOf('=') + 1));
    return Number.isFinite(timestamp) ? Math.floor(timestamp / 1000) : -1;
  }

  return -1;
};

const parseSameSite = (attributes: string[]) => {
  const sameSite = attributes.find((attribute) => /^samesite=/i.test(attribute))?.split('=')[1];
  if (!sameSite) {
    return undefined;
  }

  const normalized = sameSite.toLowerCase();
  if (normalized === 'strict') {
    return 'Strict';
  }
  if (normalized === 'lax') {
    return 'Lax';
  }
  if (normalized === 'none') {
    return 'None';
  }
  return sameSite;
};

const mergeSetCookie = (jar: CookieJar, setCookie: string, cookieDomain: string) => {
  const [pair, ...attributes] = setCookie.split(';').map((part) => part.trim()).filter(Boolean);
  const separator = pair?.indexOf('=') ?? -1;
  if (!pair || separator <= 0) {
    return;
  }

  const name = pair.slice(0, separator);
  const value = pair.slice(separator + 1);
  const domain = attributes.find((attribute) => /^domain=/i.test(attribute))?.split('=')[1] ?? cookieDomain;
  const path = attributes.find((attribute) => /^path=/i.test(attribute))?.split('=')[1] ?? '/';
  const lowerAttributes = attributes.map((attribute) => attribute.toLowerCase());
  const cookie: BrowserCookie = {
    name,
    value,
    domain,
    path,
    expires: parseCookieExpiry(attributes),
    httpOnly: lowerAttributes.includes('httponly'),
    secure: lowerAttributes.includes('secure'),
    sameSite: parseSameSite(attributes)
  };

  jar.set(`${cookie.name};${cookie.domain};${cookie.path}`, cookie);
};

const buildCookieHeader = (jar: CookieJar) =>
  [...jar.values()].map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

const readJson = async (response: Response) => response.json().catch(() => null);

export class RainClassroomHttpLoginController implements AccountLoginController {
  private readonly accountRepository: AccountRepository;
  private readonly fetchFn: FetchLike;
  private readonly pollIntervalMs: number;
  private readonly loginTimeoutMs: number;
  private readonly onAccountSessionSaved: ((accountId: number) => void | Promise<void>) | null;
  private status: BrowserStatus = createIdleStatus();
  private accountLoginState: AccountLoginState = createIdleAccountLoginState();
  private activeLogin: ActiveLogin | null = null;

  constructor(options: RainClassroomHttpLoginControllerOptions) {
    this.accountRepository = options.accountRepository;
    this.fetchFn = options.fetchFn ?? fetch;
    this.pollIntervalMs = options.pollIntervalMs ?? 1000;
    this.loginTimeoutMs = options.loginTimeoutMs ?? 180_000;
    this.onAccountSessionSaved = options.onAccountSessionSaved ?? null;
  }

  async start(): Promise<BrowserStatus> {
    return this.status;
  }

  async stop(): Promise<BrowserStatus> {
    if (this.activeLogin) {
      this.activeLogin.cancelled = true;
      this.activeLogin = null;
    }
    this.status = createIdleStatus();
    return this.status;
  }

  async startAccountLogin(input?: StartAccountLoginInput): Promise<AccountLoginState> {
    await this.stop();
    const loginSessionId = createLoginSessionId();
    const platform = getRainClassroomPlatform(input?.platform);
    this.status = {
      status: 'starting',
      engine: 'http',
      mode: 'qr-login',
      startedAt: new Date().toISOString(),
      pageUrl: null,
      lastError: null
    };
    this.accountLoginState = {
      loginSessionId,
      accountId: null,
      status: 'pending',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: new Date().toISOString()
    };

    try {
      const qrTarget = await this.createQrTarget(platform);
      const qrCodeDataUrl = await this.downloadQrCodeDataUrl(qrTarget.qrPageUrl, qrTarget.imageUrl);
      const activeLogin: ActiveLogin = {
        loginSessionId,
        platform,
        state: qrTarget.state,
        qrPageUrl: qrTarget.qrPageUrl,
        uuid: qrTarget.uuid,
        cancelled: false
      };
      this.activeLogin = activeLogin;
      this.status = {
        ...this.status,
        status: 'running',
        pageUrl: qrTarget.qrPageUrl,
        lastError: null
      };
      this.accountLoginState = {
        ...this.accountLoginState,
        qrCodeDataUrl,
        updatedAt: new Date().toISOString()
      };
      void this.pollQrLogin(activeLogin);
      return { ...this.accountLoginState };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown HTTP QR login error';
      this.status = {
        ...createIdleStatus(),
        status: 'error',
        lastError: message
      };
      this.accountLoginState = {
        loginSessionId,
        accountId: null,
        status: 'error',
        qrCodeDataUrl: null,
        lastError: message,
        notice: null,
        updatedAt: new Date().toISOString()
      };
      return { ...this.accountLoginState };
    }
  }

  async getAccountLoginState(loginSessionId: string): Promise<AccountLoginState> {
    if (this.accountLoginState.loginSessionId === loginSessionId) {
      return { ...this.accountLoginState };
    }

    return {
      loginSessionId,
      accountId: null,
      status: 'idle',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: null
    };
  }

  async stopAccountLogin(loginSessionId: string): Promise<AccountLoginState> {
    if (this.accountLoginState.loginSessionId !== loginSessionId) {
      return {
        loginSessionId,
        accountId: null,
        status: 'idle',
        qrCodeDataUrl: null,
        lastError: null,
        notice: null,
        updatedAt: null
      };
    }

    await this.stop();
    this.accountLoginState = createIdleAccountLoginState();
    return {
      loginSessionId,
      accountId: null,
      status: 'idle',
      qrCodeDataUrl: null,
      lastError: null,
      notice: null,
      updatedAt: new Date().toISOString()
    };
  }

  private async createQrTarget(platform: RainClassroomPlatform) {
    const authResponse = await this.fetchFn(`${platform.originUrl}/api/v3/user/login/wechat-auth-param`, {
      method: 'POST',
      headers: this.buildJsonHeaders(platform.loginUrl)
    });
    const authPayload = (await readJson(authResponse)) as
      | {
          code?: number;
          data?: { appId?: string; state?: string; redirectUri?: string };
        }
      | null;
    const authData = authPayload?.data;
    if (!authResponse.ok || authPayload?.code !== 0 || !authData?.appId || !authData.state || !authData.redirectUri) {
      throw new Error('Unable to request login QR parameters');
    }

    const params = new URLSearchParams({
      appid: authData.appId,
      scope: 'snsapi_login',
      redirect_uri: `${authData.redirectUri}?path=%2Fauthorize%2Fwx-qrlogin%3Fsuccess%3D1`,
      state: authData.state,
      login_type: 'jssdk',
      self_redirect: 'true',
      stylelite: '1'
    });
    const qrPageUrl = `https://open.weixin.qq.com/connect/qrconnect?${params.toString()}`;
    const qrPageResponse = await this.fetchFn(qrPageUrl, {
      headers: this.buildHtmlHeaders(platform.loginUrl)
    });
    const html = await qrPageResponse.text();
    const imageMatch =
      html.match(/<img[^>]+class=["'][^"']*js_qrcode_img[^"']*["'][^>]+src=["']([^"']+)/i) ??
      html.match(/src=["']([^"']*\/connect\/qrcode\/[^"']+)/i);
    const uuidMatch = html.match(/uuid=([^"'&]+)/) ?? imageMatch?.[1]?.match(/\/connect\/qrcode\/([^?"']+)/) ?? null;
    if (!qrPageResponse.ok || !imageMatch?.[1] || !uuidMatch?.[1]) {
      throw new Error('Unable to parse login QR page');
    }

    return {
      state: authData.state,
      qrPageUrl,
      imageUrl: new URL(imageMatch[1], 'https://open.weixin.qq.com').toString(),
      uuid: uuidMatch[1]
    };
  }

  private async downloadQrCodeDataUrl(qrPageUrl: string, imageUrl: string) {
    const imageResponse = await this.fetchFn(imageUrl, {
      headers: this.buildHtmlHeaders(qrPageUrl)
    });
    if (!imageResponse.ok) {
      throw new Error('Unable to download QR image');
    }
    const contentType = imageResponse.headers.get('content-type') ?? 'image/jpeg';
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    return `data:${contentType};base64,${imageBuffer.toString('base64')}`;
  }

  private async pollQrLogin(activeLogin: ActiveLogin) {
    const startedAt = Date.now();
    let last: number | null = null;
    while (!activeLogin.cancelled && this.activeLogin === activeLogin && Date.now() - startedAt < this.loginTimeoutMs) {
      try {
        const url = `https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=${encodeURIComponent(activeLogin.uuid)}${last ? `&last=${last}` : ''}`;
        const response = await this.fetchFn(url, {
          headers: this.buildHtmlHeaders(activeLogin.qrPageUrl)
        });
        const body = await response.text();
        const errcode = Number(body.match(/wx_errcode\s*=\s*['"]?(\d+)/)?.[1] ?? NaN);
        const wxCode = body.match(/wx_code\s*=\s*['"]([^'"]+)/)?.[1] ?? null;

        if (errcode === 405 && wxCode) {
          await this.completeLogin(activeLogin, wxCode);
          return;
        }
        if (errcode === 403) {
          this.failLogin(activeLogin, '二维码登录已取消');
          return;
        }
        last = Number.isFinite(errcode) ? errcode : last;
        await delay(errcode === 404 ? 250 : this.pollIntervalMs);
      } catch (error) {
        this.failLogin(activeLogin, error instanceof Error ? error.message : '二维码登录轮询失败');
        return;
      }
    }

    if (!activeLogin.cancelled && this.activeLogin === activeLogin) {
      this.failLogin(activeLogin, '二维码登录超时');
    }
  }

  private async completeLogin(activeLogin: ActiveLogin, wxCode: string) {
    const jar: CookieJar = new Map();
    const callbackUrl = `${activeLogin.platform.originUrl}/api/v3/user/login/wechat-web-callback?path=%2Fauthorize%2Fwx-qrlogin%3Fsuccess%3D1&code=${encodeURIComponent(wxCode)}&state=${encodeURIComponent(activeLogin.state)}`;
    await this.fetchWithCookieRedirects(callbackUrl, jar, activeLogin.qrPageUrl);
    const cookies = [...jar.values()];
    if (cookies.length === 0) {
      throw new Error('登录回调未返回 session cookie');
    }
    const identity = await this.fetchAccountIdentity(activeLogin.platform, jar);
    const persisted = this.accountRepository.saveSessionForLogin(
      {
        cookies,
        savedAt: new Date().toISOString(),
        origin: activeLogin.platform.host,
        currentUrl: activeLogin.platform.homeUrl,
        pageTitle: activeLogin.platform.label,
        mode: 'qr-login'
      },
      identity
    );
    const persistedAccountId = persisted.accountId > 0 ? persisted.accountId : null;
    this.accountLoginState = {
      loginSessionId: activeLogin.loginSessionId,
      accountId: persistedAccountId,
      status: 'completed',
      qrCodeDataUrl: this.accountLoginState.qrCodeDataUrl,
      lastError: null,
      notice: persisted.refreshedExistingAccount ? '重复账号，已刷新会话' : null,
      updatedAt: new Date().toISOString()
    };
    this.activeLogin = null;
    this.status = createIdleStatus();
    if (persistedAccountId) {
      await this.onAccountSessionSaved?.(persistedAccountId);
    }
  }

  private failLogin(activeLogin: ActiveLogin, message: string) {
    if (this.activeLogin !== activeLogin) {
      return;
    }
    this.activeLogin = null;
    this.status = {
      ...createIdleStatus(),
      status: 'error',
      lastError: message
    };
    this.accountLoginState = {
      loginSessionId: activeLogin.loginSessionId,
      accountId: null,
      status: 'error',
      qrCodeDataUrl: this.accountLoginState.qrCodeDataUrl,
      lastError: message,
      notice: null,
      updatedAt: new Date().toISOString()
    };
  }

  private async fetchWithCookieRedirects(url: string, jar: CookieJar, referer: string) {
    let currentUrl = url;
    let response: Response | null = null;
    for (let index = 0; index < 8; index += 1) {
      response = await this.fetchFn(currentUrl, {
        redirect: 'manual',
        headers: {
          ...this.buildHtmlHeaders(referer),
          ...(jar.size > 0 ? { cookie: buildCookieHeader(jar) } : {})
        }
      });
      for (const setCookie of getSetCookieHeaders(response.headers)) {
        mergeSetCookie(jar, setCookie, new URL(currentUrl).hostname);
      }
      const location = response.headers.get('location');
      if (![301, 302, 303, 307, 308].includes(response.status) || !location) {
        return response;
      }
      currentUrl = new URL(location, currentUrl).toString();
      referer = currentUrl;
    }
    return response;
  }

  private async fetchAccountIdentity(platform: RainClassroomPlatform, jar: CookieJar): Promise<AccountIdentity | null> {
    const requestJson = async (path: string) => {
      const response = await this.fetchFn(new URL(path, platform.originUrl).toString(), {
        headers: {
          ...this.buildJsonHeaders(platform.homeUrl),
          cookie: buildCookieHeader(jar)
        }
      });
      if (!response.ok) {
        return null;
      }
      return response.json().catch(() => null);
    };

    const basicInfoPayload = await requestJson('/api/v3/user/basic-info');
    const basicInfo = basicInfoPayload?.code === 0 ? basicInfoPayload.data : null;
    const basicUserId =
      typeof basicInfo?.id === 'string' || typeof basicInfo?.id === 'number' ? String(basicInfo.id) : null;
    const basicName = typeof basicInfo?.name === 'string' ? basicInfo.name.trim() : null;
    if (basicUserId || basicName) {
      return {
        userId: basicUserId,
        name: basicName
      };
    }

    const webUserinfoPayload = await requestJson('/v2/api/web/userinfo');
    const webUserinfo = Array.isArray(webUserinfoPayload?.data) ? webUserinfoPayload.data[0] : null;
    const webUserId =
      typeof webUserinfo?.user_id === 'string' || typeof webUserinfo?.user_id === 'number'
        ? String(webUserinfo.user_id)
        : null;
    const webName = typeof webUserinfo?.name === 'string' ? webUserinfo.name.trim() : null;
    return webUserId || webName
      ? {
          userId: webUserId,
          name: webName
        }
      : null;
  }

  private buildJsonHeaders(referer: string): Record<string, string> {
    return {
      'user-agent': USER_AGENT,
      accept: 'application/json, text/plain, */*',
      referer
    };
  }

  private buildHtmlHeaders(referer: string): Record<string, string> {
    return {
      'user-agent': USER_AGENT,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer
    };
  }
}
