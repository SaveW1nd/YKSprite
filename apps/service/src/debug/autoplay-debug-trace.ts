type AutoplayDebugTraceEventType =
  | 'classroom_detected'
  | 'classroom_entered'
  | 'lesson_checkin'
  | 'timeline_fetch'
  | 'presentation_fetch'
  | 'question_resolved'
  | 'question_collect_started'
  | 'question_collect_ready'
  | 'question_collect_failed'
  | 'question_ws_failed'
  | 'ai_prompt'
  | 'ai_request_started'
  | 'ai_request_failed'
  | 'ai_response'
  | 'submit_payload'
  | 'submit_result';

type AutoplayDebugTraceEvent = {
  id: number;
  at: string;
  type: AutoplayDebugTraceEventType;
  message: string;
  data: Record<string, unknown>;
};

type AutoplayDebugTraceStoreOptions = {
  maxEntries?: number;
};

export class AutoplayDebugTraceStore {
  private readonly maxEntries: number;
  private readonly events: AutoplayDebugTraceEvent[] = [];
  private nextId = 1;

  constructor(options: AutoplayDebugTraceStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 500;
  }

  record(type: AutoplayDebugTraceEventType, message: string, data: Record<string, unknown> = {}) {
    const event: AutoplayDebugTraceEvent = {
      id: this.nextId++,
      at: new Date().toISOString(),
      type,
      message,
      data
    };

    this.events.push(event);
    if (this.events.length > this.maxEntries) {
      this.events.splice(0, this.events.length - this.maxEntries);
    }

    return event;
  }

  list(options: { afterId?: number; limit?: number } = {}) {
    const afterId = options.afterId ?? 0;
    const limit = Math.max(1, options.limit ?? 100);
    return this.events.filter((event) => event.id > afterId).slice(0, limit);
  }
}
