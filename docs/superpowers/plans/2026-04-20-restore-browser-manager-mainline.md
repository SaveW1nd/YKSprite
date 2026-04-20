# Restore BrowserManager Mainline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the previously working Playwright-based `BrowserManager` chain for login, classroom detection, question detection, and auto-answer triggering, while removing the unfinished `YuketangApiController` branch and other dead code.

**Architecture:** Keep the current account repository, `/accounts` routes, SSE account refresh, and per-account monitor shell. Replace the current split controllers with one concrete browser implementation, `BrowserManager`, used both as the app-level login/runtime controller and as the default per-account worker controller. Keep `/accounts/login/*` as the external API, but back it with `BrowserManager` instead of `AccountLoginBrowserService`; do not restore `/browser` or `/web-shell`.

**Tech Stack:** Fastify, Playwright, Vitest, TypeScript, Drizzle/SQLite

---

## File Map

### Create / Restore
- `apps/service/src/browser/browser-manager.ts`
  Restore the old Playwright controller from `backup/legacy-browser-polling`, then adapt it to the current `BrowserController` and `AccountLoginController` contracts.
- `tests/service/browser-manager.test.ts`
  Restore the old focused controller tests that cover browser lifecycle, QR login, and detector behavior.

### Modify
- `apps/service/src/browser/browser-controller.ts`
  Reintroduce optional controller capabilities used by the old chain, especially `startLogin` and `supportsDeferredActiveLessonEntry`.
- `apps/service/src/app.ts`
  Make `BrowserManager` the default concrete controller for app-level runtime routes and account login routes.
- `apps/service/src/monitors/account-monitor-manager.ts`
  Make `BrowserManager` the default per-account worker controller instead of `YuketangApiController`.
- `apps/service/src/auto-answer/autoplay-monitor-service.ts`
  Restore the old monitor behavior that understands deferred classroom entry and only polls when the controller does not support pushed question detection.
- `tests/service/account-monitor-manager.test.ts`
  Update default-controller assertions from `YuketangApiController` behavior to `BrowserManager` behavior.
- `tests/service/autoplay-monitor-service.test.ts`
  Restore old monitor expectations for deferred lesson entry and push-aware question detection.
- `tests/service/service-bootstrap.test.ts`
  Keep the current expectation that `/browser` stays removed, but update the default worker assumptions to the restored browser manager chain.

### Delete
- `apps/service/src/browser/account-login-browser-service.ts`
  Unfinished split login service that will be replaced by `BrowserManager`.
- `apps/service/src/browser/yuketang-api-controller.ts`
  Unfinished pure-interface controller that fails to fetch live question state.
- `tests/service/account-login-browser-service.test.ts`
  Tests for the removed split login service.
- `tests/service/yuketang-api-controller.test.ts`
  Tests for the removed pure-interface controller.
- `docs/superpowers/plans/2026-04-20-wsapp-lifecycle-push.md`
  Plan for the abandoned pure-interface branch.

## Task 1: Restore BrowserManager and Its Contract Surface

**Files:**
- Create: `apps/service/src/browser/browser-manager.ts`
- Modify: `apps/service/src/browser/browser-controller.ts`
- Test: `tests/service/browser-manager.test.ts`

- [ ] **Step 1: Write the failing browser manager tests**

```ts
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BrowserManager } from '../../apps/service/src/browser/browser-manager';

describe('BrowserManager', () => {
  it('starts the browser and moves to running', async () => {
    const runtime = createRuntime();
    const manager = new BrowserManager({ launchBrowser: runtime.launch });

    const status = await manager.start();

    expect(status).toMatchObject({
      status: 'running',
      mode: 'headless',
      pageUrl: 'https://www.yuketang.cn',
      lastError: null
    });
  });

  it('fetches qr code data from the browser qr page and saves a local backup', async () => {
    const tempRoot = mkdtempSync(path.join(tmpdir(), 'yksprite-qr-'));
    const runtime = createRuntime();
    runtime.page.evaluate.mockResolvedValue('/connect/qrcode/browser-code');
    vi.stubGlobal('fetch', createWechatQrFetchMock());
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);

    const manager = new BrowserManager({
      launchBrowser: runtime.launch,
      accountRepository: {
        saveSessionForLogin: vi.fn().mockReturnValue({ accountId: 9, refreshedExistingAccount: false }),
        markLoginFailure: vi.fn()
      } as any
    });

    const state = await manager.startAccountLogin();

    expect(state.status).toBe('pending');
    expect(readFileSync(path.join(tempRoot, `.tmp/qr-login/${state.loginSessionId}.png`), 'base64')).toBeTruthy();

    rmSync(tempRoot, { recursive: true, force: true });
  });
});
```

