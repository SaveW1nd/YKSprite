# API Management Config Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real API management center that can read and update provider configuration for `qwen_vl` and `openai`, persist settings in the local SQLite database, and expose a full React admin page instead of the current placeholder.

**Architecture:** Add a small backend configuration layer that persists provider settings in SQLite as the only source of truth for AI provider configuration, and expose typed Fastify routes for read/write operations. Replace the placeholder `ApiPage` with a data-driven React management console that loads the configuration snapshot, lets the operator update provider settings and the default vision provider, and surfaces missing-key alerts and source-of-truth status while removing the old env-based configuration path.

**Tech Stack:** Fastify, better-sqlite3 + drizzle schema definitions, React 19, Vite, Vitest, existing `usePageMetrics` shell, existing `/api/*` frontend fetch layer.

---

### Task 1: Add persistent API configuration storage as the single source of truth

**Files:**
- Create: `apps/service/src/api-config/api-config-types.ts`
- Create: `apps/service/src/api-config/api-config-repository.ts`
- Create: `apps/service/src/api-config/api-config-service.ts`
- Modify: `apps/service/src/db/schema.ts`
- Modify: `apps/service/src/db/client.ts`
- Test: `tests/service/api-config-service.test.ts`

- [ ] **Step 1: Write the failing service test for config persistence and DB-only snapshot projection**

```ts
import { describe, expect, it } from 'vitest';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { ApiConfigRepository } from '../../apps/service/src/api-config/api-config-repository';
import { ApiConfigService } from '../../apps/service/src/api-config/api-config-service';

describe('ApiConfigService', () => {
  it('persists qwen config and projects it into the runtime snapshot', () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const repository = new ApiConfigRepository(databaseClient);
    const service = new ApiConfigService(repository);

    service.updateProviderConfig('qwen_vl', {
      enabled: true,
      apiKey: 'qwen-test-key',
      baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
      model: 'qwen-vl-max'
    });

    service.setDefaultVisionProvider('qwen_vl');
    const snapshot = service.getSnapshot();

    expect(snapshot.defaultVisionProvider).toBe('qwen_vl');
    expect(snapshot.providers.qwen_vl.hasApiKey).toBe(true);
    expect(snapshot.providers.qwen_vl.apiKeyMasked).toBe('qwen-tes••••');
    expect(snapshot.providers.qwen_vl.source).toBe('database');
  });
});
```

- [ ] **Step 2: Run the test to confirm the backend config layer does not exist yet**

Run: `pnpm exec vitest tests/service/api-config-service.test.ts --run`

Expected: FAIL with module-not-found errors for `api-config-repository` / `api-config-service`, or missing symbol errors for `getSnapshot` and `updateProviderConfig`.

- [ ] **Step 3: Extend the schema and migrations with an `api_provider_configs` table**

```ts
export const apiProviderConfigsTable = sqliteTable('api_provider_configs', {
  provider: text('provider').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  apiKey: text('api_key'),
  baseUrl: text('base_url'),
  model: text('model'),
  updatedAt: text('updated_at').notNull()
});
```

```ts
CREATE TABLE IF NOT EXISTS api_provider_configs (
  provider TEXT PRIMARY KEY NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  api_key TEXT,
  base_url TEXT,
  model TEXT,
  updated_at TEXT NOT NULL
);
```

- [ ] **Step 4: Add typed config repository methods**

```ts
export class ApiConfigRepository {
  constructor(private readonly database: DatabaseClient) {}

  getProviderConfig(provider: 'qwen_vl' | 'openai') {
    return this.database.db
      .select()
      .from(apiProviderConfigsTable)
      .where(eq(apiProviderConfigsTable.provider, provider))
      .get() ?? null;
  }

  saveProviderConfig(provider: 'qwen_vl' | 'openai', input: {
    enabled: boolean;
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
  }) {
    this.database.db
      .insert(apiProviderConfigsTable)
      .values({
        provider,
        enabled: input.enabled,
        apiKey: input.apiKey,
        baseUrl: input.baseUrl,
        model: input.model,
        updatedAt: new Date().toISOString()
      })
      .onConflictDoUpdate({
        target: apiProviderConfigsTable.provider,
        set: {
          enabled: input.enabled,
          apiKey: input.apiKey,
          baseUrl: input.baseUrl,
          model: input.model,
          updatedAt: new Date().toISOString()
        }
      })
      .run();
  }

  getSchemaMeta(key: string) {
    return this.database.db.select().from(schemaMetaTable).where(eq(schemaMetaTable.key, key)).get() ?? null;
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
```

