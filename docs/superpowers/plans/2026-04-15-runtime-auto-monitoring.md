# Runtime Auto Monitoring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a persistent runtime monitor that keeps polling the logged-in Rain Classroom home page, automatically enters the first in-progress class, keeps scanning the active class, and returns to the home page to continue polling when class ends.

**Architecture:** Keep browser-driving logic inside the browser layer and move monitoring state + timers into a dedicated runtime monitor service. The monitor service will expose start/stop/status endpoints, persist scan side effects through the existing runtime/task/event flows, and let the Vue dashboard show monitor state without owning the loop.

**Tech Stack:** Fastify, Playwright + Chromium, SQLite via Drizzle/better-sqlite3, Vue 3 + Vite, Vitest

---

## File Responsibilities

- `apps/service/src/browser/browser-controller.ts`
  Add typed lesson-discovery and home-navigation interfaces so the monitor can ask the browser layer for course candidates instead of parsing raw HTML everywhere.

- `apps/service/src/browser/browser-manager.ts`
  Implement the new browser-controller methods with Playwright DOM queries against the logged-in Rain Classroom home page and lesson page.

- `apps/service/src/runtime/runtime-monitor.ts`
  New service that owns the monitoring timer, state machine, transitions, and scan loop.

- `apps/service/src/runtime/runtime-types.ts`
  Extend runtime-facing types with monitor status and discovered lesson metadata.

- `apps/service/src/routes/runtime.ts`
  Register `GET /runtime/monitor`, `POST /runtime/monitor/start`, and `POST /runtime/monitor/stop`, and wire the monitor service into existing scan behavior.

- `apps/service/src/app.ts`
  Construct the runtime monitor with the browser controller, runtime repository, and automation store.

- `apps/web/src/lib/api.ts`
  Add monitor status/start/stop client methods and types.

- `apps/web/src/App.vue`
  Add monitor status cards and manual start/stop controls while preserving the current dashboard layout.

- `tests/service/browser-manager.test.ts`
  Verify browser-layer lesson discovery and home navigation.

- `tests/service/runtime-routes.test.ts`
  Verify monitor endpoints and monitor-driven scan side effects.

- `tests/web/app.test.ts`
  Verify the dashboard fetches and renders monitor state and triggers monitor controls.

### Task 1: Add Browser Lesson Discovery Primitives

**Files:**
- Modify: `apps/service/src/browser/browser-controller.ts`
- Modify: `apps/service/src/browser/browser-manager.ts`
- Test: `tests/service/browser-manager.test.ts`

- [ ] **Step 1: Write the failing browser-manager tests**

```ts
it('discovers in-progress lessons from the logged-in home page', async () => {
  const runtime = createRuntime();
  runtime.page.url.mockReturnValue('https://www.yuketang.cn/v2/web/index');
  runtime.page.title.mockResolvedValue('雨课堂');
  runtime.page.evaluate = vi.fn().mockResolvedValue([
    {
      id: 'lesson-1',
      courseTitle: '高等数学',
      lessonTitle: '第 12 讲',
      lessonState: 'in_class',
      href: 'https://www.yuketang.cn/v2/web/lesson/lesson-1'
    }
  ]);

  const manager = new BrowserManager({ launchBrowser: runtime.launch });
  await manager.start();

  await expect(manager.discoverLessons()).resolves.toEqual([
    expect.objectContaining({
      id: 'lesson-1',
      lessonState: 'in_class'
    })
  ]);
});

it('navigates back to the logged-in home page', async () => {
  const runtime = createRuntime();
  const manager = new BrowserManager({ launchBrowser: runtime.launch });
  await manager.start();

  await manager.navigateHome();

  expect(runtime.page.goto).toHaveBeenLastCalledWith('https://www.yuketang.cn/v2/web/index');
});
```

- [ ] **Step 2: Run the focused test file and verify it fails**

Run: `pnpm vitest run tests/service/browser-manager.test.ts`

Expected: FAIL because `discoverLessons` and `navigateHome` do not exist yet on `BrowserManager` / `BrowserController`.

- [ ] **Step 3: Add the new browser-controller types**

```ts
export type LessonCandidate = {
  id: string;
  courseTitle: string;
  lessonTitle: string | null;
  lessonState: 'in_class' | 'waiting' | 'ended' | 'unknown';
  href: string | null;
};

export interface BrowserController {
  // existing methods...
  navigateHome(): Promise<BrowserStatus>;
  discoverLessons(): Promise<LessonCandidate[]>;
}
```

- [ ] **Step 4: Implement minimal browser-manager methods**

