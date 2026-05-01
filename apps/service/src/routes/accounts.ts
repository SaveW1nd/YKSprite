import type { FastifyInstance } from 'fastify';
import { AccountRepository, type ManagedAccountStatus } from '../db/account-repository.js';
import type { AccountMonitorManager } from '../monitors/account-monitor-manager.js';
import type { AccountLoginController } from '../browser/account-login-controller.js';
import { AccountEventHub } from './account-events.js';

export const registerAccountRoutes = (
  app: FastifyInstance,
  accountRepository: AccountRepository,
  accountMonitorManager: AccountMonitorManager,
  accountLoginController: AccountLoginController,
  accountEventHub: AccountEventHub
) => {
  app.get('/accounts', async (request) => {
    const query = request.query as {
      q?: string;
      platform?: string;
      status?: ManagedAccountStatus;
    };

    return accountRepository.list({
      q: query.q?.trim() || undefined,
      platform: query.platform?.trim() || undefined,
      status: query.status || undefined
    }).map((account) => ({
      ...account,
      ...accountMonitorManager.getSnapshot(account.id)
    }));
  });

  app.get('/accounts/stream', async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    });
    reply.raw.write(`event: ready\ndata: {"type":"ready"}\n\n`);

    const unsubscribe = accountEventHub.subscribe((event) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) {
        return;
      }

      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    });

    request.raw.on('close', () => {
      unsubscribe();
      if (!reply.raw.writableEnded) {
        reply.raw.end();
      }
    });
  });

  app.post('/accounts/login/start', async (request, reply) => {
    const body = (request.body as { platform?: string } | undefined) ?? {};

    try {
      return await accountLoginController.startAccountLogin({
        platform: body.platform?.trim() || undefined
      });
    } catch (error) {
      reply.code(500);
      return {
        message: error instanceof Error ? error.message : 'Failed to start account login'
      };
    }
  });

  app.get('/accounts/login/:sessionId/status', async (request, reply) => {
    const sessionId = String((request.params as { sessionId: string }).sessionId || '').trim();
    if (!sessionId) {
      reply.code(400);
      return { message: 'Invalid login session id' };
    }

    const loginState = await accountLoginController.getAccountLoginState(sessionId);
    if (loginState.status === 'completed' && loginState.accountId) {
      accountEventHub.publish({
        type: 'accounts_changed',
        accountId: loginState.accountId
      });
    }
    if (loginState.status !== 'idle') {
      return loginState;
    }

    reply.code(404);
    return { message: 'Login session not found' };
  });

  app.post('/accounts/login/:sessionId/stop', async (request, reply) => {
    const sessionId = String((request.params as { sessionId: string }).sessionId || '').trim();
    if (!sessionId) {
      reply.code(400);
      return { message: 'Invalid login session id' };
    }

    return accountLoginController.stopAccountLogin(sessionId);
  });

  app.patch('/accounts/:id/monitoring', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const enabled = Boolean((request.body as { enabled?: boolean } | undefined)?.enabled);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { message: 'Invalid account id' };
    }

    const account = await accountMonitorManager.setMonitoringEnabled(id, enabled);
    if (!account) {
      reply.code(404);
      return { message: 'Account not found' };
    }

    accountEventHub.publish({
      type: 'accounts_changed',
      accountId: id
    });
    return {
      ...account,
      ...accountMonitorManager.getSnapshot(id)
    };
  });

  app.patch('/accounts/:id/active-lesson-enter-delay', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    const delayMs = Number((request.body as { delayMs?: number } | undefined)?.delayMs);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { message: 'Invalid account id' };
    }
    if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 300_000) {
      reply.code(400);
      return { message: 'Invalid enter delay' };
    }

    const account = await accountMonitorManager.setActiveLessonEnterDelayMs(id, delayMs);
    if (!account) {
      reply.code(404);
      return { message: 'Account not found' };
    }

    accountEventHub.publish({
      type: 'accounts_changed',
      accountId: id
    });
    return {
      ...account,
      ...accountMonitorManager.getSnapshot(id)
    };
  });

  app.delete('/accounts/:id', async (request, reply) => {
    const id = Number((request.params as { id: string }).id);
    if (!Number.isFinite(id)) {
      reply.code(400);
      return { message: 'Invalid account id' };
    }

    const account = accountRepository.getById(id);
    if (!account) {
      reply.code(404);
      return { message: 'Account not found' };
    }

    await accountMonitorManager.deleteAccount(id);
    accountEventHub.publish({
      type: 'accounts_changed',
      accountId: id
    });
    reply.code(204);
    return null;
  });
};
