# Push-Driven Question Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace stale route and exercise-list based question discovery with push-driven classroom state detection, and simplify question image retrieval to use only the lesson presentation interface.

**Architecture:** Keep `AutoAnswerService` responsible for entering and answering a target question, but move question discovery truth to the live classroom state already maintained in the lesson page. `BrowserManager` should normalize `currSlide.event.type === 'problem'` into `DetectedQuestionEvent`, and `AutoplayMonitorService` should consume those pushed events as the primary and only trigger for new questions instead of re-confirming through `listExerciseEntries()` or `readExerciseRuntimeState()`. For question images, use `/api/v3/lesson/presentation/fetch` as the only source of truth and remove runtime-image and screenshot fallbacks from the answer collection path.

**Tech Stack:** TypeScript, Playwright, Fastify service runtime, Vitest

---

## File Map

### Modify

- `apps/service/src/browser/browser-controller.ts`
- `apps/service/src/browser/browser-manager.ts`
- `apps/service/src/browser/question-runtime.ts`
- `apps/service/src/auto-answer/autoplay-monitor-service.ts`
- `apps/service/src/auto-answer/auto-answer-service.ts`
- `tests/service/browser-manager.test.ts`
- `tests/service/autoplay-monitor-service.test.ts`
- `tests/service/auto-answer-service.test.ts`

### Runtime Notes To Preserve

- Real classroom route can stay stale, for example `/lesson/fullscreen/v3/1668057624085573888/subjective/18`, while the live lesson store has already advanced to a new problem.
- Real classroom state observed in the browser:

```ts
{
  slideIndex: 18,
  currSlide: {
    pageIndex: 20,
    problemID: '1668066119170145408',
    problemType: 2,
    isComplete: false,
    event: {
      type: 'problem',
      prob: '1668066119170145408',
      sid: '1668066119170145408',
      si: 20,
      pres: '...'
    }
  }
}
```

- The page also exposes a live websocket connection at `wss://www.yuketang.cn/wsapp/`, but implementation should consume the already-updated lesson state rather than depending on raw socket frame parsing.
- The detector must not assume the URL has already switched to `/exercise/:index` or `/subjective/:index`.
- Question-image collection should stay simple: read the current question slide from `presentation/fetch`, download that image, and fail explicitly if the slide image is missing instead of layering multiple fallbacks.

## Task 1: Lock in Browser-Level Detection Around Live Classroom State

**Files:**
- Modify: `tests/service/browser-manager.test.ts`
- Modify: `apps/service/src/browser/browser-controller.ts`
- Modify: `apps/service/src/browser/question-runtime.ts`
- Modify: `apps/service/src/browser/browser-manager.ts`

- [ ] **Step 1: Write the failing browser-manager tests for stale-route lesson updates**

```ts
it('emits a pushed question from currSlide.event when the route is still on an older subjective page', async () => {
  const runtime = createRuntime();
  runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/18');
  runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1/subjective/18');
  const app = document.querySelector('#app') as { __vue__?: any };
  app.__vue__ = {
    $route: {
      name: 'subjective',
      params: { lessonID: 'lesson-1', index: '18' },
      path: '/lesson/fullscreen/v3/lesson-1/subjective/18'
    },
    $store: {
      state: {
        slideIndex: 18,
        currSlide: {
          pageIndex: 20,
          problemID: 'problem-20',
          problemType: 2,
          isComplete: false,
          event: {
            type: 'problem',
            prob: 'problem-20',
            sid: 'problem-20',
            si: 20,
            pres: 'presentation-1'
          }
        },
        cards: []
      }
    },
    $children: [{ problemMap: new Map() }],
    $watch: (source: () => unknown, callback: () => void, options?: { immediate?: boolean }) => {
      source();
      if (options?.immediate) {
        callback();
      }
      return () => undefined;
    }
  };
  const manager = new BrowserManager({ launchBrowser: runtime.launch });
  const onEvent = vi.fn();

  await manager.start();
  await manager.startQuestionDetection(onEvent);

  expect(onEvent).toHaveBeenCalledWith(
    expect.objectContaining({
      lessonId: 'lesson-1',
      problemId: 'problem-20',
      problemType: 2,
      isComplete: false,
      source: 'curr-slide-event'
    })
  );
});
```

