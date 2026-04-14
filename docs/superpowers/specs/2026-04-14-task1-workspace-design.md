# Task 1: Workspace Bootstrapping Design

## Context
- Task 1 in the YKSprite foundation plan is dedicated to giving the repo a real pnpm workspace surface with the minimal root tooling needed so future apps/packages can be added without import errors.
- The user expects package.json, workspace metadata, tsconfig base, vitest config, README, and .gitignore to exist before any other packages are introduced.
- We are maintaining the plan’s red/green discipline by starting with a failing `pnpm build`, adding the files, and verifying the same command succeeds.

## Goals
1. Create a root package.json and pnpm workspace that declare the scripts and workspace membership stated in the plan.
2. Provide shared tooling (tsconfig.base.json, vitest.config.ts) and ignore files so builds/tests/lints run cleanly.
3. Document the canonical command list in README.md so subsequent tasks can rely on those scripts.
4. Verify the workspace command surface fails without the files and passes once they exist.

## Chosen Approach
- We follow Approach 1 from the brainstorming session: implement the files exactly as described in the plan with no extra dependencies or documentation context. This keeps the change minimal, aligned with Task 1, and prevents drift before apps/packages are added.
- The README stays limited to the command list provided (pnpm install, lint, test, build, package:desktop, docker:build, docker:smoke). No additional narrative is needed unless the user indicates otherwise.

## File-level Design
1. `package.json`: private root manifest with `pnpm@10.8.0`, lint/test/build/package:desktop/docker:build/docker:smoke scripts, and the vitest/jsdom devDependencies listed in the plan.
2. `pnpm-workspace.yaml`: includes `apps/*` and `packages/*` so future subprojects are discovered automatically.
3. `tsconfig.base.json`: sets `target` to ES2022, `module` to ESNext, `moduleResolution` to Bundler, and strict/resolution options from the plan so every package can extend it.
4. `vitest.config.ts`: defines the Vitest config with `jsdom` environment and `globals` turned on for test files.
5. `.gitignore`: ignores build artifacts, node_modules, coverage, Turbo cache, and ephemeral files as described.
6. `README.md`: records the command contract with each expected script listed under a Commands section (no extra prose).

## Verification
1. Run `pnpm build` before creating the files to capture the expected `ERR_PNPM_NO_IMPORTER_MANIFEST_FOUND` failure.
2. After the files exist, rerun `pnpm build`. Success (no missing manifest errors) proves the workspace surface is recognized.

## Assumptions
- The command list in README is limited to the six scripts specified. No extra context was supplied, so I will stick to that list unless you ask for expanded documentation.
- Because there was no direct reply to the clarifying question, I am assuming the plan’s README content is still accurate.
