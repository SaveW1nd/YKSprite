import type { FastifyInstance } from 'fastify';
import type { AutoplayDebugTraceStore } from '../debug/autoplay-debug-trace.js';

export const registerAutoplayDebugTraceRoutes = (app: FastifyInstance, traceStore: AutoplayDebugTraceStore) => {
  app.get('/debug/autoplay-trace', async (request) => {
    const query = request.query as { afterId?: string; limit?: string };
    const afterId = Number(query.afterId ?? 0);
    const limit = Number(query.limit ?? 100);

    return {
      events: traceStore.list({
        afterId: Number.isFinite(afterId) ? afterId : 0,
        limit: Number.isFinite(limit) ? limit : 100
      })
    };
  });
};