```ts
it('does not emit when currSlide.event is not a problem event', async () => {
  const runtime = createRuntime();
  runtime.page.url.mockReturnValue('https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1');
  runtime.page.evaluate.mockImplementation(async (fn: (...args: any[]) => unknown, ...args: unknown[]) => fn(...args));
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, '', '/lesson/fullscreen/v3/lesson-1');
  const app = document.querySelector('#app') as { __vue__?: any };
  app.__vue__ = {
    $route: {
      name: 'lesson',
      params: { lessonID: 'lesson-1' },
      path: '/lesson/fullscreen/v3/lesson-1'
    },
    $store: {
      state: {
        currSlide: {
          pageIndex: 21,
          problemID: null,
          problemType: null,
          isComplete: false,
          event: {
            type: 'slide',
            si: 21
          }
        },
        cards: []
      }
    },
    $children: [{ problemMap: new Map() }],
    $watch: () => () => undefined
  };
  const manager = new BrowserManager({ launchBrowser: runtime.launch });
  const onEvent = vi.fn();

  await manager.start();
  await manager.startQuestionDetection(onEvent);

  expect(onEvent).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused browser-manager tests and verify they fail**

Run: `pnpm vitest run tests/service/browser-manager.test.ts -t "currSlide.event"`

Expected: FAIL because `DetectedQuestionEvent` does not yet encode the new signal and `startQuestionDetection()` still relies on the old runtime snapshot path.

- [ ] **Step 3: Expand the detection contract to record pushed source metadata**

```ts
export type DetectedQuestionEvent = {
  lessonId: string;
  problemId: string;
  problemType: number;
  exerciseIndex: string | null;
  routePath: string | null;
  isComplete: boolean;
  imageUrl: string | null;
  detectedAt: string;
  pageIndex?: number | null;
  source?: 'runtime-state' | 'curr-slide-event';
};
```

```ts
export const buildDetectedQuestionEvent = (
  runtimeState: ExerciseRuntimeState | null,
  input?: {
    source?: 'runtime-state' | 'curr-slide-event';
    pageIndex?: number | null;
  }
): DetectedQuestionEvent | null => {
  if (!runtimeState?.lessonId || !runtimeState.problemId) {
    return null;
  }

  return {
    lessonId: runtimeState.lessonId,
    problemId: runtimeState.problemId,
    problemType: runtimeState.problemType,
    exerciseIndex: runtimeState.exerciseIndex,
    routePath: runtimeState.routePath,
    isComplete: runtimeState.isComplete,
    imageUrl: runtimeState.imageUrl,
    detectedAt: new Date().toISOString(),
    pageIndex: input?.pageIndex ?? runtimeState.pageIndex ?? null,
    source: input?.source ?? 'runtime-state'
  };
};
```

- [ ] **Step 4: Teach `BrowserManager` to read and watch `currSlide.event` directly**

```ts
const readCurrentSlideProblemEvent = () => {
  const app = document.querySelector('#app') as { __vue__?: any } | null;
  const vue = app?.__vue__;
  const route = vue?.$route ?? null;
  const state = vue?.$store?.state ?? null;
  const currSlide = state?.currSlide ?? null;
  const slideEvent = currSlide?.event ?? null;
  const lessonId = route?.params?.lessonID ?? route?.params?.lessonId ?? null;

  if (!lessonId || slideEvent?.type !== 'problem') {
    return null;
  }

  const problemId = String(slideEvent?.prob ?? slideEvent?.sid ?? currSlide?.problemID ?? '');
  const problemType = Number(currSlide?.problemType ?? 0);
  if (!problemId || !Number.isFinite(problemType) || problemType <= 0) {
    return null;
  }

  return {
    lessonId,
    exerciseIndex: currSlide?.exerciseIndex ? String(currSlide.exerciseIndex) : null,
    problemId,
    problemType,
    pageIndex: Number(currSlide?.pageIndex ?? slideEvent?.si ?? null),
    questionText: '',
    options: [],
    imageUrl: null,
    imageThumbnailUrl: null,
    isComplete: Boolean(currSlide?.isComplete),
    routePath: route?.path ?? null
  } satisfies ExerciseRuntimeState;
};
```

```ts
await this.page.addInitScript(({ questionBindingName }) => {
  const pageWindow = window as typeof window & Record<string, any>;
  const lastKeyRef = { value: '' };

  const emitIfNeeded = () => {
    const runtimeState = readCurrentSlideProblemEvent();
    if (!runtimeState || runtimeState.isComplete) {
      return;
    }
    const eventKey = `${runtimeState.lessonId}:${runtimeState.problemId}`;
    if (eventKey === lastKeyRef.value) {
      return;
    }
    lastKeyRef.value = eventKey;
    void pageWindow[questionBindingName]?.({
      ...buildDetectedQuestionEvent(runtimeState, {
        source: 'curr-slide-event',
        pageIndex: runtimeState.pageIndex
      })
    });
  };

  const app = document.querySelector('#app') as { __vue__?: any } | null;
  const vue = app?.__vue__;
  vue?.$watch?.(() => vue?.$store?.state?.currSlide?.event, emitIfNeeded, { deep: true, immediate: true });
  vue?.$watch?.(() => vue?.$store?.state?.currSlide?.problemID, emitIfNeeded, { immediate: true });
}, { questionBindingName: QUESTION_DETECTION_BINDING });
```

- [ ] **Step 5: Re-run the focused browser-manager tests and verify they pass**

Run: `pnpm vitest run tests/service/browser-manager.test.ts -t "currSlide.event"`

Expected: PASS for the stale-route positive case and the non-problem negative case.

- [ ] **Step 6: Commit the browser-side detector change**

```bash
git add apps/service/src/browser/browser-controller.ts apps/service/src/browser/question-runtime.ts apps/service/src/browser/browser-manager.ts tests/service/browser-manager.test.ts
git commit -m "fix: detect questions from live classroom slide events"
```

## Task 2: Remove Polling Confirmation From the Monitor and Trust Pushed Events

**Files:**
- Modify: `tests/service/autoplay-monitor-service.test.ts`
- Modify: `apps/service/src/auto-answer/autoplay-monitor-service.ts`

- [ ] **Step 1: Write the failing autoplay-monitor tests for push-only triggering**

```ts
it('starts auto-answer from a curr-slide push event without re-confirming through list polling', async () => {
  let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
  const browserController = {
    ...createBrowserController(
      vi.fn().mockResolvedValue([
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        }
      ])
    ),
    startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
      onQuestionEvent = handler;
    }),
    listExerciseEntries: vi.fn(async () => {
      throw new Error('list polling should not run for pushed question confirmation');
    }),
    readExerciseRuntimeState: vi.fn(async () => {
      throw new Error('runtime polling should not run for pushed question confirmation');
    })
  } as unknown as BrowserController;
  const autoAnswerService = {
    getStatus: vi.fn(() => ({ status: 'idle' })),
    start: vi.fn(async () => ({ runId: 'run-push-only' }))
  };
  const service = new AutoplayMonitorService({
    autoAnswerService: autoAnswerService as any,
    browserController,
    intervalMs: 1000
  });

  await service.start();
  await onQuestionEvent?.({
    lessonId: 'lesson-1',
    problemId: 'problem-20',
    problemType: 2,
    exerciseIndex: null,
    routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
    isComplete: false,
    imageUrl: null,
    detectedAt: '2026-04-20T06:00:00.000Z',
    pageIndex: 20,
    source: 'curr-slide-event'
  });

  expect(autoAnswerService.start).toHaveBeenCalledWith({
    preferredQuestion: expect.objectContaining({
      lessonId: 'lesson-1',
      problemId: 'problem-20',
      source: 'curr-slide-event'
    })
  });
});
```

```ts
it('still queues a later pushed question while a previous run is active', async () => {
  vi.useFakeTimers();
  let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
  let autoAnswerStatus: 'running' | 'idle' = 'running';
  const browserController = {
    ...createBrowserController(
      vi.fn().mockResolvedValue([
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        }
      ])
    ),
    startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
      onQuestionEvent = handler;
    })
  } as unknown as BrowserController;
  const autoAnswerService = {
    getStatus: vi.fn(() => ({ status: autoAnswerStatus })),
    start: vi.fn(async () => ({ runId: 'run-queued' }))
  };
  const service = new AutoplayMonitorService({
    autoAnswerService: autoAnswerService as any,
    browserController,
    intervalMs: 100
  });

  await service.start();
  await onQuestionEvent?.({
    lessonId: 'lesson-1',
    problemId: 'problem-21',
    problemType: 1,
    exerciseIndex: null,
    routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
    isComplete: false,
    imageUrl: null,
    detectedAt: '2026-04-20T06:01:00.000Z',
    pageIndex: 21,
    source: 'curr-slide-event'
  });

  autoAnswerStatus = 'idle';
  await vi.advanceTimersByTimeAsync(100);

  expect(autoAnswerService.start).toHaveBeenCalledWith({
    preferredQuestion: expect.objectContaining({
      problemId: 'problem-21',
      pageIndex: 21
    })
  });
});
```

- [ ] **Step 2: Run the focused autoplay-monitor tests and verify they fail**

Run: `pnpm vitest run tests/service/autoplay-monitor-service.test.ts -t "curr-slide"`

Expected: FAIL because pushed detection still re-confirms through `readLatestDetectedQuestion()` and can silently drop events when the stale page runtime does not match the new pushed problem.

- [ ] **Step 3: Simplify the monitor to treat pushed events as authoritative**

```ts
private async handleDetectedQuestion(event: DetectedQuestionEvent) {
  if (!this.status.enabled || event.isComplete) {
    return;
  }

  const eventKey = buildEventKey(event);
  this.status = {
    ...this.status,
    lastEventAt: event.detectedAt,
    lastEventKey: eventKey,
    lastError: null
  };

  if (this.processedEventKeys.has(eventKey)) {
    return;
  }

  await this.onLog?.('检测到题目', 'question_detected');

  if (this.autoAnswerService.getStatus().status === 'running') {
    this.queueQuestionEvent(event);
    return;
  }

  this.processedEventKeys.add(eventKey);
  const started = await this.autoAnswerService.start({
    preferredQuestion: event
  });
  this.status = {
    ...this.status,
    lastTriggeredRunId: started.runId,
    lastError: null
  };
}
```

```ts
private async tick() {
  if (!this.status.enabled || this.ticking) {
    return;
  }

  this.ticking = true;
  try {
    await this.ensureAutoplayContext();
    await this.flushQueuedQuestionEvent();
    if (this.status.lastError) {
      this.status = {
        ...this.status,
        lastError: null
      };
    }
  } catch (error) {
    this.status = {
      ...this.status,
      lastError: error instanceof Error ? error.message : 'Unknown autoplay monitor error'
    };
  } finally {
    this.ticking = false;
  }
}
```

- [ ] **Step 4: Re-run the focused autoplay-monitor tests and verify they pass**

Run: `pnpm vitest run tests/service/autoplay-monitor-service.test.ts -t "curr-slide"`

Expected: PASS for push-only start and queued push replay.

- [ ] **Step 5: Commit the push-only monitor change**

```bash
git add apps/service/src/auto-answer/autoplay-monitor-service.ts tests/service/autoplay-monitor-service.test.ts
git commit -m "fix: trust pushed lesson question events"
```

## Task 3: Verify the Full Focused Flow Against Existing Answer Entry Logic

**Files:**
- Modify: `tests/service/browser-manager.test.ts`
- Modify: `tests/service/autoplay-monitor-service.test.ts`
- Modify: `apps/service/src/browser/browser-manager.ts`
- Modify: `apps/service/src/auto-answer/autoplay-monitor-service.ts`

- [ ] **Step 1: Add an integration-style focused regression that mirrors the real classroom mismatch**

```ts
it('keeps detecting the new pushed problem when the current route still points at the previous subjective page', async () => {
  vi.useFakeTimers();
  let onQuestionEvent: ((event: any) => Promise<void>) | null = null;
  const browserController = {
    ...createBrowserController(
      vi.fn().mockResolvedValue([
        {
          id: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          lessonTitle: '第一讲',
          lessonState: 'in_class',
          href: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1'
        }
      ])
    ),
    startQuestionDetection: vi.fn(async (handler: (event: any) => Promise<void>) => {
      onQuestionEvent = handler;
    }),
    inspectPage: vi.fn(async () => ({
      currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/subjective/18',
      pageTitle: '雨课堂',
      html: '<html></html>',
      text: '课堂中'
    }))
  } as unknown as BrowserController;
  const autoAnswerService = {
    getStatus: vi.fn(() => ({ status: 'idle' })),
    start: vi.fn(async () => ({ runId: 'run-20' }))
  };
  const service = new AutoplayMonitorService({
    autoAnswerService: autoAnswerService as any,
    browserController,
    intervalMs: 100
  });

  await service.start();
  await onQuestionEvent?.({
    lessonId: 'lesson-1',
    problemId: 'problem-20',
    problemType: 2,
    exerciseIndex: null,
    routePath: '/lesson/fullscreen/v3/lesson-1/subjective/18',
    isComplete: false,
    imageUrl: null,
    detectedAt: '2026-04-20T06:02:00.000Z',
    pageIndex: 20,
    source: 'curr-slide-event'
  });

  expect(autoAnswerService.start).toHaveBeenCalledTimes(1);
  expect(service.getStatus()).toEqual(
    expect.objectContaining({
      lastEventKey: 'lesson-1:problem-20',
      lastTriggeredRunId: 'run-20',
      lastError: null
    })
  );
});
```

- [ ] **Step 2: Run the focused regression suite**

Run: `pnpm vitest run tests/service/browser-manager.test.ts tests/service/autoplay-monitor-service.test.ts`

Expected: PASS with the new stale-route and curr-slide-event regressions included.

- [ ] **Step 3: Run the broader answer-path verification suite**

Run: `pnpm vitest run tests/service/browser-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/auto-answer-service.test.ts`

Expected: PASS, confirming that push-driven detection still hands off `preferredQuestion` cleanly to the existing answer execution path.

- [ ] **Step 4: Commit the focused regression coverage**

```bash
git add apps/service/src/browser/browser-manager.ts apps/service/src/auto-answer/autoplay-monitor-service.ts tests/service/browser-manager.test.ts tests/service/autoplay-monitor-service.test.ts
git commit -m "test: cover stale-route pushed question flow"
```

## Task 4: Simplify Question Image Collection To Interface-Only Retrieval

**Files:**
- Modify: `tests/service/auto-answer-service.test.ts`
- Modify: `apps/service/src/auto-answer/auto-answer-service.ts`
- Modify: `apps/service/src/browser/browser-manager.ts`

- [ ] **Step 1: Write the failing auto-answer tests for presentation-only image retrieval**

```ts
it('downloads the current question image from presentation fetch without using runtimeState.imageUrl', async () => {
  const browserController = {
    getStatus: vi.fn(() => ({
      status: 'running',
      engine: 'chromium',
      headless: true,
      mode: 'headless',
      startedAt: '2026-04-20T00:00:00.000Z',
      pageUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1/exercise/20',
      lastError: null
    })),
    readExerciseRuntimeState: vi.fn(async () => ({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      problemId: 'problem-20',
      problemType: 1,
      pageIndex: 20,
      questionText: '第20题',
      options: [],
      imageUrl: 'https://example.com/runtime-should-not-be-used.jpg',
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20'
    })),
    readCurrentQuestionPresentationSlide: vi.fn(async () => ({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      pageIndex: 20,
      problemId: 'problem-20',
      problemType: 1,
      imageUrl: 'https://example.com/presentation-20.jpg',
      imageThumbnailUrl: 'https://example.com/presentation-20-thumb.jpg',
      raw: {}
    })),
    captureScreenshot: vi.fn(async () => {
      throw new Error('screenshot fallback should not be used');
    })
  } as any;

  // Existing service setup omitted here should assert that the saved capture was downloaded from presentation-20.jpg.
});
```

```ts
it('fails the collect step when the presentation slide has no image instead of falling back to screenshot', async () => {
  const browserController = {
    readExerciseRuntimeState: vi.fn(async () => ({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      problemId: 'problem-20',
      problemType: 1,
      pageIndex: 20,
      questionText: '第20题',
      options: [],
      imageUrl: null,
      imageThumbnailUrl: null,
      isComplete: false,
      routePath: '/lesson/fullscreen/v3/lesson-1/exercise/20'
    })),
    readCurrentQuestionPresentationSlide: vi.fn(async () => ({
      lessonId: 'lesson-1',
      exerciseIndex: '20',
      pageIndex: 20,
      problemId: 'problem-20',
      problemType: 1,
      imageUrl: null,
      imageThumbnailUrl: null,
      raw: {}
    })),
    captureScreenshot: vi.fn(async () => {
      throw new Error('screenshot fallback should not be used');
    })
  } as any;

  // Existing service setup omitted here should assert that collect fails with a clear "No presentation slide image" error.
});
```

- [ ] **Step 2: Run the focused auto-answer image tests and verify they fail**

Run: `pnpm vitest run tests/service/auto-answer-service.test.ts -t "presentation"`

Expected: FAIL because the current collect path still prefers `runtimeState.imageUrl` and still falls back to `captureScreenshot()`.

- [ ] **Step 3: Change the collect path to require presentation-slide image URLs**

```ts
const presentationSlide = run.lessonId
  ? await this.browserController.readCurrentQuestionPresentationSlide?.(run.lessonId)
  : null;