```ts
const HOME_PAGE_URL = 'https://www.yuketang.cn/v2/web/index';

async navigateHome(): Promise<BrowserStatus> {
  if (!this.page) return this.getStatus();
  await this.page.goto(HOME_PAGE_URL);
  this.status = { ...this.status, pageUrl: this.page.url() };
  return this.getStatus();
}

async discoverLessons(): Promise<LessonCandidate[]> {
  if (!this.page) return [];

  return this.page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('[data-lesson-id], a[href*="/lesson/"]'));
    return cards.map((node, index) => ({
      id: node.getAttribute('data-lesson-id') ?? `candidate-${index}`,
      courseTitle: node.textContent?.trim() ?? '未命名课程',
      lessonTitle: null,
      lessonState: /上课中|进行中/.test(node.textContent ?? '') ? 'in_class' : /待上课|即将开始/.test(node.textContent ?? '') ? 'waiting' : 'unknown',
      href: node instanceof HTMLAnchorElement ? node.href : node.getAttribute('href')
    }));
  });
}
```

- [ ] **Step 5: Re-run the focused browser-manager tests**

Run: `pnpm vitest run tests/service/browser-manager.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the browser primitives**

```bash
git add apps/service/src/browser/browser-controller.ts apps/service/src/browser/browser-manager.ts tests/service/browser-manager.test.ts
git commit -m "feat: add browser lesson discovery primitives"
```

### Task 2: Build the Runtime Monitor Service and Routes

**Files:**
- Modify: `apps/service/src/runtime/runtime-types.ts`
- Create: `apps/service/src/runtime/runtime-monitor.ts`
- Modify: `apps/service/src/routes/runtime.ts`
- Modify: `apps/service/src/app.ts`
- Test: `tests/service/runtime-routes.test.ts`

- [ ] **Step 1: Write the failing runtime-route tests**

```ts
it('starts the runtime monitor and reports home polling state before a class is found', async () => {
  const app = buildServiceApp({ browserController: createBrowserController() });

  const startResponse = await app.inject({ method: 'POST', url: '/runtime/monitor/start' });
  const statusResponse = await app.inject({ method: 'GET', url: '/runtime/monitor' });

  expect(startResponse.statusCode).toBe(200);
  expect(statusResponse.json()).toMatchObject({
    enabled: true,
    phase: 'home_polling'
  });
});

it('records runtime_scan work when the monitor enters an in-progress lesson', async () => {
  const app = buildServiceApp({ browserController: createBrowserController() });

  await app.inject({ method: 'POST', url: '/runtime/monitor/start' });

  const tasksResponse = await app.inject({ method: 'GET', url: '/tasks' });
  expect(tasksResponse.json()[0]).toMatchObject({
    type: 'runtime_scan',
    status: 'succeeded'
  });
});
```

- [ ] **Step 2: Run the focused runtime-route tests and verify they fail**

Run: `pnpm vitest run tests/service/runtime-routes.test.ts`

Expected: FAIL because `/runtime/monitor*` routes and monitor types do not exist.

- [ ] **Step 3: Add monitor status types**

```ts
export type MonitorPhase = 'idle' | 'home_polling' | 'class_monitoring' | 'returning_home' | 'error_backoff';

export type RuntimeMonitorStatus = {
  enabled: boolean;
  phase: MonitorPhase;
  currentCourse: string | null;
  currentLessonId: string | null;
  lastCheckedAt: string | null;
  lastTransitionAt: string | null;
  lastError: string | null;
};
```

- [ ] **Step 4: Implement the runtime monitor service**

```ts
export class RuntimeMonitor {
  private timer: NodeJS.Timeout | null = null;
  private status: RuntimeMonitorStatus = {
    enabled: false,
    phase: 'idle',
    currentCourse: null,
    currentLessonId: null,
    lastCheckedAt: null,
    lastTransitionAt: null,
    lastError: null
  };

  async start() {
    if (this.status.enabled) return this.getStatus();
    this.status = { ...this.status, enabled: true, phase: 'home_polling', lastTransitionAt: new Date().toISOString(), lastError: null };
    this.timer = setInterval(() => void this.tick(), 10000);
    await this.tick();
    return this.getStatus();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.status = { ...this.status, enabled: false, phase: 'idle', currentCourse: null, currentLessonId: null, lastTransitionAt: new Date().toISOString() };
    return this.getStatus();
  }
}
```

- [ ] **Step 5: Implement monitor transitions**

```ts
const lessons = await this.browserController.discoverLessons();
const active = lessons.find((lesson) => lesson.lessonState === 'in_class');

if (!active) {
  this.status = { ...this.status, phase: 'home_polling', lastCheckedAt: now };
  return this.getStatus();
}

