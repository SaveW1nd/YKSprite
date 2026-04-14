# Workspace Bootstrapping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the root pnpm workspace, tooling, and documentation so future apps/packages have a reliable command surface.

**Architecture:** The root workspace relies on a private `package.json` to orchestrate lint/test/build/packaging scripts, a workspace manifest that includes `apps/*` and `packages/*`, and shared tooling (`tsconfig.base.json`, `vitest.config.ts`, `.gitignore`) that every package can extend. README.md captures the expected command contract so every task targets the same scripts.

**Tech Stack:** pnpm workspaces, TypeScript, Vitest, Docker (packaging scripts), Git (docs/README tracking).

---

### Task 1: Capture the root command contract

**Files:**
- Create: `/README.md`

- [ ] **Step 1: Write README with the canonical command list**

```markdown
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

- [ ] **Step 2: Run pnpm build to document the expected failure**

Run: `cd /Users/savewind/Documents/github/YKSprite/.worktrees/foundation-bootstrap && pnpm build`
Expected: FAIL with `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` (or equivalent message complaining about missing `package.json`).

### Task 2: Add the minimal root workspace files

**Files:**
- Create: `/package.json`
- Create: `/pnpm-workspace.yaml`
- Create: `/tsconfig.base.json`
- Create: `/vitest.config.ts`
- Create: `/.gitignore`

- [ ] **Step 1: Verify the failure still happens before adding files**

Run: `cd /Users/savewind/Documents/github/YKSprite/.worktrees/foundation-bootstrap && pnpm build`
Expected: Same `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` error so we confirm the failure is reproducible.

- [ ] **Step 2: Add package.json with root scripts and devDependencies**

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

- [ ] **Step 3: Add pnpm-workspace.yaml listing apps/* and packages/***

```yaml
packages:
  - apps/*
  - packages/*
```

- [ ] **Step 4: Add tsconfig.base.json with shared compiler options**

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

- [ ] **Step 5: Add vitest.config.ts pointing at jsdom/globals**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true
  }
});
```

- [ ] **Step 6: Add .gitignore with build/artifact dirs**

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

- [ ] **Step 7: Re-run pnpm build to confirm success**

Run: `cd /Users/savewind/Documents/github/YKSprite/.worktrees/foundation-bootstrap && pnpm build`
Expected: PASS; the command should complete without the `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` error, proving the root workspace and script surface now exist.

- [ ] **Step 8: Commit the workspace bootstrap**

```bash
cd /Users/savewind/Documents/github/YKSprite/.worktrees/foundation-bootstrap
git add package.json pnpm-workspace.yaml tsconfig.base.json vitest.config.ts .gitignore README.md
git commit -m "chore: initialize yksprite workspace"
```
