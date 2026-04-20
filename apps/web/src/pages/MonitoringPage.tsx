import React from 'react';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import type { SectionMetric } from '../app-data';
import {
  fetchAccounts,
  fetchAutomationEvents,
  fetchAutomationTasks,
  type AutomationEvent,
  type AutomationTask,
  type ManagedAccount
} from '../lib/api';
import { usePageMetrics } from '../lib/page-metrics';

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return '未记录';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
};

export function MonitoringPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [accounts, setAccounts] = React.useState<ManagedAccount[]>([]);
  const [tasks, setTasks] = React.useState<AutomationTask[]>([]);
  const [events, setEvents] = React.useState<AutomationEvent[]>([]);
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const load = React.useCallback(async () => {
    setIsRefreshing(true);
    try {
      const [nextAccounts, nextTasks, nextEvents] = await Promise.all([
        fetchAccounts(),
        fetchAutomationTasks(),
        fetchAutomationEvents()
      ]);

      setAccounts(nextAccounts);
      setTasks(nextTasks);
      setEvents(nextEvents);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    const workerCount = accounts.filter((account) => account.monitorStatus === 'monitoring').length;
    const activeClassroomCount = accounts.filter((account) => account.currentClassroom?.status === 'in_class').length;
    const runningTaskCount = tasks.filter((task) => task.status === 'running').length;

    const metrics: SectionMetric[] = [
      {
        label: '监控线程',
        value: String(workerCount),
        hint: '账号 worker 数'
      },
      {
        label: '活跃课堂',
        value: String(activeClassroomCount),
        hint: '当前 lessonId/classroomId'
      },
      {
        label: '运行任务',
        value: String(runningTaskCount),
        hint: '自动化任务状态'
      }
    ];

    setSectionMetrics('monitoring', metrics);
  }, [accounts, setSectionMetrics, tasks]);

  React.useEffect(() => {
    return () => {
      setSectionMetrics('monitoring', null);
    };
  }, [setSectionMetrics]);

  const stateStream = React.useMemo(() => {
    const classroomEvents = accounts
      .filter((account) => account.currentClassroom)
      .map((account) => ({
        id: `classroom-${account.id}-${account.currentClassroom!.lessonId}`,
        at: account.currentClassroom!.detectedAt,
        label: `账号 ${account.userId || account.id}`,
        message: `进入课堂 ${account.currentClassroom!.courseTitle} · lessonId=${account.currentClassroom!.lessonId} · classroomId=${account.currentClassroom!.classroomId || '-'}`
      }));
    const accountLogEvents = accounts.flatMap((account) =>
      (account.recentLogs ?? []).map((log) => ({
        id: `log-${account.id}-${log.id}`,
        at: log.at,
        label: `账号 ${account.userId || account.id}`,
        message: log.message
      }))
    );
    const automationEvents = events.map((event) => ({
      id: `event-${event.id}`,
      at: event.time,
      label: event.level,
      message: `${event.title} · ${event.description}`
    }));

    return [...classroomEvents, ...accountLogEvents, ...automationEvents]
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
  }, [accounts, events]);

  return (
    <div className="content-stack">
      <section className="section-card">
        <header className="section-header">
          <div>
            <h2>账号 Worker</h2>
            <p>查看后台正在跑的账号监控线程和当前课堂上下文。</p>
          </div>
          <button
            aria-label="刷新监控快照"
            className="toolbar-button"
            type="button"
            onClick={() => void load()}
          >
            <ArrowPathIcon />
            {isRefreshing ? '刷新中' : '刷新'}
          </button>
        </header>

        <div className="account-card-grid account-card-grid-fixed">
          {accounts.length === 0 ? (
            <div className="account-card account-card-empty">暂无后台线程</div>
          ) : (
            accounts.map((account) => (
              <article key={account.id} className="account-card">
                <div className="account-card-header">
                  <div className="account-card-primary">
                    <span className="account-card-kicker">账号</span>
                    <strong>{account.userId || account.id}</strong>
                    <span className="account-card-name">{account.name || account.accountKey}</span>
                  </div>
                </div>

                <div className="account-card-meta">
                  <div className="account-meta-item">
                    <span>线程状态</span>
                    <strong>{account.monitorStatus || 'idle'}</strong>
                  </div>
                  <div className="account-meta-item">
                    <span>最近更新时间</span>
                    <strong>{account.monitorUpdatedAt || '未启动'}</strong>
                  </div>
                  <div className="account-meta-item">
                    <span>lessonId</span>
                    <strong>{account.currentClassroom?.lessonId || '-'}</strong>
                  </div>
                  <div className="account-meta-item">
                    <span>classroomId</span>
                    <strong>{account.currentClassroom?.classroomId || '-'}</strong>
                  </div>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <section className="dual-panels">
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>后台任务</h3>
            <span>{tasks.length}</span>
          </header>
          <div className="account-log-panel account-log-panel-scrollable" aria-label="后台任务">
            {tasks.length === 0 ? (
              <p className="account-log-empty">暂无任务</p>
            ) : (
              <ol className="account-log-list">
                {tasks.map((task) => (
                  <li key={task.id} className="account-log-line">
                    <time className="account-log-time account-log-time-fixed" dateTime={task.startedAt}>
                      {formatTimestamp(task.startedAt)}
                    </time>
                    <span className="account-log-message">{task.type} · {task.status} · {task.payloadSummary}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </article>

        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>后台事件</h3>
            <span>{events.length}</span>
          </header>
          <div className="account-log-panel account-log-panel-scrollable" aria-label="后台事件">
            {events.length === 0 ? (
              <p className="account-log-empty">暂无事件</p>
            ) : (
              <ol className="account-log-list">
                {events.map((event) => (
                  <li key={event.id} className="account-log-line">
                    <time className="account-log-time account-log-time-fixed" dateTime={event.time}>
                      {formatTimestamp(event.time)}
                    </time>
                    <span className="account-log-message">{event.level} · {event.title} · {event.description}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </article>
      </section>

      <section className="section-card">
        <header className="section-header">
          <div>
            <h2>状态流</h2>
            <p>按时间聚合账号线程、课堂上下文和后台事件，便于调试当前系统状态。</p>
          </div>
        </header>

        <div className="account-log-panel account-log-panel-scrollable" aria-label="状态流">
          {stateStream.length === 0 ? (
            <p className="account-log-empty">暂无状态变化</p>
          ) : (
            <ol className="account-log-list">
              {stateStream.map((item) => (
                <li key={item.id} className="account-log-line">
                  <time className="account-log-time account-log-time-fixed" dateTime={item.at}>
                    {formatTimestamp(item.at)}
                  </time>
                  <span className="account-log-message">
                    <strong>{item.label}</strong>
                    {' · '}
                    {item.message}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