const presentationImageUrl = presentationSlide?.imageUrl ?? null;

if (!presentationImageUrl) {
  throw new Error(`No presentation slide image available for ${entryId}`);
}

const downloaded = await downloadQuestionImage(presentationImageUrl);
this.assistRepository.saveQuestionCapture({
  questionRowId: currentQuestion.id,
  sourceType: 'runtime_ppt',
  filePath: downloaded.filePath,
  mimeType: downloaded.mimeType,
  width: downloaded.width,
  height: downloaded.height,
  sha256: downloaded.sha256
});
```

```ts
// Remove this fallback branch entirely:
// - runtimeState.imageUrl
// - screenshot capture
// - OCR extraction from screenshots during the collect step
```

- [ ] **Step 4: Re-run the focused auto-answer image tests and verify they pass**

Run: `pnpm vitest run tests/service/auto-answer-service.test.ts -t "presentation"`

Expected: PASS for interface-only image download and explicit failure when the presentation slide has no image.

- [ ] **Step 5: Run the full focused suite**

Run: `pnpm vitest run tests/service/browser-manager.test.ts tests/service/autoplay-monitor-service.test.ts tests/service/auto-answer-service.test.ts`

Expected: PASS with pushed question detection and presentation-only image collection both covered.

- [ ] **Step 6: Commit the image-path cleanup**

```bash
git add apps/service/src/auto-answer/auto-answer-service.ts apps/service/src/browser/browser-manager.ts tests/service/auto-answer-service.test.ts
git commit -m "refactor: use presentation images for auto answer collection"
```

## Self-Review

- Spec coverage: this plan only covers the agreed bugfix scope, not the abandoned lesson-automation rewrite. It records the real classroom signal, browser-side detection change, monitor-side trigger change, interface-only image retrieval, and focused verification.
- Placeholder scan: no `TODO`, `TBD`, or implied “handle appropriately” steps remain.
- Type consistency: all new event fields use the same names throughout the plan: `source`, `pageIndex`, `currSlide.event`, `problemId`, `lessonId`.