- [ ] **Step 5: Add a service that reads and writes only database-backed config**

```ts
export class ApiConfigService {
  constructor(private readonly repository: ApiConfigRepository) {}

  getSnapshot() {
    const defaultVisionProvider = this.repository.getSchemaMeta('vision_default_provider')?.value ?? 'qwen_vl';

    return {
      defaultVisionProvider,
      providers: {
        qwen_vl: this.buildProviderSnapshot('qwen_vl'),
        openai: this.buildProviderSnapshot('openai')
      }
    };
  }

  updateProviderConfig(provider: 'qwen_vl' | 'openai', input: {
    enabled: boolean;
    apiKey: string | null;
    baseUrl: string | null;
    model: string | null;
  }) {
    this.repository.saveProviderConfig(provider, input);
    return this.getSnapshot();
  }

  setDefaultVisionProvider(provider: 'qwen_vl' | 'openai') {
    this.repository.setSchemaMeta('vision_default_provider', provider);
    return this.getSnapshot();
  }
}
```

- [ ] **Step 6: Re-run the service test and confirm the config snapshot now passes**

Run: `pnpm exec vitest tests/service/api-config-service.test.ts --run`

Expected: PASS with one test covering persisted provider settings and projected snapshot values.

- [ ] **Step 7: Commit the persistence layer**

```bash
git add apps/service/src/db/schema.ts apps/service/src/db/client.ts apps/service/src/api-config/api-config-types.ts apps/service/src/api-config/api-config-repository.ts apps/service/src/api-config/api-config-service.ts tests/service/api-config-service.test.ts
git commit -m "feat: add persistent api config service"
```

### Task 1.5: Remove legacy env-based API config inputs from the repo contract

**Files:**
- Modify: `.env.example`
- Modify: `apps/service/src/env-loader.ts`
- Test: `tests/service/env-loader.test.ts`

- [ ] **Step 1: Write the failing env-loader test that AI provider config keys are no longer imported from `.env`**

```ts
import { writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEnvFile } from '../../apps/service/src/env-loader';

describe('loadEnvFile', () => {
  it('ignores legacy ai provider config keys that should now come from the database', () => {
    const envPath = '/tmp/yksprite-api-config.env';
    writeFileSync(
      envPath,
      [
        'VISION_DEFAULT_PROVIDER=openai',
        'QWEN_VL_API_KEY=qwen-test-key',
        'QWEN_VL_MODEL=qwen-vl-max',
        'OPENAI_API_KEY=openai-test-key'
      ].join('\\n'),
      'utf8'
    );

    delete process.env.VISION_DEFAULT_PROVIDER;
    delete process.env.QWEN_VL_API_KEY;
    delete process.env.QWEN_VL_MODEL;
    delete process.env.OPENAI_API_KEY;

    loadEnvFile(envPath);

    expect(process.env.VISION_DEFAULT_PROVIDER).toBeUndefined();
    expect(process.env.QWEN_VL_API_KEY).toBeUndefined();
    expect(process.env.QWEN_VL_MODEL).toBeUndefined();
    expect(process.env.OPENAI_API_KEY).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the env-loader test to confirm legacy AI config keys are still being loaded**

Run: `pnpm exec vitest tests/service/env-loader.test.ts --run`

Expected: FAIL because `loadEnvFile()` still imports `VISION_DEFAULT_PROVIDER`, `QWEN_VL_*`, and `OPENAI_*` from env files.

- [ ] **Step 3: Update `.env.example` so it no longer advertises AI provider config keys**

```env
# AI provider configuration is now managed from the admin UI and stored in SQLite.
# Keep this file for non-secret local process settings only.
```

- [ ] **Step 4: Update `loadEnvFile()` to ignore legacy AI config keys**

```ts
const BLOCKED_ENV_KEYS = new Set([
  'VISION_DEFAULT_PROVIDER',
  'QWEN_VL_API_KEY',
  'QWEN_VL_BASE_URL',
  'QWEN_VL_MODEL',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_MODEL'
]);

