import { asc, eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db/client.js';
import { qwenApiKeysTable } from '../db/schema.js';
import type { QwenApiKeyRecord } from './api-config-types.js';

export class ApiConfigRepository {
  constructor(private readonly database: DatabaseClient) {}

  listQwenKeys(): QwenApiKeyRecord[] {
    return this.database.db
      .select()
      .from(qwenApiKeysTable)
      .orderBy(asc(qwenApiKeysTable.id))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        apiKey: row.apiKey,
        isActive: row.isActive,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      }));
  }

  createQwenKey(input: { name: string; apiKey: string }) {
    const timestamp = new Date().toISOString();
    const result = this.database.db
      .insert(qwenApiKeysTable)
      .values({
        name: input.name,
        apiKey: input.apiKey,
        isActive: this.listQwenKeys().length === 0,
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

    return {
      id: row.id,
      name: row.name,
      apiKey: row.apiKey,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
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

    return {
      id: row.id,
      name: row.name,
      apiKey: row.apiKey,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
