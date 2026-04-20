import Fastify from 'fastify';
import { AccountRepository } from './db/account-repository.js';
import { AutoAnswerRepository } from './auto-answer/auto-answer-repository.js';
import { AutoAnswerService } from './auto-answer/auto-answer-service.js';
import { AutoplayMonitorService } from './auto-answer/autoplay-monitor-service.js';
import { QuestionSolveService } from './auto-answer/question-solve-service.js';
import type { BrowserController } from './browser/browser-controller.js';
import { AutomationStore } from './automation/automation-store.js';
import { SessionStore } from './browser/session-store.js';
import { createDatabaseClient } from './db/client.js';
import { AssistRepository } from './db/assist-repository.js';
import { RuntimeRepository } from './db/runtime-repository.js';
import { SessionRepository } from './db/session-repository.js';
import { TaskRepository } from './db/task-repository.js';
import { ApiConfigRepository } from './api-config/api-config-repository.js';
import { ApiConfigService } from './api-config/api-config-service.js';
import { registerAssistRoutes } from './routes/assist.js';
import { registerAccountRoutes } from './routes/accounts.js';
import { registerApiConfigRoutes } from './routes/api-config.js';
import { registerAutomationRoutes } from './routes/automation.js';
import { registerAutoplayDebugTraceRoutes } from './routes/autoplay-debug-trace.js';
import { registerAutoplayRoutes } from './routes/autoplay.js';
import { registerAutoplayMonitorRoutes } from './routes/autoplay-monitor.js';
import { registerHealthRoute } from './routes/health.js';
import { registerRuntimeRoutes } from './routes/runtime.js';
import { VisionAnalysisService, type VisionAnalysisServiceLike } from './assist/vision-analysis-service.js';
import { AutoplayDebugTraceStore } from './debug/autoplay-debug-trace.js';
import { AccountMonitorManager } from './monitors/account-monitor-manager.js';
import { BrowserManager } from './browser/browser-manager.js';
import type { AccountLoginController } from './browser/account-login-controller.js';
import type { FastifyInstance } from 'fastify';
import type { DatabaseClient } from './db/client.js';
import type { BrowserController as AccountMonitorController } from './browser/browser-controller.js';
import type { StoredSession } from './browser/session-store.js';
import { AccountEventHub } from './routes/account-events.js';

type BuildServiceAppOptions = {
  databaseClient?: DatabaseClient;
  browserController?: BrowserController;
  accountLoginController?: AccountLoginController;
  visionAnalysisService?: VisionAnalysisServiceLike;
  debugTraceStore?: AutoplayDebugTraceStore;
  accountMonitorControllerFactory?: (input: {
    accountId: number;
    sessionStore: Pick<{ load(): Promise<StoredSession | null>; save(session: StoredSession): Promise<StoredSession> }, 'load' | 'save'>;
    traceStore: AutoplayDebugTraceStore;
  }) => AccountMonitorController;
};

export type ServiceApp = FastifyInstance & {
  bootstrapSavedSessionAutomation(): Promise<void>;
};

export const buildServiceApp = (options: BuildServiceAppOptions = {}) => {
  const app = Fastify({
    logger: false
  });
  const databaseClient = options.databaseClient ?? createDatabaseClient();
  const accountRepository = new AccountRepository(databaseClient);
  const sessionRepository = new SessionRepository(databaseClient);
  const taskRepository = new TaskRepository(databaseClient);
  const runtimeRepository = new RuntimeRepository(databaseClient);
  const assistRepository = new AssistRepository(databaseClient);
  const autoAnswerRepository = new AutoAnswerRepository(databaseClient);
  const apiConfigRepository = new ApiConfigRepository(databaseClient);
  const apiConfigService = new ApiConfigService(apiConfigRepository);
  const debugTraceStore = options.debugTraceStore ?? new AutoplayDebugTraceStore();
  const accountEventHub = new AccountEventHub();
  const visionAnalysisService = options.visionAnalysisService ?? new VisionAnalysisService(assistRepository, undefined, debugTraceStore);
  const automationStore = new AutomationStore(taskRepository);
  const questionSolveService = new QuestionSolveService(assistRepository, visionAnalysisService);
  let accountMonitorManager: AccountMonitorManager;
  const defaultBrowserManager = new BrowserManager({
    sessionStore: new SessionStore({ repository: sessionRepository }),
    accountRepository,
    traceStore: debugTraceStore,
    onAccountSessionSaved: async (accountId) => {
      await accountMonitorManager.startForAccount(accountId, 'login');
      accountEventHub.publish({
        type: 'accounts_changed',
        accountId
      });
    }
  });
  const browserController =
    options.browserController ??
    defaultBrowserManager;
  accountMonitorManager = new AccountMonitorManager({
    accountRepository,
    runtimeRepository,
    assistRepository,
    autoAnswerRepository,
    questionSolveService,
    automationStore,
    onSnapshotChanged: (accountId) => {
      accountEventHub.publish({
        type: 'accounts_changed',
        accountId
      });
    },
    controllerFactory: options.accountMonitorControllerFactory
  });
  const accountLoginController =
    options.accountLoginController ??
    defaultBrowserManager;
  const autoAnswerService = new AutoAnswerService({
    browserController,
    runtimeRepository,
    assistRepository,
    autoAnswerRepository,
    questionSolveService,
    automationStore,
    traceStore: debugTraceStore
  });
  const autoplayMonitorService = new AutoplayMonitorService({
    autoAnswerService,
    browserController
  });

  registerHealthRoute(app);
  registerAccountRoutes(app, accountRepository, accountMonitorManager, accountLoginController, accountEventHub);
  registerApiConfigRoutes(app, apiConfigService);
  registerRuntimeRoutes(app, browserController, runtimeRepository, automationStore);
  registerAssistRoutes(app, browserController, automationStore, runtimeRepository, assistRepository, visionAnalysisService);
  registerAutomationRoutes(app, automationStore);
  registerAutoplayDebugTraceRoutes(app, debugTraceStore);
  registerAutoplayRoutes(app, autoAnswerService);
  registerAutoplayMonitorRoutes(app, autoplayMonitorService);

  const serviceApp = Object.assign(app, {
    async bootstrapSavedSessionAutomation() {
      await accountMonitorManager.bootstrap();
    }
  }) as ServiceApp;

  serviceApp.addHook('onClose', async () => {
    await accountMonitorManager.stopAll();
    await autoplayMonitorService.stop();
    await accountLoginController.stop().catch(() => undefined);
    databaseClient.close();
  });

  return serviceApp;
};
