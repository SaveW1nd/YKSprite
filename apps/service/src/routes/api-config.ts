import type { FastifyInstance } from 'fastify';
import type { ApiConfigService } from '../api-config/api-config-service.js';
import type { ApiProvider } from '../api-config/api-config-types.js';

export const registerApiConfigRoutes = (app: FastifyInstance, apiConfigService: ApiConfigService) => {
  app.get('/api-config', async () => apiConfigService.getSnapshot());

  app.patch('/api-config/providers/:provider', async (request, reply) => {
    const provider = (request.params as { provider: ApiProvider }).provider;
    const body = (request.body as {
      enabled?: boolean;
      apiKey?: string | null;
      baseUrl?: string | null;
      model?: string | null;
    } | undefined) ?? {};

    if (provider !== 'qwen_vl' && provider !== 'openai') {
      reply.code(400);
      return { message: 'Unsupported provider' };
    }

    return apiConfigService.updateProviderConfig(provider, {
      enabled: body.enabled ?? true,
      apiKey: body.apiKey?.trim() || null,
      baseUrl: body.baseUrl?.trim() || null,
      model: body.model?.trim() || null
    });
  });

  app.patch('/api-config/default-provider', async (request, reply) => {
    const provider = (request.body as { provider?: ApiProvider } | undefined)?.provider;

    if (provider !== 'qwen_vl' && provider !== 'openai') {
      reply.code(400);
      return { message: 'Unsupported provider' };
    }

    return apiConfigService.setDefaultVisionProvider(provider);
  });
};
