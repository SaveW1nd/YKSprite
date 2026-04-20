import { eq } from 'drizzle-orm';
import type { DatabaseClient } from '../db/client.js';
import { apiProviderConfigsTable, schemaMetaTable } from '../db/schema.js';
import type { ApiProvider, ApiProviderConfigInput, ApiProviderConfigRecord } from './api-config-types.js';

export class ApiConfigRepository {
  constructor(private readonly database: DatabaseClient) {}

  getProviderConfig(provider: ApiProvider): ApiProviderConfigRecord | null {
    const row = this.database.db
      .select()
      .from(apiProviderConfigsTable)
      .where(eq(apiProviderConfigsTable.provider, provider))
      .get();

    if (!row) {
      return null;
    }

    return {
      provider: row.provider as ApiProvider,
      enabled: row.enabled,
      apiKey: row.apiKey,
      baseUrl: row.baseUrl,
      model: row.model,
      updatedAt: row.updatedAt
    };
  }

  saveProviderConfig(provider: ApiProvider, input: ApiProviderConfigInput) {
    const updatedAt = new Date().toISOString();
    this.database.db
      .insert(apiProviderConfigsTable)
      .values({
        provider,
        enabled: input.enabled,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        updatedAt
      })
      .onConflictDoUpdate({
        target: apiProviderConfigsTable.provider,
        set: {
          enabled: input.enabled,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
          updatedAt
        }
      })
      .run();
  }

  getSchemaMeta(key: string) {
    return this.database.db
      .select()
      .from(schemaMetaTable)
      .where(eq(schemaMetaTable.key, key))
      .get() ?? null;
  }

  setSchemaMeta(key: string, value: string) {
    this.database.db
      .insert(schemaMetaTable)
      .values({ key, value })
      .onConflictDoUpdate({
        target: schemaMetaTable.key,
        set: { value }
      })
      .run();
  }
}
