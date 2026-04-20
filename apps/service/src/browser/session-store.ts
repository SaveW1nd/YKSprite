import type { BrowserCookie } from './browser-controller.js';
import { createDatabaseClient, type DatabaseClient } from '../db/client.js';
import { SessionRepository, type StoredSession as RepositoryStoredSession } from '../db/session-repository.js';

export type StoredSession = {
  cookies: BrowserCookie[];
  savedAt: string;
  origin: string;
  currentUrl?: string | null;
  pageTitle?: string | null;
  mode?: string | null;
};

type SessionStoreOptions = {
  repository?: SessionRepository;
  databaseClient?: DatabaseClient;
};

export class SessionStore {
  private readonly databaseClient: DatabaseClient | null;
  private readonly repository: SessionRepository;

  constructor(options: SessionStoreOptions = {}) {
    this.databaseClient = options.databaseClient ?? (options.repository ? null : createDatabaseClient());
    this.repository = options.repository ?? new SessionRepository(this.databaseClient!);
  }

  async load(): Promise<StoredSession | null> {
    const active = this.repository.getActive();
    if (!active) {
      return null;
    }

    return active;
  }

  async save(session: StoredSession): Promise<StoredSession> {
    const persisted: RepositoryStoredSession = {
      cookies: session.cookies,
      savedAt: session.savedAt,
      origin: session.origin,
      currentUrl: session.currentUrl ?? null,
      pageTitle: session.pageTitle ?? null,
      mode: session.mode ?? null
    };
    this.repository.saveActive(persisted);
    return persisted;
  }
}
