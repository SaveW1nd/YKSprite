import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { BrowserManager } from './browser/browser-manager.js';
import type { BrowserController } from './browser/browser-controller.js';
import { registerBrowserRoutes } from './routes/browser.js';
import { registerHealthRoute } from './routes/health.js';
import { registerWebShellRoutes } from './routes/web-shell.js';

type BuildServiceAppOptions = {
  browserController?: BrowserController;
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
  const browserController = options.browserController ?? new BrowserManager();

  registerHealthRoute(app);
  registerBrowserRoutes(app, browserController);
  registerWebShellRoutes(app, options.webDistDir ?? defaultWebDistDir());

  return app;
};
