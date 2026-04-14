# YKSprite Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable YKSprite foundation: a TypeScript monorepo with a shared core, a Fastify service, a React web shell, an Electron desktop shell that can be packaged as a Windows EXE, and a Docker image that runs the same service stack.

**Architecture:** YKSprite uses one shared TypeScript workspace so desktop and Docker do not diverge. `apps/service` owns the HTTP API and future automation orchestration, `apps/web` owns the UI, and `apps/desktop` wraps the same web UI plus local service bootstrap inside Electron. Shared logic lives in `packages/contracts` and `packages/core`, which is also the landing zone for code extracted from the current userscript repository.

**Tech Stack:** TypeScript, pnpm workspaces, React, Vite, Fastify, Zod, Electron, electron-builder, Vitest, Testing Library, Docker, GitHub Actions

---

## Scope Check

This product will eventually contain multiple subsystems:

1. Platform foundation
2. Yuketang browser/runtime adapter
3. AI provider integration and prompt orchestration
4. Login/session automation
5. Task execution and monitoring

This plan intentionally covers only subsystem 1 plus the extraction seam for subsystem 2. That keeps the first implementation slice runnable and testable on its own.

## Decision Summary

- Use `pnpm` workspaces instead of a single package. This keeps shared code in one place and lets desktop, web, and service ship independently.
- Use `Electron` instead of `Tauri`. The existing codebase is JavaScript-heavy, and Electron keeps migration cost low while still producing a Windows EXE.
- Use `Fastify` instead of `Express` or `NestJS`. We only need a small, typed API surface right now; Fastify stays light and fast.
- Use `React + Vite` for the main UI. The same frontend can be served in Docker and embedded in Electron.
- Keep persistence minimal in milestone 1. Use environment variables plus a local `data/` directory contract; do not introduce a database until session/history requirements are stable.
- Do not migrate userscript interceptors directly. The current `xhr` / `fetch` / `ws` interceptors and DOM toolbar are tightly coupled to Tampermonkey and page injection. Reuse prompt formatting, answer parsing, and domain typing ideas first.

## File Structure

```text
YKSprite/
├── package.json                        # root scripts and workspace metadata
├── pnpm-workspace.yaml                 # workspace membership
├── tsconfig.base.json                  # shared TypeScript compiler settings
├── vitest.config.ts                    # root test runner config
├── .gitignore
├── README.md                           # product overview and local commands
├── apps/
│   ├── service/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── src/app.ts                  # Fastify app factory
│   │   ├── src/index.ts                # server entrypoint
│   │   └── src/routes/health.ts        # health and metadata routes
│   ├── web/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx                 # dashboard shell
│   │       └── lib/api.ts              # service API client
│   └── desktop/
│       ├── package.json
│       ├── tsconfig.json
│       ├── electron.vite.config.ts
│       ├── electron-builder.yml
│       └── src/
│           ├── main.ts                 # Electron main process
│           └── preload.ts              # safe window bridge
├── packages/
│   ├── contracts/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/index.ts                # shared schemas and DTOs
│   └── core/
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts
│           ├── problem.ts              # domain model
│           ├── prompt.ts               # prompt formatter
│           └── answer-parser.ts        # answer parsing migrated from userscript
├── tests/
│   ├── core/prompt.test.ts
│   ├── service/health.test.ts
│   └── web/app.test.tsx
├── docker/
│   ├── Dockerfile
│   └── docker-compose.yml
├── .github/workflows/ci.yml
└── docs/dev/checklist.md               # local quality gates
```

## Development Workflow

1. Create one branch per task from `main`.
2. Start with the listed failing test or smoke command.
3. Make the smallest change that turns the task green.
4. Run the exact local verification commands before commit.
5. Commit once the task is green and the workspace still builds.

Required local commands after every task:

```bash
pnpm lint
pnpm test
pnpm build
```

Commands required before shipping a desktop artifact:

```bash
pnpm package:desktop
pnpm docker:build
pnpm docker:smoke
```

## Migration Notes From `yuketang-helper-auto`

Safe to extract early:

- Prompt formatting ideas from `ykt-helper/src/tsm/ai-format.js`
- Answer parsing rules from `ykt-helper/src/tsm/ai-format.js`
- AI profile selection concepts from `ykt-helper/src/ai/openai.js`

Do not extract directly in milestone 1:

- `ykt-helper/src/net/*.js`
- `ykt-helper/src/ui/*.js`
- `ykt-helper/src/index.js`
- `GM_*` or `localStorage`-bound runtime code

The first milestone creates clean seams so later milestones can port logic into `packages/core` and a future `packages/yuketang-runtime`.

### Task 1: Bootstrap The Workspace

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `README.md`

- [ ] **Step 1: Write the failing workspace smoke expectation**