if (!key || process.env[key] !== undefined || BLOCKED_ENV_KEYS.has(key)) {
  continue;
}
```

- [ ] **Step 5: Re-run the env-loader test and confirm legacy AI config keys are ignored**

Run: `pnpm exec vitest tests/service/env-loader.test.ts --run`

Expected: PASS with AI provider keys ignored from `.env` files.

- [ ] **Step 6: Commit the env cleanup**

```bash
git add .env.example apps/service/src/env-loader.ts tests/service/env-loader.test.ts
git commit -m "refactor: remove legacy env based ai config inputs"
```

### Task 2: Expose read/write API configuration routes from the service app

**Files:**
- Create: `apps/service/src/routes/api-config.ts`
- Modify: `apps/service/src/app.ts`
- Test: `tests/service/api-config-routes.test.ts`

- [ ] **Step 1: Write the failing route test for reading and updating provider config**

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';

describe('api-config routes', () => {
  const app = buildServiceApp();

  afterAll(async () => {
    await app.close();
  });

  it('reads and updates the qwen provider config snapshot', async () => {
    const updateResponse = await app.inject({
      method: 'PATCH',
      url: '/api-config/providers/qwen_vl',
      payload: {
        enabled: true,
        apiKey: 'qwen-test-key',
        baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
        model: 'qwen-vl-max'
      }
    });

    expect(updateResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: 'GET',
      url: '/api-config'
    });

    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json()).toMatchObject({
      defaultVisionProvider: 'qwen_vl',
      providers: {
        qwen_vl: {
          hasApiKey: true,
          model: 'qwen-vl-max'
        }
      }
    });
  });
});
```

- [ ] **Step 2: Run the route test to verify `/api-config` is not registered yet**

Run: `pnpm exec vitest tests/service/api-config-routes.test.ts --run`

Expected: FAIL with `404` or route registration errors for `/api-config`.

- [ ] **Step 3: Create the Fastify route module**

```ts
export const registerApiConfigRoutes = (
  app: FastifyInstance,
  apiConfigService: ApiConfigService
) => {
  app.get('/api-config', async () => apiConfigService.getSnapshot());

  app.patch('/api-config/providers/:provider', async (request, reply) => {
    const provider = (request.params as { provider: 'qwen_vl' | 'openai' }).provider;
    const body = request.body as {
      enabled?: boolean;
      apiKey?: string | null;
      baseUrl?: string | null;
      model?: string | null;
    };

    if (provider !== 'qwen_vl' && provider !== 'openai') {
      reply.code(400);
      return { message: 'Unsupported provider' };
    }

    return apiConfigService.updateProviderConfig(provider, {
      enabled: body.enabled ?? true,
      apiKey: body.apiKey?.trim() || null,
      baseUrl: body.baseUrl?.trim() || null,
      model: body.model?.trim() || null
    });
  });

  app.patch('/api-config/default-provider', async (request, reply) => {
    const provider = (request.body as { provider?: 'qwen_vl' | 'openai' }).provider;
    if (provider !== 'qwen_vl' && provider !== 'openai') {
      reply.code(400);
      return { message: 'Unsupported provider' };
    }

    return apiConfigService.setDefaultVisionProvider(provider);
  });
};
```

- [ ] **Step 4: Wire the config service and route registration into `buildServiceApp()`**

```ts
const apiConfigRepository = new ApiConfigRepository(databaseClient);
const apiConfigService = new ApiConfigService(apiConfigRepository);

registerApiConfigRoutes(app, apiConfigService);
```

- [ ] **Step 5: Re-run the route test and verify both GET and PATCH flows**

Run: `pnpm exec vitest tests/service/api-config-routes.test.ts --run`

Expected: PASS with route responses returning a typed config snapshot.

- [ ] **Step 6: Commit the route layer**

```bash
git add apps/service/src/routes/api-config.ts apps/service/src/app.ts tests/service/api-config-routes.test.ts
git commit -m "feat: expose api config routes"
```

