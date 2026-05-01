import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  RainClassroomHttpClient,
  buildCookieHeader,
  extractCookieValue
} from '../../apps/service/src/browser/rain-classroom-http-client';
import { RainClassroomHttpController } from '../../apps/service/src/browser/rain-classroom-http-controller';
import type { BrowserCookie, LessonProblemSubmitPayload } from '../../apps/service/src/browser/browser-controller';

const cookies: BrowserCookie[] = [
  {
    name: 'sessionid',
    value: 'session-value',
    domain: 'www.yuketang.cn',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true
  },
  {
    name: 'csrftoken',
    value: 'csrf-value',
    domain: 'www.yuketang.cn',
    path: '/',
    expires: -1,
    httpOnly: false,
    secure: true
  }
];

class FakeQuestionSocket {
  readonly sent: string[] = [];
  private readonly handlers = new Map<string, (...args: any[]) => void>();

  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, handler);
    if (event === 'open') {
      queueMicrotask(() => handler());
    }
    return this;
  }

  send(payload: string) {
    this.sent.push(payload);
    const parsed = JSON.parse(payload);
    if (parsed.op === 'hello') {
      queueMicrotask(() => {
        this.emitMessage({ op: 'hello', presentation: 'presentation-1', timeline: [] });
      });
    }
    if (parsed.op === 'fetchtimeline') {
      queueMicrotask(() => {
        this.emitMessage({ op: 'fetchtimeline', presentation: 'presentation-1', timeline: [], msgid: parsed.msgid });
      });
    }
  }

  close() {
    this.handlers.get('close')?.();
  }

  emitMessage(payload: Record<string, unknown>) {
    this.handlers.get('message')?.(JSON.stringify(payload));
  }
}

afterEach(() => {
  vi.useRealTimers();
});

describe('RainClassroomHttpClient', () => {
  it('builds a browser-compatible cookie header from saved cookies', () => {
    expect(buildCookieHeader(cookies)).toBe('sessionid=session-value; csrftoken=csrf-value');
    expect(extractCookieValue(cookies, 'csrftoken')).toBe('csrf-value');
  });

  it('captures set-auth from lesson checkin and uses it for presentation fetch and answer submit', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });

      if (String(url).endsWith('/api/v3/lesson/checkin')) {
        return new Response(JSON.stringify({ code: 0, data: { lessonToken: 'lesson-token' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-auth': 'token-from-header'
          }
        });
      }

      if (String(url).includes('/api/v3/lesson/presentation/fetch')) {
        return Response.json({ code: 0, data: { slides: [] } });
      }

      if (String(url).endsWith('/api/v3/lesson/problem/answer')) {
        return Response.json({ code: 0, msg: 'OK' });
      }

      return Response.json({ code: 404 }, { status: 404 });
    };

    const client = new RainClassroomHttpClient({
      originUrl: 'https://www.yuketang.cn',
      cookies,
      fetchFn
    });

    await expect(client.checkInLesson('lesson-1')).resolves.toEqual({
      authorization: 'Bearer token-from-header',
      lessonToken: 'lesson-token'
    });
    await client.fetchPresentation('presentation-1');
    const payload: LessonProblemSubmitPayload = {
      problemId: 'problem-1',
      problemType: 1,
      dt: 1770000000000,
      result: ['A']
    };
    await expect(client.submitProblem(payload, 'https://www.yuketang.cn/lesson/fullscreen/v3/lesson-1')).resolves.toEqual({
      ok: true,
      code: 0,
      message: 'OK',
      responseJson: { code: 0, msg: 'OK' }
    });

    expect(calls).toHaveLength(3);
    expect(calls[0]?.init.body).toBe(JSON.stringify({ source: 5, lessonId: 'lesson-1' }));
    expect(calls[1]?.init.headers).toMatchObject({
      Cookie: 'sessionid=session-value; csrftoken=csrf-value',
      Authorization: 'Bearer token-from-header'
    });
    expect(calls[2]?.init.headers).toMatchObject({
      Cookie: 'sessionid=session-value; csrftoken=csrf-value',
      Authorization: 'Bearer token-from-header',
      'x-csrftoken': 'csrf-value'
    });
  });
});

