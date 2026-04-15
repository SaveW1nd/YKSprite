# AI Vision Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist question screenshots to disk with SQLite metadata, analyze them through OpenAI and Qwen-VL using local prompt templates, and expose stored screenshots plus structured AI results to the frontend.

**Architecture:** Keep screenshots as filesystem assets under `data/captures/` and store only metadata + analysis rows in SQLite. Add a provider-agnostic vision analysis layer that reads a saved image path, loads a local prompt template by question type, calls the chosen provider, stores the normalized JSON result, and exposes it through assist endpoints for dashboard rendering.

**Tech Stack:** Fastify, SQLite via Drizzle/better-sqlite3, local filesystem assets, Vue 3 + Vite, OpenAI-compatible HTTP clients, Vitest

---

## File Responsibilities

- `apps/service/src/db/schema.ts`
  Add `question_captures` and `vision_analyses` tables.

- `apps/service/src/db/client.ts`
  Extend bootstrap SQL for the new tables.

- `apps/service/src/db/assist-repository.ts`
  Store and query screenshot metadata plus AI analysis records.

- `apps/service/src/assist/assist-types.ts`
  Add capture metadata and normalized vision analysis result types.

- `apps/service/src/assist/ocr-service.ts`
  Keep screenshot-saving behavior and return capture metadata suitable for persistence.

- `apps/service/src/assist/vision-analysis-service.ts`
  New provider-agnostic orchestration layer for prompt loading, provider dispatch, normalization, and persistence.

- `apps/service/src/assist/providers/openai-compatible.ts`
  Shared HTTP client for OpenAI and Qwen-VL style payloads.

- `apps/service/src/assist/providers/openai-provider.ts`
  OpenAI vision provider implementation.

- `apps/service/src/assist/providers/qwen-vl-provider.ts`
  Qwen-VL provider implementation using compatible API shape.

- `apps/service/src/routes/assist.ts`
  Add screenshot capture and AI analysis endpoints plus query endpoints.

- `packages/core/src/prompt.ts`
  Add prompt-builder helpers for vision tasks by question type.

- `apps/service/prompts/vision/single_choice.txt`
  Local single-choice prompt template.

- `apps/service/prompts/vision/multiple_choice.txt`
  Local multiple-choice prompt template.

- `apps/web/src/lib/api.ts`
  Add capture + AI analysis client types and fetchers.

- `apps/web/src/App.vue`
  Show current question screenshot path and AI analysis summary.

- `tests/service/assist-routes.test.ts`
  Verify screenshot capture persistence and AI analysis response shape.

- `tests/service/database.test.ts`
  Verify new assist tables persist and query correctly.

- `tests/web/app.test.ts`
  Verify the dashboard renders screenshot/analysis data.

### Task 1: Add Screenshot and AI Analysis Persistence

**Files:**
- Modify: `apps/service/src/db/schema.ts`
- Modify: `apps/service/src/db/client.ts`
- Modify: `apps/service/src/db/assist-repository.ts`
- Modify: `apps/service/src/assist/assist-types.ts`
- Test: `tests/service/database.test.ts`

- [ ] **Step 1: Write the failing database test**

```ts
it('stores a saved capture and current AI analysis for a question', () => {
  const client = createDatabaseClient({ databasePath });
  const repository = new AssistRepository(client);

  const captureId = repository.saveQuestionCapture({
    questionRowId: 1,
    filePath: '/tmp/capture.png',
    mimeType: 'image/png',
    width: 1180,
    height: 820,
    sha256: 'abc123'
  });

  repository.saveVisionAnalysis({
    questionRowId: 1,
    captureId,
    provider: 'openai',
    model: 'gpt-4.1-mini',
    promptVersion: 'single_choice.v1',
    questionType: 'single_choice',
    questionText: '函数 f(x) 的导数是？',
    options: [{ key: 'A', value: 'x' }],
    suggestedAnswer: 'A',
    confidence: 'medium',
    reasoningSummary: '截图中的选项 A 与题意最匹配。',
    rawResponseJson: '{}'
  });

  expect(repository.getCurrentAnalysisByQuestionId('q-1')).toMatchObject({
    provider: 'openai',
    suggestedAnswer: 'A'
  });
});
```

- [ ] **Step 2: Run the focused database test and verify it fails**

Run: `pnpm vitest run tests/service/database.test.ts`

Expected: FAIL because the schema and repository methods do not exist.

- [ ] **Step 3: Add the new SQLite tables**

```ts
export const questionCapturesTable = sqliteTable('question_captures', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  sourceType: text('source_type').notNull(),
  filePath: text('file_path').notNull(),
  mimeType: text('mime_type').notNull(),
  width: integer('width'),
  height: integer('height'),
  sha256: text('sha256'),
  createdAt: text('created_at').notNull()
});

export const visionAnalysesTable = sqliteTable('vision_analyses', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionRowId: integer('question_row_id').notNull(),
  captureId: integer('capture_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  promptVersion: text('prompt_version').notNull(),
  questionType: text('question_type').notNull(),
  questionText: text('question_text').notNull(),
  optionsJson: text('options_json').notNull(),
  suggestedAnswerJson: text('suggested_answer_json'),
  confidence: text('confidence').notNull(),
  reasoningSummary: text('reasoning_summary').notNull(),
  rawResponseJson: text('raw_response_json').notNull(),
  createdAt: text('created_at').notNull(),
  isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true)
});
```

