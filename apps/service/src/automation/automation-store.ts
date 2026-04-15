export type TaskType =
  | 'browser_boot'
  | 'session_attach'
  | 'runtime_scan'
  | 'question_extract'
  | 'ocr_extract'
  | 'draft_generate';

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type TaskRecord = {
  id: string;
  type: TaskType;
  status: TaskStatus;
  startedAt: string;
  finishedAt: string | null;
  lastError: string | null;
  attempt: number;
  payloadSummary: string;
};

export type EventRecord = {
  id: string;
  level: 'info' | 'alert' | 'live';
  title: string;
  description: string;
  time: string;
};

type RetryAction = () => Promise<unknown>;

export class AutomationStore {
  constructor(
    private readonly repository?: {
      listTasks(): TaskRecord[];
      getTask(id: string): TaskRecord | null | undefined;
      upsertTask(task: TaskRecord): void;
      listEvents(): EventRecord[];
      addEvent(event: EventRecord): void;
    }
  ) {
    this.taskSeq = this.nextSequence(this.repository?.listTasks().map((task) => task.id) ?? []);
    this.eventSeq = this.nextSequence(this.repository?.listEvents().map((event) => event.id) ?? []);
  }

  private readonly retryActions = new Map<string, RetryAction>();
  private taskSeq = 1;
  private eventSeq = 1;

  listTasks() {
    return this.repository ? this.repository.listTasks() : [];
  }

  getTask(id: string) {
    return this.repository?.getTask(id) ?? null;
  }

  listEvents() {
    return this.repository ? this.repository.listEvents() : [];
  }

  async executeTask<T>(type: TaskType, payloadSummary: string, operation: RetryAction): Promise<T> {
    const task: TaskRecord = {
      id: `task-${this.taskSeq++}`,
      type,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null,
      attempt: 1,
      payloadSummary
    };
    this.repository?.upsertTask(task);
    this.retryActions.set(task.id, operation);
    this.recordEvent('live', `Task ${type} started`, payloadSummary);

    try {
      const result = (await operation()) as T;
      task.status = 'succeeded';
      task.finishedAt = new Date().toISOString();
      this.repository?.upsertTask(task);
      this.recordEvent('info', `Task ${type} succeeded`, payloadSummary);
      return result;
    } catch (error) {
      task.status = 'failed';
      task.finishedAt = new Date().toISOString();
      task.lastError = error instanceof Error ? error.message : 'Unknown automation error';
      this.repository?.upsertTask(task);
      this.recordEvent('alert', `Task ${type} failed`, task.lastError);
      throw error;
    }
  }

  async retryTask(id: string): Promise<TaskRecord | null> {
    const source = this.getTask(id);
    const retryAction = this.retryActions.get(id);
    if (!source || !retryAction) {
      return null;
    }

    const retryTask: TaskRecord = {
      ...source,
      id: `task-${this.taskSeq++}`,
      status: 'running',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      lastError: null,
      attempt: source.attempt + 1
    };
    this.repository?.upsertTask(retryTask);
    this.retryActions.set(retryTask.id, retryAction);
    this.recordEvent('live', `Task ${source.type} retried`, source.payloadSummary);

    try {
      await retryAction();
      retryTask.status = 'succeeded';
      retryTask.finishedAt = new Date().toISOString();
      this.repository?.upsertTask(retryTask);
      return retryTask;
    } catch (error) {
      retryTask.status = 'failed';
      retryTask.finishedAt = new Date().toISOString();
      retryTask.lastError = error instanceof Error ? error.message : 'Unknown automation error';
      this.repository?.upsertTask(retryTask);
      return retryTask;
    }
  }

  recordEvent(level: EventRecord['level'], title: string, description: string) {
    this.repository?.addEvent({
      id: `event-${this.eventSeq++}`,
      level,
      title,
      description,
      time: new Date().toISOString()
    });
  }

  private nextSequence(ids: string[]) {
    const max = ids.reduce((highest, id) => {
      const match = id.match(/(\d+)$/);
      return match ? Math.max(highest, Number(match[1])) : highest;
    }, 0);

    return max + 1;
  }
}
