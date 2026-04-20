import type { FastifyInstance } from 'fastify';
import type { ApiConfigService } from '../api-config/api-config-service.js';

export const registerApiConfigRoutes = (app: FastifyInstance, apiConfigService: ApiConfigService) => {
  app.get('/api-config', async () => apiConfigService.getSnapshot());

  app.post('/api-config/qwen-keys', async (request, reply) => {
    const body = (request.body as { name?: string; apiKey?: string } | undefined) ?? {};
    const name = body.name?.trim() ?? '';
    const apiKey = body.apiKey?.trim() ?? '';

    if (!name || !apiKey) {
      reply.code(400);
      return { message: 'name and apiKey are required' };
    }

    return apiConfigService.addQwenKey({ name, apiKey });
  });

  app.patch('/api-config/qwen-keys/:id/enable', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);

    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { message: 'invalid key id' };
    }

    try {
      return apiConfigService.enableQwenKey(id);
    } catch (error) {
      reply.code(404);
      return { message: error instanceof Error ? error.message : 'Qwen API key not found' };
    }
  });

  app.delete('/api-config/qwen-keys/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);

    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { message: 'invalid key id' };
    }

    try {
      return apiConfigService.deleteQwenKey(id);
    } catch (error) {
      reply.code(404);
      return { message: error instanceof Error ? error.message : 'Qwen API key not found' };
    }
  });
};