### Task 3: Add frontend API client helpers and page-level test coverage

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/pages/ApiPage.test.tsx`
- Modify: `apps/web/src/App.test.tsx`

- [ ] **Step 1: Write the failing React test for loading and editing API config**

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiPage } from './ApiPage';

const fetchApiConfigMock = vi.fn();
const updateApiProviderConfigMock = vi.fn();
const updateDefaultVisionProviderMock = vi.fn();

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchApiConfig: () => fetchApiConfigMock(),
    updateApiProviderConfig: (...args: Parameters<typeof actual.updateApiProviderConfig>) =>
      updateApiProviderConfigMock(...args as never),
    updateDefaultVisionProvider: (...args: Parameters<typeof actual.updateDefaultVisionProvider>) =>
      updateDefaultVisionProviderMock(...args as never)
  };
});

describe('ApiPage', () => {
  it('loads qwen status and saves provider updates', async () => {
    fetchApiConfigMock.mockResolvedValue({
      defaultVisionProvider: 'qwen_vl',
      providers: {
        qwen_vl: {
          provider: 'qwen_vl',
          label: 'Qwen VL',
          enabled: true,
          hasApiKey: false,
          apiKeyMasked: null,
          baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
          model: 'qwen-vl-max',
          source: 'database',
          lastError: 'api key未配置，无法调用 AI 解题'
        },
        openai: {
          provider: 'openai',
          label: 'OpenAI',
          enabled: false,
          hasApiKey: false,
          apiKeyMasked: null,
          baseUrl: null,
          model: null,
          source: 'unset',
          lastError: null
        }
      }
    });

    render(<ApiPage />);

    expect(await screen.findByText('Qwen VL')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Qwen 模型'), { target: { value: 'qwen-vl-plus' } });
    fireEvent.click(screen.getByRole('button', { name: '保存 Qwen 配置' }));

    await waitFor(() => {
      expect(updateApiProviderConfigMock).toHaveBeenCalledWith('qwen_vl', expect.objectContaining({
        model: 'qwen-vl-plus'
      }));
    });
  });
});
```

- [ ] **Step 2: Run the page test to verify the frontend client helpers do not exist yet**

Run: `pnpm exec vitest apps/web/src/pages/ApiPage.test.tsx --run`

Expected: FAIL with missing `fetchApiConfig` / `updateApiProviderConfig` exports or placeholder-page assertions.

- [ ] **Step 3: Add typed frontend API helpers**

```ts
export type ApiProviderConfigSnapshot = {
  provider: 'qwen_vl' | 'openai';
  label: string;
  enabled: boolean;
  hasApiKey: boolean;
  apiKeyMasked: string | null;
  baseUrl: string | null;
  model: string | null;
  source: 'database' | 'unset';
  lastError: string | null;
};

export type ApiConfigSnapshot = {
  defaultVisionProvider: 'qwen_vl' | 'openai';
  providers: Record<'qwen_vl' | 'openai', ApiProviderConfigSnapshot>;
};

export const fetchApiConfig = async (): Promise<ApiConfigSnapshot> => {
  const response = await fetch('/api/api-config');
  if (!response.ok) throw new Error(`Failed to fetch api config: ${response.status}`);
  return response.json() as Promise<ApiConfigSnapshot>;
};

export const updateApiProviderConfig = async (
  provider: 'qwen_vl' | 'openai',
  payload: { enabled: boolean; apiKey: string | null; baseUrl: string | null; model: string | null }
) => {
  const response = await fetch(`/api/api-config/providers/${provider}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`Failed to update api provider config: ${response.status}`);
  return response.json() as Promise<ApiConfigSnapshot>;
};
```

- [ ] **Step 4: Update app-shell tests so `/api` expects a real page instead of a placeholder**

```tsx
window.history.pushState({}, '', '/api');
render(<App />);

expect(await screen.findByRole('heading', { name: 'API 管理中心' })).toBeInTheDocument();
expect(screen.getByText('默认视觉提供商')).toBeInTheDocument();
```

- [ ] **Step 5: Re-run the frontend tests and confirm the data layer is ready for the page rewrite**

Run: `pnpm exec vitest apps/web/src/pages/ApiPage.test.tsx apps/web/src/App.test.tsx --run`

Expected: FAIL only on missing page UI details, not on missing API client exports.

- [ ] **Step 6: Commit the frontend client layer**

```bash
git add apps/web/src/lib/api.ts apps/web/src/pages/ApiPage.test.tsx apps/web/src/App.test.tsx
git commit -m "feat: add api config client contracts"
```

### Task 4: Replace the placeholder with a real API management console

**Files:**
- Modify: `apps/web/src/pages/ApiPage.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `apps/web/src/pages/PlaceholderPage.tsx`
- Test: `apps/web/src/pages/ApiPage.test.tsx`

- [ ] **Step 1: Replace the placeholder test expectations with the final management-console layout**