- [ ] **Step 2: Run the focused browser manager test file and verify it fails because the implementation is missing**

Run: `pnpm vitest tests/service/browser-manager.test.ts --run`

Expected: FAIL with a module resolution error for `../../apps/service/src/browser/browser-manager` or missing methods on the restored controller contract.

- [ ] **Step 3: Restore the controller implementation and extend the browser controller contract**

```ts
export interface BrowserController {
  getStatus(): BrowserStatus;
  supportsPushedQuestionDetection?(): boolean;
  supportsDeferredActiveLessonEntry?(): boolean;
  start(): Promise<BrowserStatus>;
  startLogin?(): Promise<BrowserStatus>;
  stop(): Promise<BrowserStatus>;
  getSessionState(): Promise<SessionState>;
  saveSession(): Promise<SessionState>;
  navigateHome(): Promise<BrowserStatus>;
  navigate(url: string): Promise<BrowserStatus>;
  discoverLessons(): Promise<LessonCandidate[]>;
  listExerciseEntries(): Promise<ExerciseEntry[]>;
  openCurrentExercise(): Promise<string | null>;
  inspectPage(): Promise<PageSnapshot>;
  getDebugState(): Promise<BrowserDebugState>;
  captureScreenshot(): Promise<ScreenshotPayload>;
  ensureExercisePageReady(url: string): Promise<ExerciseRuntimeState>;
  readExerciseRuntimeState(): Promise<ExerciseRuntimeState | null>;
  startQuestionDetection(onEvent: (event: DetectedQuestionEvent) => void | Promise<void>): Promise<void>;
  startClassroomDetection?(onEvent: (event: DetectedClassroomEvent) => void | Promise<void>): Promise<void>;
  stopQuestionDetection(): Promise<void>;
  stopClassroomDetection?(): Promise<void>;
  submitLessonProblem(payload: LessonProblemSubmitPayload): Promise<LessonProblemSubmitResult>;
}
```

```ts
export class BrowserManager implements BrowserController, AccountLoginController {
  supportsPushedQuestionDetection(): boolean {
    return true;
  }

  supportsDeferredActiveLessonEntry(): boolean {
    return true;
  }

  async startLogin(): Promise<BrowserStatus> {
    // restore visible-login flow from backup/legacy-browser-polling
  }

  async startAccountLogin(input?: { platform?: string }): Promise<AccountLoginState> {
    // restore QR login flow from backup/legacy-browser-polling
  }

  async getAccountLoginState(loginSessionId: string): Promise<AccountLoginState> {
    // restore in-memory login session lookup from backup/legacy-browser-polling
  }

  async stopAccountLogin(loginSessionId: string): Promise<AccountLoginState> {
    // restore QR login shutdown from backup/legacy-browser-polling
  }
}
```

- [ ] **Step 4: Port the old detector internals instead of re-inventing them**

```ts
const installQuestionDetector = (input: { questionBindingName: string; lessonBindingName: string }) => {
  // restore the page-side detector from backup/legacy-browser-polling
  // include:
  // - detectAndOpenActiveLesson()
  // - installNetworkHooks()
  // - installSocketHooks()
  // - reportCurrentQuestion()
  // - attachVueWatch()
  // - installRouteHooks()
  // - MutationObserver fallback
};
```

```ts
private async ensureQuestionDetection() {
  await this.page?.addInitScript(installQuestionDetector, {
    questionBindingName: QUESTION_DETECTION_BINDING,
    lessonBindingName: ACTIVE_LESSON_DETECTION_BINDING
  });
  await this.page?.exposeBinding(QUESTION_DETECTION_BINDING, async (_source, payload) => {
    await this.handleDetectedQuestion(payload);
  });
  await this.page?.exposeBinding(ACTIVE_LESSON_DETECTION_BINDING, async (_source, payload) => {
    await this.handleDetectedActiveLesson(payload);
  });
}
```

- [ ] **Step 5: Run the restored browser manager tests and verify they pass**

Run: `pnpm vitest tests/service/browser-manager.test.ts --run`

Expected: PASS for lifecycle, QR login, and detector-focused tests.

- [ ] **Step 6: Commit the controller restoration**

```bash
git add apps/service/src/browser/browser-controller.ts apps/service/src/browser/browser-manager.ts tests/service/browser-manager.test.ts
git commit -m "feat: restore browser manager controller"
```

## Task 2: Rewire the App and Monitor Shell to Use BrowserManager

