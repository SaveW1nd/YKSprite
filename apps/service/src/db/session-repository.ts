import { desc, eq } from 'drizzle-orm';
import type { BrowserCookie } from '../browser/browser-controller.js';
import type { DatabaseClient } from './client.js';
import { sessionsTable } from './schema.js';

export type StoredSession = {
  cookies: BrowserCookie[];
  savedAt: string;
  origin: string;
  currentUrl: string | null;
  pageTitle: string | null;
  mode: string | null;
};

export class SessionRepository {
  constructor(private readonly database: DatabaseClient) {}

  getActive() {
    const row = this.database.db.select().from(sessionsTable).where(eq(sessionsTable.isActive, true)).all()[0];
    if (!row) {
      return null;
    }

    return {
      cookies: JSON.parse(row.cookiesJson) as BrowserCookie[],
      savedAt: row.savedAt,
      origin: row.origin,
      currentUrl: row.currentUrl,
      pageTitle: row.pageTitle,
      mode: row.mode
    } satisfies StoredSession;
  }

  list() {
    return this.database.db.select().from(sessionsTable).orderBy(desc(sessionsTable.savedAt)).all();
  }

  saveActive(input: StoredSession) {
    this.database.db.update(sessionsTable).set({ isActive: false }).run();
    this.database.db.insert(sessionsTable).values({
      source: 'browser-session',
      origin: input.origin,
      cookiesJson: JSON.stringify(input.cookies),
      cookieCount: input.cookies.length,
      savedAt: input.savedAt,
      currentUrl: input.currentUrl,
      pageTitle: input.pageTitle,
      mode: input.mode,
      isActive: true
    }).run();
  }
}
