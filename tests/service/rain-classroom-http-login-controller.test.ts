import { describe, expect, it, vi } from 'vitest';
import { RainClassroomHttpLoginController } from '../../apps/service/src/browser/rain-classroom-http-login-controller';
import { createDatabaseClient } from '../../apps/service/src/db/client';
import { AccountRepository } from '../../apps/service/src/db/account-repository';

describe('RainClassroomHttpLoginController', () => {
  it('logs in through QR HTTP polling and persists the returned session', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const accountRepository = new AccountRepository(databaseClient);
    const onAccountSessionSaved = vi.fn();
    const fetchCalls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      fetchCalls.push(target);

      if (target === 'https://www.yuketang.cn/api/v3/user/login/wechat-auth-param') {
        return Response.json({
          code: 0,
          data: {
            appId: 'wx-app',
            state: 'state-token',
            redirectUri: 'https://www.yuketang.cn/api/v3/user/login/wechat-web-callback'
          }
        });
      }

      if (target.startsWith('https://open.weixin.qq.com/connect/qrconnect?')) {
        return new Response(
          '<script>var fordevtool = "https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=uuid-1"</script><img class="js_qrcode_img web_qrcode_img" src="/connect/qrcode/uuid-1">',
          {
            headers: {
              'content-type': 'text/html; charset=utf-8'
            }
          }
        );
      }

      if (target === 'https://open.weixin.qq.com/connect/qrcode/uuid-1') {
        return new Response(Buffer.from('fake-image'), {
          headers: {
            'content-type': 'image/jpeg'
          }
        });
      }

      if (target.startsWith('https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=uuid-1')) {
        return new Response("window.wx_errcode=405;window.wx_code='wx-code-1';", {
          headers: {
            'content-type': 'application/javascript'
          }
        });
      }

      if (target.startsWith('https://www.yuketang.cn/api/v3/user/login/wechat-web-callback?')) {
        return new Response('ok', {
          status: 200,
          headers: {
            'set-cookie': 'sessionid=session-value; Path=/; Domain=www.yuketang.cn; HttpOnly; Secure'
          }
        });
      }

      if (target === 'https://www.yuketang.cn/api/v3/user/basic-info') {
        return Response.json({
          code: 0,
          data: {
            id: 47489393,
            name: '别点我我不会'
          }
        });
      }

      return Response.json({ code: 404 }, { status: 404 });
    });
    const controller = new RainClassroomHttpLoginController({
      accountRepository,
      fetchFn,
      pollIntervalMs: 1,
      onAccountSessionSaved
    });

    const started = await controller.startAccountLogin({ platform: 'rain-classroom' });

    expect(started.status).toBe('pending');
    expect(started.qrCodeDataUrl).toBe(`data:image/jpeg;base64,${Buffer.from('fake-image').toString('base64')}`);
    await vi.waitFor(async () => {
      const state = await controller.getAccountLoginState(started.loginSessionId!);
      expect(state.status).toBe('completed');
      expect(state.accountId).toBeGreaterThan(0);
    });

    const accounts = accountRepository.list();
    expect(accounts).toEqual([
      expect.objectContaining({
        userId: '47489393',
        name: '别点我我不会',
        platform: 'rain-classroom',
        cookieCount: 1
      })
    ]);
    expect(accountRepository.getStoredSession(accounts[0]!.id)?.cookies).toEqual([
      expect.objectContaining({
        name: 'sessionid',
        value: 'session-value',
        domain: 'www.yuketang.cn',
        path: '/'
      })
    ]);
    expect(onAccountSessionSaved).toHaveBeenCalledWith(accounts[0]!.id);
    expect(fetchCalls).toContain('https://www.yuketang.cn/api/v3/user/basic-info');
    databaseClient.close();
  });

  it('uses the selected Rain Classroom platform for QR login', async () => {
    const databaseClient = createDatabaseClient({ databasePath: ':memory:' });
    const accountRepository = new AccountRepository(databaseClient);
    const fetchCalls: string[] = [];
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      fetchCalls.push(target);

      if (target === 'https://changjiang.yuketang.cn/api/v3/user/login/wechat-auth-param') {
        return Response.json({
          code: 0,
          data: {
            appId: 'wx-app',
            state: 'state-token',
            redirectUri: 'https://changjiang.yuketang.cn/api/v3/user/login/wechat-web-callback'
          }
        });
      }

      if (target.startsWith('https://open.weixin.qq.com/connect/qrconnect?')) {
        return new Response('<img class="js_qrcode_img" src="/connect/qrcode/uuid-cj"><script>var fordevtool = "https://long.open.weixin.qq.com/connect/l/qrconnect?uuid=uuid-cj"</script>');
      }

      if (target === 'https://open.weixin.qq.com/connect/qrcode/uuid-cj') {
        return new Response(Buffer.from('fake-image'), {
          headers: {
            'content-type': 'image/jpeg'
          }
        });
      }

      return new Response("window.wx_errcode=408;", {
        headers: {
          'content-type': 'application/javascript'
        }
      });
    });
    const controller = new RainClassroomHttpLoginController({
      accountRepository,
      fetchFn,
      pollIntervalMs: 60_000
    });

    const state = await controller.startAccountLogin({ platform: 'changjiang-rain-classroom' });

    expect(state.status).toBe('pending');
    expect(fetchCalls[0]).toBe('https://changjiang.yuketang.cn/api/v3/user/login/wechat-auth-param');
    await controller.stop();
    databaseClient.close();
  });
});
