import type { FastifyInstance } from 'fastify';
import type { AutoplayMonitorService } from '../auto-answer/autoplay-monitor-service.js';

export const registerAutoplayMonitorRoutes = (app: FastifyInstance, autoplayMonitorService: AutoplayMonitorService) => {
  app.post('/autoplay/monitor/start', async () => {
    return autoplayMonitorService.start();
  });

  app.post('/autoplay/monitor/stop', async () => {
    return autoplayMonitorService.stop();
  });

  app.get('/autoplay/monitor/status', async () => {
    return autoplayMonitorService.getStatus();
  });
};
