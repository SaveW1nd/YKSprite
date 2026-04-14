import { FastifyInstance } from 'fastify';

export const registerHealthRoute = (app: FastifyInstance) => {
  app.get('/health', async () => {
    return {
      status: 'ok',
      name: 'YKSprite'
    };
  });
};
