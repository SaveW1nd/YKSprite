import type { FastifyInstance } from 'fastify';
import type { AutomationStore } from '../automation/automation-store.js';

export const registerAutomationRoutes = (app: FastifyInstance, automationStore: AutomationStore) => {
  app.get('/tasks', async () => {
    return automationStore.listTasks();
  });

  app.get('/tasks/:id', async (request) => {
    return automationStore.getTask((request.params as { id: string }).id);
  });

  app.post('/tasks/:id/retry', async (request) => {
    return automationStore.retryTask((request.params as { id: string }).id);
  });

  app.get('/events', async () => {
    return automationStore.listEvents();
  });
};
