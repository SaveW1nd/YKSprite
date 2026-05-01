import { and, desc, eq, like, or } from 'drizzle-orm';
import type { BrowserCookie, StoredSession } from '../browser/browser-controller.js';
import type { DatabaseClient } from './client.js';
import { accountsTable } from './schema.js';
import {
  getRainClassroomPlatform,
  normalizeRainClassroomPlatformId,
  resolveRainClassroomPlatformByOrigin,
  tryNormalizeRainClassroomPlatformId
} from '../browser/rain-classroom-platforms.js';

export type ManagedAccountStatus = 'healthy' | 'error';

type ManagedAccountRecord = {
  id: number;
  userId: string | null;
  name: string | null;
  monitoringEnabled: boolean;
  activeLessonEnterDelayMs: number;
  accountKey: string;
  platform: string;
  status: ManagedAccountStatus;
  lastCheckedAt: string | null;
  lastErrorReason: string | null;
  note: string | null;
  cookieCount: number | null;
  sessionSavedAt: string | null;
  createdAt: string;
};

type ListManagedAccountsInput = {
  q?: string;
  platform?: string;
  status?: ManagedAccountStatus;
};

export type AccountIdentity = {
  userId: string | null;
  name: string | null;
};

type StoredAccountSession = StoredSession;

type SaveSessionResult = {
  accountId: number;
  refreshedExistingAccount: boolean;
};

type MarkLoginHealthyInput = {
  checkedAt: string;
  currentUrl?: string | null;
  mode?: string | null;
};

type MarkAccountHealthyInput = {
  checkedAt: string;
};

const buildCookiesFingerprint = (cookies: BrowserCookie[]) =>
  JSON.stringify(
    cookies.map((cookie) => ({
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path
    }))
  );

const resolveStoredPlatformId = (platform: string | null | undefined, origin: string | null | undefined) =>
  resolveRainClassroomPlatformByOrigin(origin)?.id ?? tryNormalizeRainClassroomPlatformId(platform) ?? platform ?? 'rain-classroom';

const buildPlatformFilterCondition = (platform: string) => {
  const normalizedPlatform = normalizeRainClassroomPlatformId(platform);
  const legacyVariants = new Set<string>([normalizedPlatform]);
  if (normalizedPlatform === 'rain-classroom') {
    legacyVariants.add('Yuketang');
    legacyVariants.add('雨课堂');
  }
  if (normalizedPlatform === 'changjiang-rain-classroom') {
    legacyVariants.add('长江雨课堂');
    legacyVariants.add('yangtze-rain-classroom');
  }
  if (normalizedPlatform === 'hotang-rain-classroom') {
    legacyVariants.add('荷塘雨课堂');
    legacyVariants.add('荷花雨课堂');
    legacyVariants.add('lotus-rain-classroom');
  }
  if (normalizedPlatform === 'huanghe-rain-classroom') {
    legacyVariants.add('黄河雨课堂');
    legacyVariants.add('yellow-river-rain-classroom');
  }
  return or(...[...legacyVariants].map((variant) => eq(accountsTable.platform, variant)));
};

export class AccountRepository {
  constructor(private readonly database: DatabaseClient) {}