**Files:**
- Modify: `apps/service/src/app.ts`
- Modify: `apps/service/src/monitors/account-monitor-manager.ts`
- Modify: `apps/service/src/auto-answer/autoplay-monitor-service.ts`
- Test: `tests/service/account-monitor-manager.test.ts`
- Test: `tests/service/autoplay-monitor-service.test.ts`
- Test: `tests/service/service-bootstrap.test.ts`

- [ ] **Step 1: Write the failing integration assertions for the restored default path**

```ts
it('uses the browser manager as the default worker controller', () => {
  const manager = createManager();

  const controller = (manager as any).controllerFactory({
    accountId: 1,
    sessionStore: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn()
    },
    traceStore: new AutoplayDebugTraceStore()
  });

  expect(controller.supportsPushedQuestionDetection?.()).toBe(true);
  expect(controller.supportsDeferredActiveLessonEntry?.()).toBe(true);
});
```

```ts
it('does not navigate immediately when the controller defers active lesson entry itself', async () => {
  const browserController = {
    ...createBrowserController(vi.fn().mockResolvedValue([
      {
        id: 'lesson-1',
        classroomId: 'classroom-1',
        courseTitle: '高等数学',
        lessonTitle: '第一讲',
        lessonState: 'in_class',
        href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
      }
    ])),
    supportsDeferredActiveLessonEntry: () => true
  } as unknown as BrowserController;

  const service = new AutoplayMonitorService({
    autoAnswerService: { getStatus: () => ({ status: 'idle' }), start: vi.fn() } as any,
    browserController,
    intervalMs: 10
  });

  await service.start();

  expect(browserController.navigate).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the affected integration tests and confirm they fail under the current `YuketangApiController` wiring**

Run: `pnpm vitest tests/service/account-monitor-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/service-bootstrap.test.ts --run`

Expected: FAIL because the default factory still returns `YuketangApiController`, and the current autoplay monitor does not honor deferred active lesson entry.

- [ ] **Step 3: Make `BrowserManager` the single default app-level controller**

```ts
const defaultBrowserManager = new BrowserManager({
  sessionStore: new SessionStore({ repository: sessionRepository }),
  accountRepository,
  debugTraceStore,
  onAccountSessionSaved: async (accountId) => {
    await accountMonitorManager.startForAccount(accountId, 'login');
    accountEventHub.publish({
      type: 'accounts_changed',
      accountId
    });
  }
});

const browserController = options.browserController ?? defaultBrowserManager;
const accountLoginController = options.accountLoginController ?? defaultBrowserManager;
```

- [ ] **Step 4: Make `BrowserManager` the default per-account worker controller**

```ts
this.controllerFactory =
  options.controllerFactory ??
  ((input) =>
    new BrowserManager({
      sessionStore: input.sessionStore,
      accountRepository: this.accountRepository,
      traceStore: input.traceStore
    }));
```

- [ ] **Step 5: Restore the old autoplay monitor behavior that cooperates with the restored browser manager**

```ts
private async ensureAutoplayContext() {
  const session = await this.browserController.getSessionState();
  if (!session.hasSession) {
    return;
  }

  const snapshot = await this.browserController.inspectPage().catch(() => null);
  const activeLesson = (await this.browserController.discoverLessons()).find((lesson) => lesson.lessonState === 'in_class' && lesson.href);

  if (!activeLesson?.href) {
    return;
  }

  if (this.browserController.supportsDeferredActiveLessonEntry?.()) {
    return;
  }

  await this.browserController.navigate(activeLesson.href);
  await this.onLog?.('成功进入课堂', 'classroom_entered');
}

