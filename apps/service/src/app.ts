import Fastify from 'fastify';
import { registerHealthRoute } from './routes/health.js';

export const buildServiceApp = () => {
  const app = Fastify({
    logger: false
  });

  registerHealthRoute(app);

  return app;
};