Create `README.md` with the command contract below so every later task targets the same scripts:

```md
# YKSprite

## Commands

- `pnpm install`
- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm package:desktop`
- `pnpm docker:build`
- `pnpm docker:smoke`
```

- [ ] **Step 2: Run the workspace command to verify it fails**

Run: `pnpm build`
Expected: FAIL with `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` or an equivalent message that no `package.json` exists.

- [ ] **Step 3: Write the minimal root workspace files**

`package.json`

```json
{
  "name": "yksprite",
  "private": true,
  "packageManager": "pnpm@10.8.0",
  "scripts": {
    "lint": "pnpm -r --if-present lint",
    "test": "vitest run",
    "build": "pnpm -r --if-present build",
    "package:desktop": "pnpm --filter @yksprite/desktop package",
    "docker:build": "docker build -f docker/Dockerfile -t yksprite:dev .",
    "docker:smoke": "docker run --rm -p 3000:3000 yksprite:dev"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.3.0",
    "jsdom": "^26.1.0",
    "typescript": "^5.8.3",
    "vitest": "^3.1.2"
  }
}
```

`pnpm-workspace.yaml`

```yaml
packages:
  - apps/*
  - packages/*
```

`tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

`vitest.config.ts`

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  }
});
```

`.gitignore`

```gitignore
node_modules
dist
coverage
.turbo
.DS_Store
out
release
data
```

- [ ] **Step 4: Run the workspace command to verify the root importer is recognized**

Run: `pnpm build`
Expected: PASS or complete without workspace package output, which confirms the root workspace and command surface are now recognized.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .gitignore README.md
git commit -m "chore: initialize yksprite workspace"
```

### Task 2: Create Shared Contracts And Core Parsing Logic

**Files:**
- Create: `packages/contracts/package.json`
- Create: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/src/index.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/src/problem.ts`
- Create: `packages/core/src/prompt.ts`
- Create: `packages/core/src/answer-parser.ts`
- Test: `tests/core/prompt.test.ts`

- [ ] **Step 1: Write the failing core tests**

`tests/core/prompt.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { formatProblemPrompt, parseAnswerLetters } from '@yksprite/core';

describe('core prompt utilities', () => {
  it('formats a single-choice prompt with options', () => {
    const prompt = formatProblemPrompt({
      id: 'p1',
      type: 'single_choice',
      body: '2 + 2 = ?',
      options: [
        { key: 'A', value: '3' },
        { key: 'B', value: '4' }
      ]
    });

    expect(prompt).toContain('2 + 2 = ?');
    expect(prompt).toContain('A. 3');
    expect(prompt).toContain('B. 4');
  });

  it('parses multiple answer letters from a response', () => {
    expect(parseAnswerLetters('答案: A、C')).toEqual(['A', 'C']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- --run tests/core/prompt.test.ts`
Expected: FAIL because `@yksprite/core` does not exist yet.

- [ ] **Step 3: Write the minimal shared package implementation**

`packages/contracts/src/index.ts`

```ts
import { z } from 'zod';

export const problemOptionSchema = z.object({
  key: z.string(),
  value: z.string()
});

export const problemSchema = z.object({
  id: z.string(),
  type: z.enum(['single_choice', 'multiple_choice', 'fill_in', 'subjective']),
  body: z.string(),
  options: z.array(problemOptionSchema).default([])
});

export type Problem = z.infer<typeof problemSchema>;
```

`packages/contracts/package.json`

```json
{
  "name": "@yksprite/contracts",
  "version": "0.1.0",
  "type": "module",
  "exports": "./src/index.ts",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "zod": "^3.24.2"
  }
}
```

`packages/contracts/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

`packages/core/src/problem.ts`

```ts
export type Problem = {
  id: string;
  type: 'single_choice' | 'multiple_choice' | 'fill_in' | 'subjective';
  body: string;
  options?: Array<{ key: string; value: string }>;
};
```

`packages/core/src/prompt.ts`

```ts
import type { Problem } from './problem';

export function formatProblemPrompt(problem: Problem): string {
  const optionLines = (problem.options ?? []).map((option) => `${option.key}. ${option.value}`);
  return [
    `Question: ${problem.body}`,
    optionLines.length ? 'Options:' : '',
    ...optionLines
  ]
    .filter(Boolean)
    .join('\n');
}
```

`packages/core/src/answer-parser.ts`

```ts
export function parseAnswerLetters(input: string): string[] {
  const matches = input.match(/[A-Z]/g) ?? [];
  return [...new Set(matches)];
}
```

`packages/core/src/index.ts`

```ts
export * from './problem';
export * from './prompt';
export * from './answer-parser';
```

`packages/core/package.json`

```json
{
  "name": "@yksprite/core",
  "version": "0.1.0",
  "type": "module",
  "exports": "./src/index.ts",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@yksprite/contracts": "workspace:*"
  }
}
```

`packages/core/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- --run tests/core/prompt.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
git add packages/contracts packages/core tests/core/prompt.test.ts
git commit -m "feat: add shared contracts and core parser utilities"
```

### Task 3: Build The Fastify Service Shell

**Files:**
- Create: `apps/service/package.json`
- Create: `apps/service/tsconfig.json`
- Create: `apps/service/src/routes/health.ts`
- Create: `apps/service/src/app.ts`
- Create: `apps/service/src/index.ts`
- Test: `tests/service/health.test.ts`

- [ ] **Step 1: Write the failing service health test**

`tests/service/health.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildServiceApp } from '../../apps/service/src/app';

describe('service health route', () => {
  it('returns product metadata', async () => {
    const app = buildServiceApp();
    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      name: 'YKSprite'
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- --run tests/service/health.test.ts`
Expected: FAIL because `apps/service/src/app` does not exist yet.

- [ ] **Step 3: Write the minimal service implementation**

`apps/service/src/routes/health.ts`

```ts
import type { FastifyInstance } from 'fastify';

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get('/health', async () => ({
    status: 'ok',
    name: 'YKSprite'
  }));
}
```

`apps/service/package.json`

```json
{
  "name": "@yksprite/service",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "lint": "tsc --noEmit -p tsconfig.json",
    "start": "node dist/index.js"
  },
  "dependencies": {
    "fastify": "^5.2.1"
  }
}
```

`apps/service/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "declaration": true
  },
  "include": ["src"]
}
```

`apps/service/src/app.ts`

```ts
import Fastify from 'fastify';
import { registerHealthRoutes } from './routes/health';

export function buildServiceApp() {
  const app = Fastify({ logger: true });
  void registerHealthRoutes(app);
  return app;
}
```

`apps/service/src/index.ts`

```ts
import { buildServiceApp } from './app';

const app = buildServiceApp();

app.listen({ host: '0.0.0.0', port: 3000 }).catch((error) => {
  app.log.error(error);
  process.exit(1);
});
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- --run tests/service/health.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/service tests/service/health.test.ts
git commit -m "feat: add service health shell"
```

### Task 4: Build The Web Dashboard Shell

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/src/lib/api.ts`
- Create: `apps/web/src/App.tsx`
- Create: `apps/web/src/main.tsx`
- Test: `tests/web/app.test.tsx`

- [ ] **Step 1: Write the failing web UI test**

`tests/web/app.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { App } from '../../apps/web/src/App';

describe('App', () => {
  it('renders the dashboard title', () => {
    render(<App />);
    expect(screen.getByText('YKSprite Control Center')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test -- --run tests/web/app.test.tsx`
Expected: FAIL because `App` does not exist yet or the React test environment is not configured.

- [ ] **Step 3: Write the minimal web shell**

`apps/web/src/lib/api.ts`

```ts
export async function fetchHealth() {
  const response = await fetch('/health');
  return response.json() as Promise<{ status: string; name: string }>;
}
```

`apps/web/package.json`

```json
{
  "name": "@yksprite/web",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "vite build",
    "lint": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.4.1",
    "vite": "^6.3.2"
  }
}
```

`apps/web/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react-jsx"
  },
  "include": ["src"]
}
```

`apps/web/vite.config.ts`

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()]
});
```

`apps/web/src/App.tsx`

```tsx
export function App() {
  return (
    <main>
      <h1>YKSprite Control Center</h1>
      <p>Desktop and Docker will both use this UI shell.</p>
    </main>
  );
}
```

`apps/web/src/main.tsx`

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test -- --run tests/web/app.test.tsx`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Commit**

```bash
git add apps/web tests/web/app.test.tsx
git commit -m "feat: add web dashboard shell"
```

### Task 5: Add The Electron Desktop Shell And EXE Packaging

**Files:**
- Create: `apps/desktop/package.json`
- Create: `apps/desktop/tsconfig.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/electron-builder.yml`
- Create: `apps/desktop/src/main.ts`
- Create: `apps/desktop/src/preload.ts`

- [ ] **Step 1: Write the failing packaging smoke command**

Record the exact packaging expectation in `README.md`:

```md
## Desktop Packaging

Run `pnpm package:desktop`.
Expected artifact: `apps/desktop/dist-electron/`.
```

- [ ] **Step 2: Run the packaging command to verify it fails**

Run: `pnpm package:desktop`
Expected: FAIL because `@yksprite/desktop` does not exist yet.

- [ ] **Step 3: Write the minimal Electron shell**

`apps/desktop/src/main.ts`

```ts
import { app, BrowserWindow } from 'electron';
import path from 'node:path';

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });

  window.loadURL(process.env.YKSPRITE_WEB_URL ?? 'http://localhost:5173');
}

app.whenReady().then(createWindow);
```

`apps/desktop/package.json`

```json
{
  "name": "@yksprite/desktop",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "build": "electron-vite build",
    "lint": "tsc --noEmit -p tsconfig.json",
    "package": "electron-builder"
  },
  "dependencies": {
    "electron": "^35.1.4"
  },
  "devDependencies": {
    "electron-builder": "^25.1.8",
    "electron-vite": "^3.1.0"
  }
}
```

`apps/desktop/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist"
  },
  "include": ["src"]
}
```

`apps/desktop/electron.vite.config.ts`

```ts
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      outDir: 'dist-electron/main'
    }
  },
  preload: {
    build: {
      outDir: 'dist-electron/preload'
    }
  }
});
```

`apps/desktop/src/preload.ts`

```ts
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('yksprite', {
  version: '0.1.0'
});
```

`apps/desktop/electron-builder.yml`

```yaml
appId: com.yksprite.desktop
productName: YKSprite
directories:
  output: dist-electron
files:
  - dist/**/*
  - dist-electron/**/*