private async tick() {
  await this.ensureAutoplayContext();
  if (!this.browserController.supportsPushedQuestionDetection?.()) {
    const polledEvent = await this.readLatestDetectedQuestion().catch(() => null);
    if (polledEvent) {
      await this.handleDetectedQuestion(polledEvent);
    }
  }
}
```

- [ ] **Step 6: Run the integration suite and verify the rewiring passes**

Run: `pnpm vitest tests/service/account-monitor-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/service-bootstrap.test.ts --run`

Expected: PASS, with worker defaults now coming from `BrowserManager`, `/browser` still returning `404`, and the monitor recognizing deferred entry.

- [ ] **Step 7: Commit the rewiring**

```bash
git add apps/service/src/app.ts apps/service/src/monitors/account-monitor-manager.ts apps/service/src/auto-answer/autoplay-monitor-service.ts tests/service/account-monitor-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/service-bootstrap.test.ts
git commit -m "refactor: route account automation through browser manager"
```

## Task 3: Remove the Abandoned Pure-Interface Chain

**Files:**
- Delete: `apps/service/src/browser/account-login-browser-service.ts`
- Delete: `apps/service/src/browser/yuketang-api-controller.ts`
- Delete: `tests/service/account-login-browser-service.test.ts`
- Delete: `tests/service/yuketang-api-controller.test.ts`
- Delete: `docs/superpowers/plans/2026-04-20-wsapp-lifecycle-push.md`
- Modify: `apps/service/src/app.ts`
- Modify: `tests/service/account-monitor-manager.test.ts`

- [ ] **Step 1: Add one failing assertion that the repo no longer depends on the abandoned defaults**

```ts
expect(() => {
  const controller = (manager as any).controllerFactory({
    accountId: 1,
    sessionStore: {
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn()
    },
    traceStore: new AutoplayDebugTraceStore()
  });

  return controller.constructor.name;
}).toBe('BrowserManager');
```

- [ ] **Step 2: Run the manager test file and confirm the current code still points at the abandoned chain**

Run: `pnpm vitest tests/service/account-monitor-manager.test.ts --run`

Expected: FAIL while the factory still resolves to `YuketangApiController`.

- [ ] **Step 3: Remove the dead source, tests, and plan file**

```bash
git rm apps/service/src/browser/account-login-browser-service.ts
git rm apps/service/src/browser/yuketang-api-controller.ts
git rm tests/service/account-login-browser-service.test.ts
git rm tests/service/yuketang-api-controller.test.ts
git rm docs/superpowers/plans/2026-04-20-wsapp-lifecycle-push.md
```

```ts
import { BrowserManager } from './browser/browser-manager.js';
// remove:
// import { YuketangApiController } from './browser/yuketang-api-controller.js';
// import { AccountLoginBrowserService } from './browser/account-login-browser-service.js';
```

- [ ] **Step 4: Run a service typecheck and the focused test set to verify all abandoned references are gone**

Run: `pnpm exec tsc -p apps/service/tsconfig.json --noEmit`

Expected: PASS with no references to `YuketangApiController` or `AccountLoginBrowserService`.

Run: `pnpm vitest tests/service/browser-manager.test.ts tests/service/account-monitor-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/service-bootstrap.test.ts tests/service/accounts-routes.test.ts --run`

Expected: PASS.

- [ ] **Step 5: Commit the cleanup**

```bash
git add apps/service/src/app.ts apps/service/src/monitors/account-monitor-manager.ts tests/service/account-monitor-manager.test.ts
git commit -m "chore: remove abandoned api controller chain"
```

## Task 4: Full Regression and Manual Smoke Verification

**Files:**
- Modify: none
- Test: `tests/service/accounts-routes.test.ts`
- Test: `tests/service/runtime-routes.test.ts`
- Test: `tests/service/assist-routes.test.ts`

- [ ] **Step 1: Run the complete service-side regression suite**

Run: `pnpm vitest tests/service --run`

Expected: PASS for browser manager, account routes, monitor manager, runtime routes, assist routes, and service bootstrap.

- [ ] **Step 2: Run a service typecheck**

Run: `pnpm exec tsc -p apps/service/tsconfig.json --noEmit`

Expected: PASS.

- [ ] **Step 3: Start the backend and smoke the restored login and monitor endpoints**

Run: `pnpm --filter @yksprite/service dev`

Expected:
- `/health` returns `{"status":"ok","name":"YKSprite"}`
- `POST /accounts/login/start` returns a `pending` login session with `qrCodeDataUrl`
- `GET /accounts/login/:sessionId/status` eventually returns `completed` after scanning
- enabling monitoring on a saved account starts a `BrowserManager` worker

- [ ] **Step 4: Commit any final test-only or compatibility fixes**

```bash
git add -A
git commit -m "test: finalize browser manager restoration regression coverage"
```

## Self-Review

### Spec Coverage
- Restore old login flow: covered in Task 1 and Task 2.
- Restore old classroom and question detector chain: covered in Task 1.
- Reconnect current account shell to the old browser manager path: covered in Task 2.
- Remove unfinished pure-interface code: covered in Task 3.
- Verify the resulting service still boots and keeps `/browser` removed: covered in Task 2 and Task 4.

### Placeholder Scan
- No `TODO`, `TBD`, or "similar to previous task" placeholders are left in this plan.
- Every code-changing task includes exact files, concrete snippets, and exact commands.

### Type Consistency
- `BrowserManager` is the only default concrete controller.
- `AccountLoginController` remains the route-facing login contract.
- `BrowserController` regains `startLogin?()` and `supportsDeferredActiveLessonEntry?()` because the restored monitor/controller path depends on them.