- [ ] **Step 4: Extend migration bootstrap SQL**

```sql
CREATE TABLE IF NOT EXISTS question_captures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_row_id INTEGER NOT NULL,
  source_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  sha256 TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS vision_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_row_id INTEGER NOT NULL,
  capture_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  question_type TEXT NOT NULL,
  question_text TEXT NOT NULL,
  options_json TEXT NOT NULL,
  suggested_answer_json TEXT,
  confidence TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  raw_response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1
);
```

- [ ] **Step 5: Add repository save/query helpers**

```ts
saveQuestionCapture(input: QuestionCaptureRecord) {
  const insert = this.database.db.insert(questionCapturesTable).values({
    ...input,
    sourceType: 'runtime_question',
    createdAt: new Date().toISOString()
  }).run();
  return Number(insert.lastInsertRowid);
}

saveVisionAnalysis(input: VisionAnalysisRecord) {
  this.database.db
    .update(visionAnalysesTable)
    .set({ isCurrent: false })
    .where(eq(visionAnalysesTable.questionRowId, input.questionRowId))
    .run();

  this.database.db.insert(visionAnalysesTable).values({
    ...input,
    optionsJson: JSON.stringify(input.options),
    suggestedAnswerJson: input.suggestedAnswer ? JSON.stringify(input.suggestedAnswer) : null,
    createdAt: new Date().toISOString(),
    isCurrent: true
  }).run();
}
```

- [ ] **Step 6: Re-run the focused database test**

Run: `pnpm vitest run tests/service/database.test.ts`

Expected: PASS

- [ ] **Step 7: Commit the persistence layer**

```bash
git add apps/service/src/db/schema.ts apps/service/src/db/client.ts apps/service/src/db/assist-repository.ts apps/service/src/assist/assist-types.ts tests/service/database.test.ts
git commit -m "feat: persist question captures and vision analyses"
```

### Task 2: Add Local Prompt Templates and Provider Abstraction

**Files:**
- Modify: `packages/core/src/prompt.ts`
- Create: `apps/service/prompts/vision/single_choice.txt`
- Create: `apps/service/prompts/vision/multiple_choice.txt`
- Create: `apps/service/src/assist/vision-analysis-service.ts`
- Create: `apps/service/src/assist/providers/openai-compatible.ts`
- Create: `apps/service/src/assist/providers/openai-provider.ts`
- Create: `apps/service/src/assist/providers/qwen-vl-provider.ts`
- Test: `tests/service/assist-routes.test.ts`

- [ ] **Step 1: Write the failing assist-route test for normalized analysis output**

```ts
expect(analysisResponse.json()).toMatchObject({
  provider: 'openai',
  questionType: 'single_choice',
  questionText: '你确定来上课了吗',
  suggestedAnswer: 'A',
  confidence: 'medium',
  reasoningSummary: expect.any(String)
});
```

- [ ] **Step 2: Run the focused assist-route test and verify it fails**

Run: `pnpm vitest run tests/service/assist-routes.test.ts`

Expected: FAIL because analysis types, prompt loading, and provider endpoints do not exist.

- [ ] **Step 3: Add prompt-builder helpers**

```ts
export type VisionPromptType = 'single_choice' | 'multiple_choice';

export function buildVisionPrompt(type: VisionPromptType, screenshotHint: string): string {
  return [`Question type: ${type}`, screenshotHint].join('\n\n');
}
```

- [ ] **Step 4: Add local prompt template files**

```text
You are a question analysis assistant.
Return valid JSON only.

Required keys:
- question_type
- question_text
- options
- suggested_answer
- confidence
- reasoning_summary
```

- [ ] **Step 5: Implement provider abstraction**

```ts
export interface VisionProvider {
  analyze(input: {
    imagePath: string;
    prompt: string;
  }): Promise<NormalizedVisionAnalysis>;
}
```

```ts
export async function analyzeQuestionImage(args: AnalyzeImageArgs) {
  const prompt = loadPromptTemplate(args.questionType);
  const provider = createVisionProvider(args.provider, args.config);
  return provider.analyze({
    imagePath: args.imagePath,
    prompt
  });
}
```

- [ ] **Step 6: Add OpenAI and Qwen-VL providers**

