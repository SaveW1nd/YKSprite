import type { FastifyInstance } from 'fastify';
import type { BrowserController } from '../browser/browser-controller.js';

export const registerBrowserRoutes = (app: FastifyInstance, browserController: BrowserController) => {
  app.get('/browser', async () => {
    return browserController.getStatus();
  });

  app.post('/browser/start', async () => {
    return browserController.start();
  });

  app.post('/browser/login/start', async () => {
    return browserController.startLogin();
  });

  app.post('/browser/stop', async () => {
    return browserController.stop();
  });

  app.get('/browser/session', async () => {
    return browserController.getSessionState();
  });

  app.post('/browser/session/save', async () => {
    return browserController.saveSession();
  });

  app.post<{ Body: { url: string } }>('/browser/navigate', async (request) => {
    return browserController.navigate(request.body.url);
  });
};