  list(input: ListManagedAccountsInput = {}): ManagedAccountRecord[] {
    this.cleanupAnonymousDuplicateSessions();
    const conditions = [];

    if (input.platform) {
      conditions.push(buildPlatformFilterCondition(input.platform));
    }

    if (input.status) {
      conditions.push(eq(accountsTable.status, input.status));
    }

    if (input.q) {
      const search = `%${input.q}%`;
      conditions.push(
        or(
          like(accountsTable.accountKey, search),
          like(accountsTable.platform, search),
          like(accountsTable.note, search)
        )
      );
    }

    const query = this.database.db.select().from(accountsTable);
    const rows =
      conditions.length > 0
        ? query.where(and(...conditions)).orderBy(desc(accountsTable.createdAt), desc(accountsTable.id)).all()
        : query.orderBy(desc(accountsTable.createdAt), desc(accountsTable.id)).all();

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      monitoringEnabled: row.monitoringEnabled,
      activeLessonEnterDelayMs: row.activeLessonEnterDelayMs,
      accountKey: row.accountKey,
      platform: resolveStoredPlatformId(row.platform, row.origin),
      status: row.status as ManagedAccountStatus,
      lastCheckedAt: row.lastCheckedAt,
      lastErrorReason: row.lastErrorReason,
      note: row.note,
      cookieCount: row.cookieCount,
      sessionSavedAt: row.sessionSavedAt,
      createdAt: row.createdAt
    }));
  }

  getById(id: number): ManagedAccountRecord | null {
    const row = this.database.db.select().from(accountsTable).where(eq(accountsTable.id, id)).get();
    if (!row) {
      return null;
    }

    return {
      id: row.id,
      userId: row.userId,
      name: row.name,
      monitoringEnabled: row.monitoringEnabled,
      activeLessonEnterDelayMs: row.activeLessonEnterDelayMs,
      accountKey: row.accountKey,
      platform: resolveStoredPlatformId(row.platform, row.origin),
      status: row.status as ManagedAccountStatus,
      lastCheckedAt: row.lastCheckedAt,
      lastErrorReason: row.lastErrorReason,
      note: row.note,
      cookieCount: row.cookieCount,
      sessionSavedAt: row.sessionSavedAt,
      createdAt: row.createdAt
    };
  }

  listWithSessions() {
    this.cleanupAnonymousDuplicateSessions();
    const rows = this.database.db
      .select()
      .from(accountsTable)
      .orderBy(desc(accountsTable.createdAt), desc(accountsTable.id))
      .all();

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      monitoringEnabled: row.monitoringEnabled,
      activeLessonEnterDelayMs: row.activeLessonEnterDelayMs,
      accountKey: row.accountKey,
      platform: resolveStoredPlatformId(row.platform, row.origin),
      status: row.status as ManagedAccountStatus,
      lastCheckedAt: row.lastCheckedAt,
      lastErrorReason: row.lastErrorReason,
      note: row.note,
      cookieCount: row.cookieCount,
      sessionSavedAt: row.sessionSavedAt,
      createdAt: row.createdAt,
      session:
        row.cookiesJson && row.cookieCount
          ? ({
              cookies: JSON.parse(row.cookiesJson) as BrowserCookie[],
              savedAt: row.sessionSavedAt ?? row.createdAt,
              origin: row.origin ?? getRainClassroomPlatform(row.platform).host,
              currentUrl: row.currentUrl ?? null,
              pageTitle: row.pageTitle ?? null,
              mode: row.mode ?? null
            } satisfies StoredAccountSession)
          : null
    }));
  }

  getStoredSession(accountId: number): StoredAccountSession | null {
    const row = this.database.db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, accountId))
      .get();

    if (!row?.cookiesJson || !row.cookieCount) {
      return null;
    }

    return {
      cookies: JSON.parse(row.cookiesJson) as BrowserCookie[],
      savedAt: row.sessionSavedAt ?? row.createdAt,
      origin: row.origin ?? getRainClassroomPlatform(row.platform).host,
      currentUrl: row.currentUrl ?? null,
      pageTitle: row.pageTitle ?? null,
      mode: row.mode ?? null
    };
  }

  setMonitoringEnabled(accountId: number, enabled: boolean): ManagedAccountRecord | null {
    this.database.db
      .update(accountsTable)
      .set({
        monitoringEnabled: enabled
      })
      .where(eq(accountsTable.id, accountId))
      .run();

    return this.getById(accountId);
  }

  setActiveLessonEnterDelayMs(accountId: number, delayMs: number): ManagedAccountRecord | null {
    this.database.db
      .update(accountsTable)
      .set({
        activeLessonEnterDelayMs: delayMs
      })
      .where(eq(accountsTable.id, accountId))
      .run();

    return this.getById(accountId);
  }

  delete(accountId: number) {
    this.database.db.delete(accountsTable).where(eq(accountsTable.id, accountId)).run();
  }

  cleanupPendingLoginPlaceholders() {
    const staleAccounts = this.database.db
      .select()
      .from(accountsTable)
      .all()
      .filter((row) =>
        resolveStoredPlatformId(row.platform, row.origin) === 'rain-classroom' &&
        !row.userId &&
        !row.name &&
        !row.cookiesJson &&
        !row.cookieCount &&
        row.lastErrorReason === '未登录'
      );

    for (const account of staleAccounts) {
      this.database.db.delete(accountsTable).where(eq(accountsTable.id, account.id)).run();
    }

    return staleAccounts.length;
  }

  cleanupAnonymousDuplicateSessions() {
    const rows = this.database.db.select().from(accountsTable).all();
    const identifiedFingerprints = new Set(
      rows
        .filter((row) => row.userId && row.cookiesJson)
        .map((row) => row.cookiesJson as string)
    );
    const anonymousDuplicates = rows.filter(
      (row) =>
        !row.userId &&
        !row.name &&
        Boolean(row.cookiesJson) &&
        identifiedFingerprints.has(row.cookiesJson as string)
    );

    for (const account of anonymousDuplicates) {
      this.database.db.delete(accountsTable).where(eq(accountsTable.id, account.id)).run();
    }

    return anonymousDuplicates.length;
  }

  saveSession(accountId: number, session: StoredAccountSession, identity?: AccountIdentity | null): SaveSessionResult {
    const normalizedUserId = identity?.userId?.trim() || null;
    const normalizedName = identity?.name?.trim() || null;
    const currentPlatformId = resolveStoredPlatformId(this.getById(accountId)?.platform ?? null, session.origin);
    const duplicateAccount =
      normalizedUserId
        ? this.database.db
            .select()
            .from(accountsTable)
            .where(eq(accountsTable.userId, normalizedUserId))
            .all()
            .find((row) => row.id !== accountId && resolveStoredPlatformId(row.platform, row.origin) === currentPlatformId) ?? null
        : null;
    const targetAccountId = duplicateAccount?.id ?? accountId;

    this.database.db
      .update(accountsTable)
      .set({
        userId: normalizedUserId ?? undefined,
        name: normalizedName ?? undefined,
        accountKey: normalizedName ?? undefined,
        status: 'healthy',
        lastCheckedAt: session.savedAt,
        lastErrorReason: null,
        cookiesJson: JSON.stringify(session.cookies),
        cookieCount: session.cookies.length,
        sessionSavedAt: session.savedAt,
        origin: session.origin,
        currentUrl: session.currentUrl,
        pageTitle: session.pageTitle,
        mode: session.mode
      })
      .where(eq(accountsTable.id, targetAccountId))
      .run();

    if (duplicateAccount) {
      this.database.db.delete(accountsTable).where(eq(accountsTable.id, accountId)).run();
    }

    return {
      accountId: targetAccountId,
      refreshedExistingAccount: Boolean(duplicateAccount)
    };
  }

  saveSessionForLogin(session: StoredAccountSession, identity?: AccountIdentity | null): SaveSessionResult {
    const normalizedUserId = identity?.userId?.trim() || null;
    const normalizedName = identity?.name?.trim() || null;
    const currentPlatformId = resolveStoredPlatformId(null, session.origin);
    this.cleanupPendingLoginPlaceholders();
    this.cleanupAnonymousDuplicateSessions();
    const sessionFingerprint = buildCookiesFingerprint(session.cookies);
    const existingAccount =
      normalizedUserId
        ? this.database.db
            .select()
            .from(accountsTable)
            .where(eq(accountsTable.userId, normalizedUserId))
            .all()
            .find((row) => resolveStoredPlatformId(row.platform, row.origin) === currentPlatformId) ?? null
        : null;
    const existingBySession =
      !existingAccount
        ? this.database.db
            .select()
            .from(accountsTable)
            .all()
            .find(
              (row) =>
                row.cookiesJson === sessionFingerprint &&
                Boolean(row.userId) &&
                resolveStoredPlatformId(row.platform, row.origin) === currentPlatformId
            ) ?? null
        : null;

    const targetExistingAccount = existingAccount ?? existingBySession;

    if (targetExistingAccount) {
      this.database.db
        .update(accountsTable)
        .set({
          userId: normalizedUserId ?? targetExistingAccount.userId,
          name: normalizedName ?? targetExistingAccount.name ?? undefined,
          accountKey: normalizedName ?? targetExistingAccount.accountKey ?? undefined,
          status: 'healthy',
          lastCheckedAt: session.savedAt,
          lastErrorReason: null,
          cookiesJson: sessionFingerprint,
          cookieCount: session.cookies.length,
          sessionSavedAt: session.savedAt,
          origin: session.origin,
          currentUrl: session.currentUrl,
          pageTitle: session.pageTitle,
          mode: session.mode
        })
        .where(eq(accountsTable.id, targetExistingAccount.id))
        .run();

      return {
        accountId: targetExistingAccount.id,
        refreshedExistingAccount: true
      };
    }

    if (!normalizedUserId && !normalizedName) {
      return {
        accountId: -1,
        refreshedExistingAccount: false
      };
    }

    const createdAt = new Date().toISOString();
    const result = this.database.db.insert(accountsTable).values({
      userId: normalizedUserId,
      name: normalizedName,
      monitoringEnabled: true,
      accountKey: normalizedName || normalizedUserId || `雨课堂账号-${Date.now()}`,
      platform: currentPlatformId,
      status: 'healthy',
      lastCheckedAt: session.savedAt,
      lastErrorReason: null,
      note: null,
      cookiesJson: sessionFingerprint,
      cookieCount: session.cookies.length,
      sessionSavedAt: session.savedAt,
      origin: session.origin,
      currentUrl: session.currentUrl,
      pageTitle: session.pageTitle,
      mode: session.mode,
      createdAt
    }).run();

    return {
      accountId: Number(result.lastInsertRowid),
      refreshedExistingAccount: false
    };
  }

  markLoginFailure(accountId: number, reason: string) {
    this.database.db
      .update(accountsTable)
      .set({
        status: 'error',
        lastErrorReason: reason
      })
      .where(eq(accountsTable.id, accountId))
      .run();
  }

  markLoginHealthy(accountId: number, input: MarkLoginHealthyInput) {
    this.database.db
      .update(accountsTable)
      .set({
        status: 'healthy',
        lastErrorReason: null,
        lastCheckedAt: input.checkedAt,
        currentUrl: input.currentUrl ?? undefined,
        mode: input.mode ?? undefined
      })
      .where(eq(accountsTable.id, accountId))
      .run();
  }

  markAccountError(accountId: number, reason: string) {
    this.database.db
      .update(accountsTable)
      .set({
        status: 'error',
        lastErrorReason: reason
      })
      .where(eq(accountsTable.id, accountId))
      .run();
  }

  markAccountHealthy(accountId: number, input: MarkAccountHealthyInput) {
    this.database.db
      .update(accountsTable)
      .set({
        status: 'healthy',
        lastErrorReason: null,
        lastCheckedAt: input.checkedAt
      })
      .where(eq(accountsTable.id, accountId))
      .run();
  }
}
