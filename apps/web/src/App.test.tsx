import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ManagedAccount } from './lib/api';

const fetchAccountsMock = vi.fn<() => Promise<ManagedAccount[]>>();
fetchAccountsMock.mockResolvedValue([]);
const fetchAutomationTasksMock = vi.fn<() => Promise<any[]>>();
const fetchAutomationEventsMock = vi.fn<() => Promise<any[]>>();
const fetchApiConfigMock = vi.fn<() => Promise<any>>();
fetchAutomationTasksMock.mockResolvedValue([]);
fetchAutomationEventsMock.mockResolvedValue([]);
fetchApiConfigMock.mockResolvedValue({
  model: 'qwen3-vl-flash-2026-01-22',
  hasActiveKey: true,
  activeKeyId: 1,
  activeKeyName: '主账号 key',
  keys: []
});
vi.mock('./lib/api', async () => {
  const actual = await vi.importActual<typeof import('./lib/api')>('./lib/api');
  return {
    ...actual,
    fetchAccounts: () => fetchAccountsMock(),
    fetchAutomationTasks: () => fetchAutomationTasksMock(),
    fetchAutomationEvents: () => fetchAutomationEventsMock(),
    fetchApiConfig: () => fetchApiConfigMock()
  };
});

import App from './App';

describe('App shell', () => {
  afterEach(() => {
    fetchAccountsMock.mockReset();
    fetchAccountsMock.mockResolvedValue([]);
    fetchAutomationTasksMock.mockReset();
    fetchAutomationTasksMock.mockResolvedValue([]);
    fetchAutomationEventsMock.mockReset();
    fetchAutomationEventsMock.mockResolvedValue([]);
    fetchApiConfigMock.mockReset();
    fetchApiConfigMock.mockResolvedValue({
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: true,
      activeKeyId: 1,
      activeKeyName: '主账号 key',
      keys: []
    });
    window.history.replaceState({}, '', '/');
    cleanup();
  });

  it('renders the admin shell with versioned brand and route links', async () => {
    const { container } = render(<App />);
    await screen.findByText('暂无账号数据');

    expect(screen.getByRole('navigation', { name: '主导航' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '收起侧边栏' })).toBeInTheDocument();
    expect(screen.getByText('YKSprite')).toBeInTheDocument();
    expect(screen.queryByText('v0.1.111')).not.toBeInTheDocument();

    expect(screen.getByRole('link', { name: '仪表盘' })).toHaveAttribute('href', '/dashboard');
    expect(screen.getByRole('link', { name: '账号管理' })).toHaveAttribute('href', '/accounts');
    expect(screen.getByRole('link', { name: '答题情况' })).toHaveAttribute('href', '/answers');
    expect(screen.getByRole('link', { name: '后台监控' })).toHaveAttribute('href', '/monitoring');
    expect(screen.getByRole('link', { name: 'API管理' })).toHaveAttribute('href', '/api');
    expect(screen.getByRole('button', { name: '深色模式' })).toBeInTheDocument();
    expect(screen.queryByText('控制中心在线')).not.toBeInTheDocument();
    expect(container.querySelector('.brand-copy-stack')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-header')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-bottom')).toBeInTheDocument();
  });

  it('collapses the sidebar brand down to the centered logo only', async () => {
    const { container } = render(<App />);
    await screen.findByText('暂无账号数据');

    fireEvent.click(screen.getByRole('button', { name: '收起侧边栏' }));

    expect(container.querySelector('.sidebar-header.sidebar-header-collapsed')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-logo')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-brand.sidebar-brand-collapsed')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-link.sidebar-link-collapsed')).toBeInTheDocument();
    expect(container.querySelector('.sidebar-label.sidebar-label-collapsed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开侧边栏' })).toBeInTheDocument();
  });

  it('renders a different page when the route changes', () => {
    window.history.pushState({}, '', '/answers');

    render(<App />);

    expect(screen.getByRole('heading', { name: '答题情况' })).toBeInTheDocument();
    expect(screen.getAllByText('聚合查看答题结果、命中率和异常记录。')).toHaveLength(2);
    expect(screen.getByText('成功率趋势')).toBeInTheDocument();
  });

  it('renders the monitoring page when the route changes', async () => {
    window.history.pushState({}, '', '/monitoring');

    render(<App />);

    expect(await screen.findByRole('heading', { name: '账号 Worker' })).toBeInTheDocument();
    expect(screen.getByText('查看后台正在跑的账号监控线程和当前课堂上下文。')).toBeInTheDocument();
  });

  it('renders the api management page when the route changes', async () => {
    window.history.pushState({}, '', '/api');

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'API 列表' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开添加 API 弹窗' })).toBeInTheDocument();
  });

  it('renders a monitoring state stream from classroom context and backend events', async () => {
    window.history.pushState({}, '', '/monitoring');
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
        note: null,
        createdAt: '2026-04-16T10:00:00.000Z',
        monitorStatus: 'monitoring',
        monitorUpdatedAt: '2026-04-17T10:10:00.000Z',
        currentClassroom: {
          lessonId: 'lesson-1',
          classroomId: 'classroom-1',
          courseTitle: '高等数学',
          classroomTitle: '第一讲',
          status: 'in_class',
          detectedAt: '2026-04-17T10:10:00.000Z'
        },
        recentLogs: [
          {
            id: 1,
            at: '2026-04-17T10:11:00.000Z',
            type: 'home_entered',
            message: '成功进入首页'
          }
        ]
      } as ManagedAccount
    ]);
    fetchAutomationEventsMock.mockResolvedValue([
      {
        id: 'event-1',
        level: 'live',
        title: 'Task auto_answer_run started',
        description: 'Run lesson-1',
        time: '2026-04-17T10:12:00.000Z'
      }
    ]);

    render(<App />);

    expect(await screen.findByRole('heading', { name: '状态流' })).toBeInTheDocument();
    expect(
      screen.getAllByText((_, element) => element?.textContent?.includes('lessonId=lesson-1') ?? false)
    ).not.toHaveLength(0);
    expect(screen.getAllByText(/Task auto_answer_run started/)).not.toHaveLength(0);
    expect(screen.getAllByText(/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}/)).not.toHaveLength(0);
  });

  it('renders second-level timestamps in account logs', async () => {
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
        note: null,
        createdAt: '2026-04-16T10:00:00.000Z',
        monitorStatus: 'monitoring',
        monitorUpdatedAt: '2026-04-17T10:10:00.000Z',
        recentLogs: [
          {
            id: 1,
            at: '2026-04-17T10:11:01.000Z',
            type: 'home_entered',
            message: '成功进入首页'
          }
        ]
      } as ManagedAccount
    ]);

    window.history.pushState({}, '', '/accounts');
    render(<App />);

    expect(await screen.findByText('别点我我不会')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开账号详情' }));
    const logPanel = screen.getByLabelText('账号日志');
    expect(logPanel.querySelector('time')?.textContent).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('renders account logs in chronological flow order', async () => {
    fetchAccountsMock.mockResolvedValue([
      {
        id: 1,
        userId: '47489393',
        name: '别点我我不会',
        accountKey: '别点我我不会',
        platform: 'rain-classroom',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:00:00.000Z',
        lastErrorReason: null,
        note: null,
        createdAt: '2026-04-16T10:00:00.000Z',
        monitorStatus: 'monitoring',
        monitorUpdatedAt: '2026-04-17T10:10:06.000Z',
        recentLogs: [
          {
            id: 6,
            at: '2026-04-17T10:10:06.000Z',
            type: 'submit_result',
            message: '答案提交成功'
          },
          {
            id: 5,
            at: '2026-04-17T10:10:05.000Z',
            type: 'submit_payload',
            message: '正在提交答案'
          },
          {
            id: 4,
            at: '2026-04-17T10:10:04.000Z',
            type: 'ai_response',
            message: '答案成功获取'
          },
          {
            id: 3,
            at: '2026-04-17T10:10:03.000Z',
            type: 'ai_request_started',
            message: '提交AI自动作答'
          },
          {
            id: 2,
            at: '2026-04-17T10:10:02.000Z',
            type: 'question_detected',
            message: '检测到题目'
          },
          {
            id: 1,
            at: '2026-04-17T10:10:01.000Z',
            type: 'classroom_entered',
            message: '成功进入课堂'
          }
        ]
      } as ManagedAccount
    ]);

    window.history.pushState({}, '', '/accounts');
    render(<App />);

    expect(await screen.findByText('别点我我不会')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '展开账号详情' }));
    const messages = [...screen.getByLabelText('账号日志').querySelectorAll('.account-log-message')].map(
      (element) => element.textContent
    );

    expect(messages).toEqual([
      '成功进入课堂',
      '检测到题目',
      '提交AI自动作答',
      '答案成功获取',
      '正在提交答案',
      '答案提交成功'
    ]);
  });

  it('renders account summary metrics from live account data on the accounts page', async () => {
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
        note: null,
        createdAt: '2026-04-16T10:00:00.000Z'
      } as ManagedAccount,
      {
        id: 2,
        userId: '47489394',
        name: '另一个用户',
        accountKey: '另一个用户',
        platform: 'Yuketang',
        status: 'error',
        lastCheckedAt: '2026-04-17T10:05:00.000Z',
        lastErrorReason: '未登录',
        note: null,
        createdAt: '2026-04-16T10:05:00.000Z'
      } as ManagedAccount,
      {
        id: 3,
        userId: '47489395',
        name: '第三个用户',
        accountKey: '第三个用户',
        platform: 'Yuketang',
        status: 'healthy',
        lastCheckedAt: '2026-04-17T10:10:00.000Z',
        lastErrorReason: null,
        note: null,
        createdAt: '2026-04-16T10:10:00.000Z'
      } as ManagedAccount
    ]);

    render(<App />);

    expect(await screen.findByText('账号总数')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getAllByText('2')).not.toHaveLength(0);
      expect(screen.getByText('1')).toBeInTheDocument();
    });
  });

  it('opens a mobile sidebar overlay from the topbar toggle', async () => {
    const { container } = render(<App />);
    await screen.findByText('暂无账号数据');

    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));

    expect(container.querySelector('.mobile-sidebar-overlay')).toBeInTheDocument();
    expect(container.querySelector('.sidebar.sidebar-mobile-open')).toBeInTheDocument();
  });

  it('clears the mobile overlay when the viewport returns to desktop width', async () => {
    window.innerWidth = 768;
    const { container } = render(<App />);
    await screen.findByText('暂无账号数据');

    fireEvent.click(screen.getByRole('button', { name: '打开导航' }));
    window.innerWidth = 1200;
    fireEvent(window, new Event('resize'));

    expect(container.querySelector('.mobile-sidebar-overlay')).not.toBeInTheDocument();
    expect(container.querySelector('.sidebar.sidebar-mobile-open')).not.toBeInTheDocument();
  });
});
