import type { FastifyInstance } from 'fastify';
import type { BrowserController } from '../browser/browser-controller.js';

export const registerBrowserRoutes = (app: FastifyInstance, browserController: BrowserController) => {
  app.get('/browser', async () => {
    return browserController.getStatus();
  });

  app.post('/browser/start', async () => {
    return browserController.start();
  });

  app.post('/browser/stop', async () => {
    return browserController.stop();
  });
};