```tsx
expect(await screen.findByRole('heading', { name: 'API 管理中心' })).toBeInTheDocument();
expect(screen.getByText('默认视觉提供商')).toBeInTheDocument();
expect(screen.getByText('Qwen VL')).toBeInTheDocument();
expect(screen.getByText('OpenAI')).toBeInTheDocument();
expect(screen.getByText('api key未配置，无法调用 AI 解题')).toBeInTheDocument();
```

- [ ] **Step 2: Build the page state and data-loading flow**

```tsx
export function ApiPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [snapshot, setSnapshot] = React.useState<ApiConfigSnapshot | null>(null);
  const [isSaving, setIsSaving] = React.useState<null | 'qwen_vl' | 'openai' | 'default'>(null);
  const [formState, setFormState] = React.useState({
    qwen_vl: { enabled: true, apiKey: '', baseUrl: '', model: '' },
    openai: { enabled: false, apiKey: '', baseUrl: '', model: '' }
  });

  const load = React.useCallback(async () => {
    const nextSnapshot = await fetchApiConfig();
    setSnapshot(nextSnapshot);
    setFormState({
      qwen_vl: {
        enabled: nextSnapshot.providers.qwen_vl.enabled,
        apiKey: '',
        baseUrl: nextSnapshot.providers.qwen_vl.baseUrl ?? '',
        model: nextSnapshot.providers.qwen_vl.model ?? ''
      },
      openai: {
        enabled: nextSnapshot.providers.openai.enabled,
        apiKey: '',
        baseUrl: nextSnapshot.providers.openai.baseUrl ?? '',
        model: nextSnapshot.providers.openai.model ?? ''
      }
    });
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);
}
```

- [ ] **Step 3: Add page sections that fit the existing admin shell**

```tsx
<div className="content-stack">
  <section className="section-card">
    <header className="section-header">
      <div>
        <h2>API 管理中心</h2>
        <p>维护视觉模型提供商、默认路由策略和当前告警状态。</p>
      </div>
    </header>
    <div className="api-overview-grid">
      <article className="glass-card api-overview-card">
        <span>默认视觉提供商</span>
        <strong>{snapshot?.defaultVisionProvider === 'qwen_vl' ? 'Qwen VL' : 'OpenAI'}</strong>
      </article>
      <article className="glass-card api-overview-card">
        <span>已配置提供商</span>
        <strong>{configuredProviderCount}</strong>
      </article>
      <article className="glass-card api-overview-card">
        <span>缺失密钥告警</span>
        <strong>{missingKeyAlertCount}</strong>
      </article>
    </div>
  </section>

  <section className="dual-panels api-provider-grid">
    {providerCards}
  </section>
</div>
```

- [ ] **Step 4: Add editable provider cards with save actions**

```tsx
<article className="glass-card panel-card" key={provider.provider}>
  <header className="panel-card-header">
    <div>
      <h3>{provider.label}</h3>
      <p>{provider.source === 'database' ? '数据库配置' : '未配置'}</p>
    </div>
    <span className={provider.hasApiKey ? 'status-badge status-badge-healthy' : 'status-badge status-badge-error'}>
      {provider.hasApiKey ? '可用' : '缺失密钥'}
    </span>
  </header>

  <label className="form-field">
    <span>{provider.provider === 'qwen_vl' ? 'Qwen 模型' : 'OpenAI 模型'}</span>
    <input value={formState[provider.provider].model} onChange={...} />
  </label>

  <label className="form-field">
    <span>API Key</span>
    <input type="password" placeholder={provider.apiKeyMasked ?? '未配置'} value={formState[provider.provider].apiKey} onChange={...} />
  </label>

  <button type="button" className="toolbar-button toolbar-button-primary" onClick={() => void saveProvider(provider.provider)}>
    {isSaving === provider.provider ? '保存中' : `保存 ${provider.label} 配置`}
  </button>
</article>
```

- [ ] **Step 5: Add CSS for the API console instead of reusing the placeholder layout**

```css
.api-overview-grid,
.api-provider-grid {
  display: grid;
  gap: 18px;
}

.api-overview-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.api-provider-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.api-overview-card,
.api-provider-card {
  padding: 20px;
}

.form-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.form-field input {
  min-height: 40px;
  border-radius: 12px;
  border: 1px solid var(--shell-border);
  padding: 0 12px;
  background: rgba(255, 255, 255, 0.9);
}
```