win:
  target:
    - nsis
```

- [ ] **Step 4: Run the packaging command to verify the desktop project resolves**

Run: `pnpm package:desktop`
Expected: FAIL later in the build chain with a missing dependency or bundler configuration message, which confirms the root script now resolves the desktop package and the next task is package wiring rather than discovery.

- [ ] **Step 5: Commit**

```bash
git add apps/desktop README.md
git commit -m "feat: add electron desktop shell"
```

### Task 6: Add Docker Packaging And CI Baseline

**Files:**
- Create: `docker/Dockerfile`
- Create: `docker/docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `docs/dev/checklist.md`

- [ ] **Step 1: Write the failing Docker smoke expectation**

`docs/dev/checklist.md`

```md
# YKSprite Dev Checklist

- `pnpm lint`
- `pnpm test`
- `pnpm build`
- `pnpm package:desktop`
- `pnpm docker:build`
- `pnpm docker:smoke`
```

- [ ] **Step 2: Run the Docker build to verify it fails**

Run: `pnpm docker:build`
Expected: FAIL with `failed to read dockerfile` because `docker/Dockerfile` does not exist yet.

- [ ] **Step 3: Write the minimal Docker and CI configuration**

`docker/Dockerfile`

```Dockerfile
FROM node:22-alpine AS base
WORKDIR /app
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages
RUN corepack enable && pnpm install
RUN pnpm build

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=base /app ./
EXPOSE 3000
CMD ["pnpm", "--filter", "@yksprite/service", "start"]
```