describe('RainClassroomHttpController classroom detection', () => {
  it('emits classroom start and finish events from the active lesson API', async () => {
    let classroomCalls = 0;
    const fetchFn = async (url: string | URL | Request) => {
      if (!String(url).endsWith('/api/v3/classroom/on-lesson-upcoming-exam')) {
        return Response.json({ code: 0, data: {} });
      }

      classroomCalls += 1;
      const activeLesson =
        classroomCalls <= 2
          ? [
              {
                lessonId: 'lesson-1',
                classroomId: 'classroom-1',
                classroomName: '第一讲',
                courseName: '高等数学'
              }
            ]
          : [];
      return Response.json({ code: 0, data: { onLessonClassrooms: activeLesson } });
    };
    const controller = new RainClassroomHttpController({
      sessionStore: {
        load: async () => ({
          cookies,
          origin: 'www.yuketang.cn',
          savedAt: '2026-04-20T00:00:00.000Z',
          currentUrl: 'https://www.yuketang.cn/v2/web/index',
          pageTitle: '雨课堂',
          mode: 'http'
        }),
        save: async (session) => session
      },
      fetchFn: fetchFn as typeof fetch
    });
    const events: Array<{ eventType: string; lessonId: string; source: string }> = [];

    await controller.startClassroomDetection(async (event) => {
      events.push({
        eventType: event.eventType,
        lessonId: event.lessonId,
        source: event.source
      });
    });
    await controller.discoverLessons();

    expect(events).toEqual([
      { eventType: 'lesson_started', lessonId: 'lesson-1', source: 'http' },
      { eventType: 'lesson_finished', lessonId: 'lesson-1', source: 'http' }
    ]);
  });

  it('waits the configured enter delay before emitting classroom start', async () => {
    vi.useFakeTimers();
    const fetchFn = async (url: string | URL | Request) => {
      if (!String(url).endsWith('/api/v3/classroom/on-lesson-upcoming-exam')) {
        return Response.json({ code: 0, data: {} });
      }

      return Response.json({
        code: 0,
        data: {
          onLessonClassrooms: [
            {
              lessonId: 'lesson-1',
              classroomId: 'classroom-1',
              classroomName: '第一讲',
              courseName: '高等数学'
            }
          ]
        }
      });
    };
    const traceEvents: Array<{ type: string; data: Record<string, unknown> }> = [];
    const controller = new RainClassroomHttpController({
      sessionStore: {
        load: async () => ({
          cookies,
          origin: 'www.yuketang.cn',
          savedAt: '2026-04-20T00:00:00.000Z',
          currentUrl: 'https://www.yuketang.cn/v2/web/index',
          pageTitle: '雨课堂',
          mode: 'http'
        }),
        save: async (session) => session
      },
      fetchFn: fetchFn as typeof fetch,
      activeLessonEnterDelayMs: 2_000,
      traceStore: {
        record: (type, _message, data = {}) => {
          traceEvents.push({ type, data });
          return {
            id: traceEvents.length,
            at: new Date().toISOString(),
            type,
            message: _message,
            data
          };
        }
      }
    });
    const events: Array<{ eventType: string; lessonId: string }> = [];

    const startPromise = controller.startClassroomDetection(async (event) => {
      events.push({
        eventType: event.eventType,
        lessonId: event.lessonId
      });
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(events).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await startPromise;

    expect(events).toEqual([{ eventType: 'lesson_started', lessonId: 'lesson-1' }]);
    expect(traceEvents).toEqual([
      expect.objectContaining({
        type: 'classroom_detected',
        data: expect.objectContaining({
          lessonId: 'lesson-1',
          delayMs: 2_000
        })
      })
    ]);
  });

  it('emits classroom finish from the lesson wsapp stream', async () => {
    const sockets: FakeQuestionSocket[] = [];
    const fetchFn = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith('/api/v3/classroom/on-lesson-upcoming-exam')) {
        return Response.json({
          code: 0,
          data: {
            onLessonClassrooms: [
              {
                lessonId: 'lesson-1',
                classroomId: 'classroom-1',
                classroomName: '第一讲',
                courseName: '高等数学'
              }
            ]
          }
        });
      }
      if (href.endsWith('/api/v3/lesson/checkin')) {
        return new Response(JSON.stringify({ code: 0, data: { lessonToken: 'lesson-token' } }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'set-auth': 'token-from-header'
          }
        });
      }
      if (href.endsWith('/api/v3/user/basic-info')) {
        return Response.json({ code: 0, data: { id: 'user-1' } });
      }
      if (href.endsWith('/api/v3/lesson/presentation/fetch')) {
        return Response.json({ code: 0, data: { slides: [] } });
      }
      return Response.json({ code: 0, data: {} });
    };
    const controller = new RainClassroomHttpController({
      sessionStore: {
        load: async () => ({
          cookies,
          origin: 'www.yuketang.cn',
          savedAt: '2026-04-20T00:00:00.000Z',
          currentUrl: 'https://www.yuketang.cn/v2/web/index',
          pageTitle: '雨课堂',
          mode: 'http'
        }),
        save: async (session) => session
      },
      fetchFn: fetchFn as typeof fetch,
      createQuestionWebSocket: () => {
        const socket = new FakeQuestionSocket();
        sockets.push(socket);
        return socket;
      }
    });
    const events: Array<{ eventType: string; lessonId: string; source: string }> = [];

    await controller.startClassroomDetection(async (event) => {
      events.push({
        eventType: event.eventType,
        lessonId: event.lessonId,
        source: event.source
      });
    });
    await controller.startQuestionDetection(async () => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));

    sockets.at(-1)?.emitMessage({
      op: 'lessonfinished',
      event: {
        title: '下课啦'
      }
    });

    expect(events).toEqual([
      { eventType: 'lesson_started', lessonId: 'lesson-1', source: 'http' },
      { eventType: 'lesson_finished', lessonId: 'lesson-1', source: 'wsapp' }
    ]);
  });
});
