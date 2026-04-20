import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountsPage } from './AccountsPage';
import type { ManagedAccount } from '../lib/api';

const {
  fetchAccountsMock,
  updateAccountMonitoringMock,
  deleteAccountMock,
  startAccountLoginMock,
  fetchAccountLoginStateMock,
  stopAccountLoginMock,
  subscribeAccountEventsMock
} = vi.hoisted(() => ({
  fetchAccountsMock: vi.fn<typeof import('../lib/api').fetchAccounts>(),
  updateAccountMonitoringMock: vi.fn<typeof import('../lib/api').updateAccountMonitoring>(),
  deleteAccountMock: vi.fn<typeof import('../lib/api').deleteAccount>(),
  startAccountLoginMock: vi.fn<typeof import('../lib/api').startAccountLogin>(),
  fetchAccountLoginStateMock: vi.fn<typeof import('../lib/api').fetchAccountLoginState>(),
  stopAccountLoginMock: vi.fn<typeof import('../lib/api').stopAccountLogin>(),
  subscribeAccountEventsMock: vi.fn<typeof import('../lib/api').subscribeAccountEvents>()
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchAccounts: fetchAccountsMock,
    startAccountLogin: startAccountLoginMock,
    fetchAccountLoginState: fetchAccountLoginStateMock,
    stopAccountLogin: stopAccountLoginMock,
    subscribeAccountEvents: subscribeAccountEventsMock,
    updateAccountMonitoring: updateAccountMonitoringMock,
    deleteAccount: deleteAccountMock
  };
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  fetchAccountsMock.mockReset();
  updateAccountMonitoringMock.mockReset();
  deleteAccountMock.mockReset();
  startAccountLoginMock.mockReset();
  fetchAccountLoginStateMock.mockReset();
  stopAccountLoginMock.mockReset();
  subscribeAccountEventsMock.mockReset();
});

