import type {
  DetectedQuestionEvent,
  ExerciseRuntimeState,
  LessonPresentationSlide
} from './browser-controller.js';

export const parseLessonTarget = (url: string) => {
  const lessonMatch = url.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)/);
  const exerciseMatch = url.match(/\/lesson\/fullscreen\/v3\/([^/?#]+)\/(?:exercise|subjective)\/([^/?#]+)/);
  return {
    lessonId: exerciseMatch?.[1] ?? lessonMatch?.[1] ?? null,
    exerciseIndex: exerciseMatch?.[2] ?? null
  };
};

export const buildDetectedQuestionEvent = (
  runtimeState: ExerciseRuntimeState | null,
  input?: {
    source?: 'runtime-state' | 'curr-slide-event' | 'presentation-slide' | 'wsapp-unlockproblem';
    courseTitle?: string | null;
    pageIndex?: number | null;
    presentationId?: string | null;
  }
): DetectedQuestionEvent | null => {
  if (
    !runtimeState?.lessonId ||
    !runtimeState.problemId ||
    !runtimeState.problemType ||
    runtimeState.isComplete
  ) {
    return null;
  }

  return {
    lessonId: runtimeState.lessonId,
    courseTitle: input?.courseTitle ?? null,
    problemId: runtimeState.problemId,
    problemType: runtimeState.problemType,
    exerciseIndex: runtimeState.exerciseIndex ?? null,
    routePath: runtimeState.routePath ?? null,
    isComplete: runtimeState.isComplete,
    imageUrl: runtimeState.imageUrl ?? null,
    detectedAt: new Date().toISOString(),
    presentationId: input?.presentationId ?? null,
    pageIndex: input?.pageIndex ?? runtimeState.pageIndex ?? null,
    source: input?.source ?? 'runtime-state'
  };
};

export const parseOptionalString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);

export const parseOptionalNumber = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const parseOptionalBoolean = (value: unknown) => {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return null;
    }

    if (['true', '1', 'yes', 'done', 'finished', 'completed', 'answered', '已完成'].includes(normalized)) {
      return true;
    }

    if (['false', '0', 'no', 'pending', 'unanswered', '未完成'].includes(normalized)) {
      return false;
    }
  }

  return null;
};

const normalizeOptionList = (value: unknown) => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((option) => {
      if (typeof option === 'string') {
        const text = option.trim();
        return text ? { key: text, value: text } : null;
      }

      if (option && typeof option === 'object') {
        const record = option as Record<string, unknown>;
        const key = parseOptionalString(record.key) ?? parseOptionalString(record.label) ?? parseOptionalString(record.id) ?? '';
        const resolvedValue =
          parseOptionalString(record.value) ??
          parseOptionalString(record.label) ??
          parseOptionalString(record.text) ??
          parseOptionalString(record.key) ??
          '';
        return key || resolvedValue ? { key, value: resolvedValue } : null;
      }

      return null;
    })
    .filter((option): option is { key: string; value: string } => Boolean(option));
};

export const buildRuntimeStateFromPresentationSlide = (
  lessonId: string,
  slide: NonNullable<LessonPresentationSlide>,
  defaultPageIndex = 0
): ExerciseRuntimeState | null => {
  const raw = slide.raw && typeof slide.raw === 'object' ? (slide.raw as Record<string, unknown>) : {};
  const problem = raw.problem && typeof raw.problem === 'object' ? (raw.problem as Record<string, unknown>) : {};
  const exerciseIndex = slide.exerciseIndex ?? (slide.pageIndex !== null ? String(slide.pageIndex) : null);
  const problemId =
    slide.problemId ??
    parseOptionalString(problem.problemId) ??
    parseOptionalString(problem.problemID) ??
    parseOptionalString(raw.problemID) ??
    parseOptionalString(raw.problemId);
  const problemType =
    slide.problemType ??
    parseOptionalNumber(problem.problemType) ??
    parseOptionalNumber(raw.problemType) ??
    parseOptionalNumber(raw.type) ??
    null;
  if (!exerciseIndex || !problemId || !problemType) {
    return null;
  }

  const isSubjective = problemType === 5;
  return {
    lessonId,
    exerciseIndex,
    problemId,
    problemType,
    pageIndex: slide.pageIndex ?? parseOptionalNumber(raw.page) ?? parseOptionalNumber(raw.index) ?? defaultPageIndex,
    questionText:
      parseOptionalString(problem.body) ??
      parseOptionalString(raw.questionText) ??
      parseOptionalString(raw.body) ??
      parseOptionalString(raw.title) ??
      parseOptionalString(raw.stem) ??
      '',
    options: normalizeOptionList(problem.options ?? raw.options ?? raw.optionList ?? raw.choices),
    imageUrl: slide.imageUrl ?? slide.imageThumbnailUrl ?? null,
    imageThumbnailUrl: slide.imageThumbnailUrl ?? slide.imageUrl ?? null,
    isComplete: Boolean(
      parseOptionalBoolean(problem.isComplete) ??
        parseOptionalBoolean(problem.completed) ??
        parseOptionalBoolean(problem.finished) ??
        parseOptionalBoolean(raw.isComplete) ??
        parseOptionalBoolean(raw.completed) ??
        parseOptionalBoolean(raw.finished) ??
        /answered|done|finished|completed|已完成/i.test(
          parseOptionalString(problem.status) ??
            parseOptionalString(problem.answerStatus) ??
            parseOptionalString(raw.status) ??
            parseOptionalString(raw.answerStatus) ??
            parseOptionalString(raw.state) ??
            ''
        )
    ),
    routePath: `/lesson/fullscreen/v3/${lessonId}/${isSubjective ? 'subjective' : 'exercise'}/${exerciseIndex}`
  };
};
