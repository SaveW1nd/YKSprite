import type { FastifyInstance } from 'fastify';
import type { ApiConfigService } from '../api-config/api-config-service.js';

type ApiConfigRoutesOptions = {
  onQwenRuntimeConfigChanged?: () => void | Promise<void>;
  onApiConfigChanged?: () => void | Promise<void>;
};

export const registerApiConfigRoutes = (
  app: FastifyInstance,
  apiConfigService: ApiConfigService,
  options: ApiConfigRoutesOptions = {}
) => {
  app.get('/api-config', async () => apiConfigService.getSnapshot());

  app.post('/api-config/qwen-keys', async (request, reply) => {
    const body = (request.body as { name?: string; apiKey?: string } | undefined) ?? {};
    const name = body.name?.trim() ?? '';
    const apiKey = body.apiKey?.trim() ?? '';

    if (!name || !apiKey) {
      reply.code(400);
      return { message: 'name and apiKey are required' };
    }

    const result = await apiConfigService.addQwenKey({ name, apiKey });
    await options.onApiConfigChanged?.();
    if (result.check.status === 'success' && result.check.activated) {
      await options.onQwenRuntimeConfigChanged?.();
    }
    return result;
  });

  app.patch('/api-config/qwen-keys/:id/enable', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);

    if (!Number.isInteger(id) || id <= 0) {
      reply.code(400);
      return { message: 'invalid key id' };
    }

    try {
      const result = await apiConfigService.enableQwenKey(id);
      await options.onApiConfigChanged?.();
      if (result.check.status === 'success' && result.check.activated) {
        await options.onQwenRuntimeConfigChanged?.();
      }
      return result;
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
      const result = apiConfigService.deleteQwenKey(id);
      await options.onApiConfigChanged?.();
      return result;
    } catch (error) {
      reply.code(404);
      return { message: error instanceof Error ? error.message : 'Qwen API key not found' };
    }
  });
};