await this.browserController.navigate(active.href ?? HOME_PAGE_URL);
const scanResult = await this.automationStore.executeTask('runtime_scan', 'Scan current lesson page', async () => {
  const snapshot = await this.browserController.inspectPage();
  const runtimeStatus = probeRuntimeStatus(snapshot);
  const questions = extractQuestionsFromHtml(snapshot.html ?? '', runtimeStatus.courseTitle);
  this.runtimeRepository.saveSnapshot(runtimeStatus, questions);
  return runtimeStatus;
});
this.status = { ...this.status, phase: scanResult.lessonState === 'ended' ? 'returning_home' : 'class_monitoring', currentCourse: active.courseTitle, currentLessonId: active.id, lastCheckedAt: now };
```

- [ ] **Step 6: Add routes and wire the monitor into the app**

```ts
app.get('/runtime/monitor', async () => runtimeMonitor.getStatus());
app.post('/runtime/monitor/start', async () => runtimeMonitor.start());
app.post('/runtime/monitor/stop', async () => runtimeMonitor.stop());
```

```ts
const runtimeMonitor = new RuntimeMonitor({
  browserController,
  runtimeRepository,
  automationStore
});
registerRuntimeRoutes(app, browserController, runtimeRepository, automationStore, runtimeMonitor);
```

- [ ] **Step 7: Re-run the focused runtime-route tests**

Run: `pnpm vitest run tests/service/runtime-routes.test.ts`

Expected: PASS

- [ ] **Step 8: Commit the monitor backend**

```bash
git add apps/service/src/runtime/runtime-types.ts apps/service/src/runtime/runtime-monitor.ts apps/service/src/routes/runtime.ts apps/service/src/app.ts tests/service/runtime-routes.test.ts
git commit -m "feat: add runtime auto-monitor service"
```

### Task 3: Expose Monitor Controls in the Dashboard

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.vue`
- Test: `tests/web/app.test.ts`

- [ ] **Step 1: Write the failing dashboard test**

```ts
expect(wrapper.text()).toContain('自动监控');
expect(wrapper.text()).toContain('home_polling');

await monitorStartButton.trigger('click');
expect(fetchMock).toHaveBeenCalledWith('/runtime/monitor/start', expect.any(Object));
```

- [ ] **Step 2: Run the focused web test and verify it fails**

Run: `pnpm vitest run tests/web/app.test.ts`

Expected: FAIL because monitor API calls and UI controls do not exist.

- [ ] **Step 3: Add the monitor API client**

```ts
export type RuntimeMonitorStatus = {
  enabled: boolean;
  phase: 'idle' | 'home_polling' | 'class_monitoring' | 'returning_home' | 'error_backoff';
  currentCourse: string | null;
  currentLessonId: string | null;
  lastCheckedAt: string | null;
  lastTransitionAt: string | null;
  lastError: string | null;
};

export async function fetchRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor');
  return readMonitorResponse(response);
}

export async function startRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor/start', { method: 'POST' });
  return readMonitorResponse(response);
}

export async function stopRuntimeMonitor(): Promise<RuntimeMonitorStatus> {
  const response = await fetch('/runtime/monitor/stop', { method: 'POST' });
  return readMonitorResponse(response);
}
```

- [ ] **Step 4: Add monitor state to the Vue dashboard**

```ts
const monitor = ref<RuntimeMonitorStatus>({
  enabled: false,
  phase: 'idle',
  currentCourse: null,
  currentLessonId: null,
  lastCheckedAt: null,
  lastTransitionAt: null,
  lastError: null
});

const syncMonitor = async () => {
  monitor.value = await fetchRuntimeMonitor();
};

const handleStartMonitor = async () => {
  monitor.value = await startRuntimeMonitor();
  await syncAll();
};

const handleStopMonitor = async () => {
  monitor.value = await stopRuntimeMonitor();
};
```

- [ ] **Step 5: Render the monitor controls**

```vue
<article class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
  <p class="section-kicker">自动监控</p>
  <strong class="mt-3 block font-display text-xl font-semibold tracking-tight text-shell-900">{{ monitor.phase }}</strong>
  <p class="mt-2 text-sm text-shell-700">{{ monitor.currentCourse ?? '正在首页轮询进行中的课堂' }}</p>
  <div class="mt-4 flex gap-3">
    <button @click="handleStartMonitor">启动自动监控</button>
    <button @click="handleStopMonitor">停止自动监控</button>
  </div>
</article>
```

- [ ] **Step 6: Re-run the focused web test**

Run: `pnpm vitest run tests/web/app.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the dashboard monitor controls**

```bash
git add apps/web/src/lib/api.ts apps/web/src/App.vue tests/web/app.test.ts
git commit -m "feat: expose runtime monitor controls"
```

### Task 4: Final Verification

**Files:**
- Modify: none
- Test: whole workspace

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`

Expected: PASS

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: PASS

- [ ] **Step 3: Run the production build**

Run: `pnpm build`

Expected: PASS

- [ ] **Step 4: Commit the verification checkpoint**

```bash
git add -A
git commit -m "chore: verify runtime auto monitoring"
```
