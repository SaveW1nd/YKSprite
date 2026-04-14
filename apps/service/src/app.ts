import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { registerHealthRoute } from './routes/health.js';
import { registerWebShellRoutes } from './routes/web-shell.js';

type BuildServiceAppOptions = {
  webDistDir?: string;
};

const defaultWebDistDir = () => {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(currentDir, '../../web/dist');
};

export const buildServiceApp = (options: BuildServiceAppOptions = {}) => {
  const app = Fastify({
    logger: false
  });

  registerHealthRoute(app);
  registerWebShellRoutes(app, options.webDistDir ?? defaultWebDistDir());

  return app;
};
