import { asc, eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db/client.js';
import { qwenApiKeysTable } from '../db/schema.js';
import type { ApiCheckStatus, QwenApiKeyRecord } from './api-config-types.js';

const mapQwenKeyRow = (row: typeof qwenApiKeysTable.$inferSelect): QwenApiKeyRecord => ({
  id: row.id,
  name: row.name,
  apiKey: row.apiKey,
  isActive: row.isActive,
  lastCheckStatus: row.lastCheckStatus as ApiCheckStatus,
  lastCheckReason: row.lastCheckReason,
  lastCheckedAt: row.lastCheckedAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt
});

export class ApiConfigRepository {
  constructor(private readonly database: DatabaseClient) {}

  listQwenKeys(): QwenApiKeyRecord[] {
    return this.database.db
      .select()
      .from(qwenApiKeysTable)
      .orderBy(asc(qwenApiKeysTable.id))
      .all()
      .map(mapQwenKeyRow);
  }

  createQwenKey(input: {
    name: string;
    apiKey: string;
    isActive: boolean;
    lastCheckStatus: ApiCheckStatus;
    lastCheckReason: string | null;
    lastCheckedAt: string;
  }) {
    const timestamp = new Date().toISOString();
    const result = this.database.db
      .insert(qwenApiKeysTable)
      .values({
        name: input.name,
        apiKey: input.apiKey,
        isActive: input.isActive,
        lastCheckStatus: input.lastCheckStatus,
        lastCheckReason: input.lastCheckReason,
        lastCheckedAt: input.lastCheckedAt,
        createdAt: timestamp,
        updatedAt: timestamp
      })
      .run();

    return Number(result.lastInsertRowid);
  }

  enableQwenKey(id: number) {
    const timestamp = new Date().toISOString();
    this.database.db.update(qwenApiKeysTable).set({ isActive: false, updatedAt: timestamp }).run();
    this.database.db
      .update(qwenApiKeysTable)
      .set({ isActive: true, updatedAt: timestamp })
      .where(eq(qwenApiKeysTable.id, id))
      .run();
  }

  updateQwenKeyCheckResult(
    id: number,
    input: { status: ApiCheckStatus; reason: string | null; checkedAt: string }
  ) {
    this.database.db
      .update(qwenApiKeysTable)
      .set({
        lastCheckStatus: input.status,
        lastCheckReason: input.reason,
        lastCheckedAt: input.checkedAt,
        updatedAt: input.checkedAt
      })
      .where(eq(qwenApiKeysTable.id, id))
      .run();
  }

  deleteQwenKey(id: number) {
    this.database.db.delete(qwenApiKeysTable).where(eq(qwenApiKeysTable.id, id)).run();
  }

  getQwenKey(id: number): QwenApiKeyRecord | null {
    const row = this.database.db
      .select()
      .from(qwenApiKeysTable)
      .where(eq(qwenApiKeysTable.id, id))
      .get();

    if (!row) {
      return null;
    }

    return mapQwenKeyRow(row);
  }

  getActiveQwenKey(): QwenApiKeyRecord | null {
    const row = this.database.db
      .select()
      .from(qwenApiKeysTable)
      .where(eq(qwenApiKeysTable.isActive, true))
      .get();

    if (!row) {
      return null;
    }

    return mapQwenKeyRow(row);
  }
}
