import { AccountRepository } from '../db/account-repository.js';
import { buildRainClassroomHomeUrl, getRainClassroomPlatform, resolveRainClassroomPlatformByOrigin } from '../browser/rain-classroom-platforms.js';
import { buildCookieHeader, extractCookieValue } from '../browser/rain-classroom-http-client.js';
import type { StoredSession } from '../browser/browser-controller.js';

type FetchLike = (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

type AccountSessionHeartbeatServiceOptions = {
  accountRepository: AccountRepository;
  fetchFn?: FetchLike;
  intervalMs?: number;
  initialDelayMs?: number;
  requestTimeoutMs?: number;
  onAccountChecked?: (accountId: number) => void;
};

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const DEFAULT_INITIAL_DELAY_MS = 10 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 1000;

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

const safeJson = async (response: Response) => response.json().catch(() => null);

const isUnauthenticatedPayload = (payload: unknown) =>
  isObject(payload) &&
  (payload.code === 50000 || payload.code === 401) &&
  String(payload.msg ?? payload.message ?? '').toUpperCase() === 'UNAUTHENTICATED';

const resolveOriginUrl = (session: StoredSession, platformId: string) => {
  const platform = resolveRainClassroomPlatformByOrigin(session.origin) ?? getRainClassroomPlatform(platformId);
  return platform.originUrl;
};

const buildHeartbeatHeaders = (session: StoredSession, originUrl: string): HeadersInit => ({
  accept: 'application/json, text/plain, */*',
  cookie: buildCookieHeader(session.cookies),
  referer: buildRainClassroomHomeUrl(session.origin),
  origin: originUrl,
  'x-csrftoken': extractCookieValue(session.cookies, 'csrftoken') ?? '',
  xtbz: 'ykt',
  'xt-agent': 'web',
  'x-client': 'h5',
  'university-id': '0'
});

const normalizeHeartbeatError = (error: unknown) => {
  if (error instanceof Error && error.name === 'AbortError') {
    return '会话心跳超时';
  }
  const message = error instanceof Error ? error.message : String(error || '');
  return message.trim() || '会话心跳失败';
};

export class AccountSessionHeartbeatService {
  private readonly accountRepository: AccountRepository;
  private readonly fetchFn: FetchLike;
  private readonly intervalMs: number;
  private readonly initialDelayMs: number;
  private readonly requestTimeoutMs: number;
  private readonly onAccountChecked: ((accountId: number) => void) | null;
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = true;

  constructor(options: AccountSessionHeartbeatServiceOptions) {
    this.accountRepository = options.accountRepository;
    this.fetchFn = options.fetchFn ?? fetch;
    this.intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
    this.initialDelayMs = options.initialDelayMs ?? DEFAULT_INITIAL_DELAY_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.onAccountChecked = options.onAccountChecked ?? null;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.schedule(this.initialDelayMs);
  }

  async stop() {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async runOnce() {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const accounts = this.accountRepository.listWithSessions().filter((account) => account.session?.cookies.length);
      for (const account of accounts) {
        if (!account.session) {
          continue;
        }
        await this.checkAccount(account.id, account.platform, account.session);
      }
    } finally {
      this.running = false;
    }
  }

  private schedule(delayMs: number) {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.runOnce()
        .catch(() => undefined)
        .finally(() => {
          this.schedule(this.intervalMs);
        });
    }, delayMs);
  }

  private async checkAccount(accountId: number, platformId: string, session: StoredSession) {
    const checkedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);

    try {
      const originUrl = resolveOriginUrl(session, platformId);
      const response = await this.fetchFn(new URL('/api/v3/user/basic-info', originUrl).toString(), {
        method: 'GET',
        headers: buildHeartbeatHeaders(session, originUrl),
        signal: controller.signal
      });
      const payload = await safeJson(response);
      if (response.status === 401 || isUnauthenticatedPayload(payload)) {
        this.accountRepository.markAccountCheckError(accountId, {
          reason: '会话失效，需重新登录',
          checkedAt
        });
      } else if (!response.ok) {
        this.accountRepository.markAccountCheckError(accountId, {
          reason: `会话心跳失败：HTTP ${response.status}`,
          checkedAt
        });
      } else {
        this.accountRepository.markAccountHealthy(accountId, {
          checkedAt
        });
      }
    } catch (error) {
      this.accountRepository.markAccountCheckError(accountId, {
        reason: normalizeHeartbeatError(error),
        checkedAt
      });
    } finally {
      clearTimeout(timeout);
      this.onAccountChecked?.(accountId);
    }
  }
}
