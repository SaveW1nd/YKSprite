import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { BrowserManager } from './browser/browser-manager.js';
import type { BrowserController } from './browser/browser-controller.js';
import { AutomationStore } from './automation/automation-store.js';
import { SessionStore } from './browser/session-store.js';
import { createDatabaseClient } from './db/client.js';
import { AssistRepository } from './db/assist-repository.js';
import { RuntimeRepository } from './db/runtime-repository.js';
import { SessionRepository } from './db/session-repository.js';
import { TaskRepository } from './db/task-repository.js';
import { registerAssistRoutes } from './routes/assist.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerBrowserRoutes } from './routes/browser.js';
import { registerHealthRoute } from './routes/health.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
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
  const databaseClient = createDatabaseClient();
  const sessionRepository = new SessionRepository(databaseClient);
  const taskRepository = new TaskRepository(databaseClient);
  const runtimeRepository = new RuntimeRepository(databaseClient);
  const assistRepository = new AssistRepository(databaseClient);
  const browserController =
    options.browserController ??
    new BrowserManager({
      sessionStore: new SessionStore({ repository: sessionRepository })
    });
  const automationStore = new AutomationStore(taskRepository);

  registerHealthRoute(app);
  registerBrowserRoutes(app, browserController);
  registerRuntimeRoutes(app, browserController, runtimeRepository);
  registerAssistRoutes(app, browserController, automationStore, runtimeRepository, assistRepository);
  registerAutomationRoutes(app, automationStore);
  registerWebShellRoutes(app, options.webDistDir ?? defaultWebDistDir());

  return app;
};