- [ ] **Step 6: Run the page and app tests until the real API console passes**

Run: `pnpm exec vitest apps/web/src/pages/ApiPage.test.tsx apps/web/src/App.test.tsx --run`

Expected: PASS with `/api` rendering a real management page and save actions invoking the right client helpers.

- [ ] **Step 7: Commit the UI rewrite**

```bash
git add apps/web/src/pages/ApiPage.tsx apps/web/src/styles.css apps/web/src/pages/PlaceholderPage.tsx apps/web/src/pages/ApiPage.test.tsx apps/web/src/App.test.tsx
git commit -m "feat: replace api placeholder with config center"
```

### Task 5: Full-stack regression, AI config consumer rewiring, and final polish

**Files:**
- Modify: `apps/service/src/app.ts`
- Modify: `apps/service/src/assist/vision-analysis-service.ts`
- Modify: `apps/web/src/pages/ApiPage.tsx`
- Test: `tests/service/api-config-service.test.ts`
- Test: `tests/service/api-config-routes.test.ts`
- Test: `apps/web/src/pages/ApiPage.test.tsx`

- [ ] **Step 1: Ensure service bootstrap wires the DB-backed config service before any AI request path starts**

```ts
const apiConfigService = new ApiConfigService(apiConfigRepository);

const visionAnalysisService =
  options.visionAnalysisService ??
  new VisionAnalysisService(assistRepository, undefined, debugTraceStore);
```

- [ ] **Step 2: Add a regression assertion that the default provider and credentials come from the saved database config**

```ts
it('uses the saved default provider and provider credentials from the database snapshot', () => {
  const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
  const repository = new ApiConfigRepository(databaseClient);
  const service = new ApiConfigService(repository);

  service.updateProviderConfig('qwen_vl', {
    enabled: true,
    apiKey: 'qwen-test-key',
    baseUrl: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen-vl-max'
  });
  service.setDefaultVisionProvider('qwen_vl');

  expect(service.getSnapshot().defaultVisionProvider).toBe('qwen_vl');
  expect(service.getSnapshot().providers.qwen_vl.hasApiKey).toBe(true);
});
```

- [ ] **Step 3: Run the complete verification set**

Run: `pnpm exec vitest tests/service apps/web/src/pages/ApiPage.test.tsx --run`

Expected: PASS for the new backend config layer, route coverage, and page-level UI tests.

Run: `pnpm exec tsc -p apps/service/tsconfig.json --noEmit`

Expected: PASS with no service type errors.

Run: `pnpm --filter @yksprite/service build`

Expected: PASS with updated route registration and config service compiling into `dist/`.

- [ ] **Step 4: Manually verify the page in the browser**

Run:

```bash
pnpm --filter @yksprite/service start
pnpm --filter @yksprite/web dev
```

Expected manual checks:
- `/api` shows `API 管理中心`, not the placeholder blocks.
- Switching the default provider updates the summary card immediately after save.
- Saving a Qwen API key clears the `api key未配置，无法调用 AI 解题` alert after reload.
- Leaving a provider with no key shows an error badge and visible alert text.
- `.env.example` no longer contains `VISION_DEFAULT_PROVIDER`, `QWEN_VL_*`, or `OPENAI_*` entries.

- [ ] **Step 5: Commit the final integration pass**

```bash
git add apps/service/src/app.ts apps/service/src/assist/vision-analysis-service.ts apps/web/src/pages/ApiPage.tsx tests/service/api-config-service.test.ts tests/service/api-config-routes.test.ts apps/web/src/pages/ApiPage.test.tsx
git commit -m "feat: wire api management config center end to end"
```

---

## Notes

- This plan removes the old env-based AI config path instead of preserving compatibility. SQLite-backed provider config becomes the only supported source for `qwen_vl`, `openai`, and `defaultVisionProvider`.
- The repository currently only contains `.env.example`, not a live `.env`; this phase should still remove the legacy AI config entries from `.env.example` and block future `.env` imports for these keys.
- This plan assumes local SQLite storage of API keys in the same trust model already used for saved browser sessions and cookies. If encrypted-at-rest storage or OS keychain integration is required, that should be a separate follow-up plan.
- Keep the UI scoped to two providers (`qwen_vl`, `openai`) and one global setting (`defaultVisionProvider`). Do not expand to arbitrary provider plugins in this phase.
