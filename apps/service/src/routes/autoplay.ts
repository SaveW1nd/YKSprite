import type { FastifyInstance } from 'fastify';
import type { AutoAnswerService } from '../auto-answer/auto-answer-service.js';

export const registerAutoplayRoutes = (app: FastifyInstance, autoAnswerService: AutoAnswerService) => {
  app.post('/autoplay/start', async () => {
    return autoAnswerService.start();
  });

  app.post('/autoplay/stop', async () => {
    return autoAnswerService.stop();
  });

  app.get('/autoplay/status', async () => {
    return autoAnswerService.getStatus();
  });

  app.get('/autoplay/runs', async () => {
    return autoAnswerService.listRuns();
  });

  app.get('/autoplay/runs/:id', async (request, reply) => {
    const detail = autoAnswerService.getRunDetail((request.params as { id: string }).id);
    if (!detail) {
      reply.code(404);
      return {
        message: 'Autoplay run not found'
      };
    }
    return detail;
  });
};