describe('AccountsPage', () => {
  it('renders managed accounts with qr login actions', async () => {
    fetchAccountsMock.mockResolvedValue([
      {
        id: 1,
        userId: '47489393',
        name: '别点我我不会',
        accountKey: 'acct-openai-cn-01',
        platform: 'OpenAI',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        createdAt: '2026-04-16T10:00:00.000Z',
        note: '主账号',
        monitoringEnabled: true
      }
    ]);
    subscribeAccountEventsMock.mockReturnValue(() => undefined);

    render(<AccountsPage />);

    expect(await screen.findByText('47489393')).not.toBeNull();
    expect(screen.getByRole('button', { name: '添加账号' })).not.toBeNull();
    expect(screen.getByRole('button', { name: '批量巡检' })).not.toBeNull();
  });

  it('subscribes to account changes without registering the legacy 5s polling interval', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    fetchAccountsMock.mockResolvedValue([]);
    const unsubscribe = vi.fn();
    subscribeAccountEventsMock.mockReturnValue(unsubscribe);

    const { unmount } = render(<AccountsPage />);

    await screen.findByText('暂无账号数据');
    expect(fetchAccountsMock).toHaveBeenCalledTimes(1);
    expect(subscribeAccountEventsMock).toHaveBeenCalledTimes(1);
    expect(setIntervalSpy.mock.calls.some((call) => call[1] === 5000)).toBe(false);
    unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reloads account list when the account event stream emits a change', async () => {
    const onAccountsChangedRef: { current: null | (() => void) } = { current: null };
    subscribeAccountEventsMock.mockImplementation((listener: () => void) => {
      onAccountsChangedRef.current = listener;
      return () => undefined;
    });
    fetchAccountsMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: 1,
          userId: '47489393',
          name: '别点我我不会',
          accountKey: '别点我我不会',
          platform: 'Yuketang',
          status: 'healthy',
          lastCheckedAt: '2026-04-17T10:00:05.000Z',
          lastErrorReason: null,
          createdAt: '2026-04-16T10:00:00.000Z',
          note: null,
          monitoringEnabled: true
        } as ManagedAccount
      ]);

    render(<AccountsPage />);

    await screen.findByText('暂无账号数据');
    expect(onAccountsChangedRef.current).not.toBeNull();

    if (onAccountsChangedRef.current) {
      onAccountsChangedRef.current();
    }

    expect(await screen.findByText('47489393')).not.toBeNull();
    expect(fetchAccountsMock).toHaveBeenCalledTimes(2);
  });

  it('starts qr login and polls the login session state until completion', async () => {
    subscribeAccountEventsMock.mockReturnValue(() => undefined);
    fetchAccountsMock.mockResolvedValue([]);
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    startAccountLoginMock.mockResolvedValue({
      loginSessionId: 'login-session-1',
      accountId: null,
      status: 'pending',
      qrCodeDataUrl: 'data:image/png;base64,qr',
      lastError: null,
      notice: null,
      updatedAt: '2026-04-20T00:00:00.000Z'
    });
    fetchAccountLoginStateMock.mockResolvedValue({
      loginSessionId: 'login-session-1',
      accountId: 12,
      status: 'completed',
      qrCodeDataUrl: 'data:image/png;base64,qr',
      lastError: null,
      notice: '登录成功',
      updatedAt: '2026-04-20T00:00:02.000Z'
    });

    render(<AccountsPage />);

    await screen.findByRole('button', { name: '添加账号' });
    fireEvent.click(screen.getByRole('button', { name: '添加账号' }));
    fireEvent.click(screen.getByRole('button', { name: '生成登录二维码' }));

    await waitFor(() => {
      expect(startAccountLoginMock).toHaveBeenCalledWith({ platform: 'rain-classroom' });
    });

    let pollRegistration = setIntervalSpy.mock.calls.find((call) => call[1] === 2000);
    await waitFor(() => {
      pollRegistration = setIntervalSpy.mock.calls.find((call) => call[1] === 2000);
      expect(pollRegistration).toBeDefined();
    });
    await act(async () => {
      await (pollRegistration?.[0] as () => Promise<void>)();
    });

    await waitFor(() => {
      expect(fetchAccountLoginStateMock).toHaveBeenCalledWith('login-session-1');
    });
  });

  it('updates account monitoring state after a user action', async () => {
    fetchAccountsMock.mockResolvedValue([
      {
        id: 1,
        userId: '47489393',
        name: '别点我我不会',
        accountKey: '别点我我不会',
        platform: 'Yuketang',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        createdAt: '2026-04-16T10:00:00.000Z',
        note: null,
        monitoringEnabled: false,
        monitorStatus: 'idle',
        monitorUpdatedAt: '2026-04-17T10:00:00.000Z',
        recentLogs: []
      } as ManagedAccount
    ]);
    subscribeAccountEventsMock.mockReturnValue(() => undefined);
    updateAccountMonitoringMock.mockResolvedValue({
      id: 1,
      userId: '47489393',
      name: '别点我我不会',
      accountKey: '别点我我不会',
      platform: 'Yuketang',
      status: 'healthy',
      lastCheckedAt: '2026-04-17T10:00:05.000Z',
      lastErrorReason: null,
      createdAt: '2026-04-16T10:00:00.000Z',
      note: null,
      monitoringEnabled: true,
      monitorStatus: 'monitoring',
      monitorUpdatedAt: '2026-04-17T10:00:05.000Z',
      recentLogs: []
    });
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    render(<AccountsPage />);

    expect(await screen.findByText('idle')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '展开账号详情' }));
    fireEvent.click(screen.getByRole('button', { name: '启用侦测' }));

    await waitFor(() => {
      expect(updateAccountMonitoringMock).toHaveBeenCalledWith(1, true);
    });
    expect(await screen.findByText('monitoring')).toBeInTheDocument();
  });

  it('shows the backend api error on the error status badge tooltip', async () => {
    fetchAccountsMock.mockResolvedValue([
      {
        id: 1,
        userId: '47489393',
        name: '别点我我不会',
        accountKey: '别点我我不会',
        platform: 'Yuketang',
        status: 'error',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: 'api key未配置，无法调用 AI 解题',
        createdAt: '2026-04-16T10:00:00.000Z',
        note: null,
        monitoringEnabled: true,
        monitorStatus: 'monitoring',
        monitorUpdatedAt: '2026-04-17T10:00:05.000Z',
        recentLogs: []
      } as ManagedAccount
    ]);
    subscribeAccountEventsMock.mockReturnValue(() => undefined);

    render(<AccountsPage />);

    const badge = await screen.findByText('异常');
    fireEvent.mouseEnter(badge.closest('.status-badge') as HTMLElement);

    expect(await screen.findByText('api key未配置，无法调用 AI 解题')).toBeInTheDocument();
  });
});