```ts
const response = await fetch(config.baseUrl, {
  method: 'POST',
  headers: {
    authorization: `Bearer ${config.apiKey}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify(payload)
});
```

- [ ] **Step 7: Re-run the focused assist-route test**

Run: `pnpm vitest run tests/service/assist-routes.test.ts`

Expected: PASS with mocked provider responses

- [ ] **Step 8: Commit the prompt/provider layer**

```bash
git add packages/core/src/prompt.ts apps/service/prompts/vision/single_choice.txt apps/service/prompts/vision/multiple_choice.txt apps/service/src/assist/vision-analysis-service.ts apps/service/src/assist/providers/openai-compatible.ts apps/service/src/assist/providers/openai-provider.ts apps/service/src/assist/providers/qwen-vl-provider.ts tests/service/assist-routes.test.ts
git commit -m "feat: add vision prompt templates and providers"
```

### Task 3: Add Assist Endpoints for Stored Capture and Analysis

**Files:**
- Modify: `apps/service/src/routes/assist.ts`
- Modify: `apps/service/src/assist/ocr-service.ts`
- Test: `tests/service/assist-routes.test.ts`

- [ ] **Step 1: Write the failing route test**

```ts
const captureResponse = await app.inject({ method: 'GET', url: '/assist/capture/q-1' });
const analysisResponse = await app.inject({
  method: 'POST',
  url: '/assist/analyze-image',
  payload: { questionId: 'q-1', provider: 'openai' }
});

expect(captureResponse.json()).toMatchObject({
  filePath: expect.stringContaining('/data/captures/')
});
expect(analysisResponse.json()).toMatchObject({
  provider: 'openai'
});
```

- [ ] **Step 2: Run the focused assist-route test and verify it fails**

Run: `pnpm vitest run tests/service/assist-routes.test.ts`

Expected: FAIL because the endpoints do not exist.

- [ ] **Step 3: Persist screenshot metadata on `/assist/ocr`**

```ts
const ocrId = assistRepository.saveOcrResult(currentQuestion.id, result);
const captureId = assistRepository.saveQuestionCapture({
  questionRowId: currentQuestion.id,
  filePath: result.savedImagePath!,
  mimeType: screenshot?.mimeType ?? 'image/png',
  width: null,
  height: null,
  sha256: null
});
```

- [ ] **Step 4: Add analysis and query endpoints**

```ts
app.post('/assist/analyze-image', async (request) => {
  const { questionId, provider } = request.body as { questionId: string; provider: 'openai' | 'qwen_vl' };
  return visionAnalysisService.analyzeCurrentQuestion({ questionId, provider });
});

app.get('/assist/capture/:questionId', async (request) => {
  return assistRepository.getLatestCaptureByQuestionId((request.params as { questionId: string }).questionId);
});

app.get('/assist/analysis/:questionId', async (request) => {
  return assistRepository.getCurrentAnalysisByQuestionId((request.params as { questionId: string }).questionId);
});
```

- [ ] **Step 5: Re-run the focused assist-route test**

Run: `pnpm vitest run tests/service/assist-routes.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the assist API**

```bash
git add apps/service/src/routes/assist.ts apps/service/src/assist/ocr-service.ts tests/service/assist-routes.test.ts
git commit -m "feat: add screenshot and vision analysis endpoints"
```

### Task 4: Show Capture and Analysis Results in the Dashboard

**Files:**
- Modify: `apps/web/src/lib/api.ts`
- Modify: `apps/web/src/App.vue`
- Test: `tests/web/app.test.ts`

- [ ] **Step 1: Write the failing web test**

```ts
expect(wrapper.text()).toContain('题目截图');
expect(wrapper.text()).toContain('建议答案');
expect(wrapper.text()).toContain('reasoning_summary');
```

- [ ] **Step 2: Run the focused web test and verify it fails**

Run: `pnpm vitest run tests/web/app.test.ts`

Expected: FAIL because capture/analysis UI does not exist.

- [ ] **Step 3: Add API client types**

```ts
export type QuestionCapture = {
  filePath: string;
  mimeType: string;
  createdAt: string;
};

export type VisionAnalysis = {
  provider: 'openai' | 'qwen_vl';
  questionType: string;
  questionText: string;
  options: Array<{ key: string; value: string }>;
  suggestedAnswer: string | string[] | null;
  confidence: 'low' | 'medium' | 'high';
  reasoningSummary: string;
};
```

- [ ] **Step 4: Render current screenshot and current analysis**

```vue
<article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">题目截图</p>
  <p class="mt-2 text-sm text-shell-700">{{ capture?.filePath ?? '暂无截图' }}</p>
</article>

<article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">建议答案</p>
  <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">{{ analysis?.suggestedAnswer ?? '待分析' }}</strong>
  <p class="mt-2 text-sm text-shell-700">{{ analysis?.reasoningSummary ?? '暂无分析结果' }}</p>
</article>
```

- [ ] **Step 5: Re-run the focused web test**

Run: `pnpm vitest run tests/web/app.test.ts`

Expected: PASS

- [ ] **Step 6: Commit the dashboard view**

```bash
git add apps/web/src/lib/api.ts apps/web/src/App.vue tests/web/app.test.ts
git commit -m "feat: show stored captures and vision results"
```

### Task 5: Final Verification

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
git commit -m "chore: verify ai vision storage pipeline"
```