`.github/workflows/ci.yml`

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10.8.0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
      - run: pnpm install
      - run: pnpm lint
      - run: pnpm test
      - run: pnpm build
      - run: pnpm docker:build
```

`docker/docker-compose.yml`

```yaml
services:
  yksprite:
    build:
      context: ..
      dockerfile: docker/Dockerfile
    ports:
      - "3000:3000"
```

- [ ] **Step 4: Run the Docker and CI baseline checks**

Run: `pnpm docker:build`
Expected: PASS through Dockerfile discovery and move on to normal workspace build output.

Run: `pnpm docker:smoke`
Expected: Container starts and exposes port `3000`; stop it after verifying startup.

- [ ] **Step 5: Commit**

```bash
git add docker .github/workflows/ci.yml docs/dev/checklist.md
git commit -m "chore: add docker and ci baseline"
```

## Future Milestones After This Plan

- Milestone 2: Create `packages/yuketang-runtime` with Playwright session bootstrap and browser injection seams.
- Milestone 3: Port prompt/answer logic from the current userscript into `packages/core`.
- Milestone 4: Add AI provider profiles, settings persistence, and session management.
- Milestone 5: Add real classroom automation and monitoring UI.

## Self-Review

Spec coverage:

- Technology stack: covered in `Decision Summary` and the plan header.
- Development flow: covered in `Development Workflow` and `docs/dev/checklist.md`.
- Development tasks: covered in Tasks 1-6.
- Overall framework: covered in `File Structure`, `Decision Summary`, and `Migration Notes`.
- EXE path: covered in Task 5.
- Docker path: covered in Task 6.

Placeholder scan:

- No deferred implementation markers are used inside the executable tasks.
- Future milestones are explicitly marked as out-of-scope roadmap items, not placeholders for this milestone.

Type consistency:

- Shared package names stay consistent as `@yksprite/core` and `@yksprite/desktop`.
- The product name remains `YKSprite`.
- Service route and health response shape are stable across Task 3 and Task 4.
- Root testing and build tools are defined before later tasks depend on them.
