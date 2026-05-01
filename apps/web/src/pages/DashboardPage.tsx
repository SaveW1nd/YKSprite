import React from 'react';
import {
  AcademicCapIcon,
  ChartBarIcon,
  ClipboardDocumentCheckIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  KeyIcon,
  QueueListIcon,
  UserGroupIcon
} from '@heroicons/react/24/outline';
import type { SectionMetric } from '../app-data';
import { answerStatusLabel, formatAnswer, formatTimestamp, isSubmittedStatus, platformLabel } from '../lib/display';
import {
  fetchAccounts,
  fetchAnswerHistory,
  fetchApiConfig,
  fetchAutomationEvents,
  fetchAutomationTasks,
  subscribeDashboardEvents,
  type AnswerHistoryItem,
  type ApiConfigSnapshot,
  type AutomationEvent,
  type AutomationTask,
  type ManagedAccount
} from '../lib/api';
import { usePageMetrics } from '../lib/page-metrics';

const taskStatusLabel = (status: AutomationTask['status']) => {
  switch (status) {
    case 'running':
      return '运行中';
    case 'queued':
      return '排队中';
    case 'succeeded':
      return '成功';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
};

const isToday = (value: string | null) => {
  if (!value) {
    return false;
  }

  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
};

export function DashboardPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [accounts, setAccounts] = React.useState<ManagedAccount[]>([]);
  const [answers, setAnswers] = React.useState<AnswerHistoryItem[]>([]);
  const [tasks, setTasks] = React.useState<AutomationTask[]>([]);
  const [events, setEvents] = React.useState<AutomationEvent[]>([]);
  const [apiConfig, setApiConfig] = React.useState<ApiConfigSnapshot | null>(null);
  const [pageError, setPageError] = React.useState<string | null>(null);

  const loadDashboard = React.useCallback(async () => {
    try {
      setPageError(null);
      const [nextAccounts, nextAnswers, nextTasks, nextEvents, nextApiConfig] = await Promise.all([
        fetchAccounts(),
        fetchAnswerHistory(),
        fetchAutomationTasks(),
        fetchAutomationEvents(),
        fetchApiConfig()
      ]);

      setAccounts(nextAccounts);
      setAnswers(nextAnswers);
      setTasks(nextTasks);
      setEvents(nextEvents);
      setApiConfig(nextApiConfig);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '加载仪表盘失败');
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void loadDashboard();
    const unsubscribe = subscribeDashboardEvents(() => {
      if (!cancelled) {
        void loadDashboard();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadDashboard]);

  const healthyAccountCount = React.useMemo(
    () => accounts.filter((account) => account.status === 'healthy').length,
    [accounts]
  );
  const monitoringAccountCount = React.useMemo(
    () => accounts.filter((account) => account.monitorStatus === 'monitoring').length,
    [accounts]
  );
  const activeClassrooms = React.useMemo(
    () => accounts.filter((account) => account.currentClassroom?.status === 'in_class'),
    [accounts]
  );
  const todayAnswers = React.useMemo(
    () => answers.filter((answer) => isToday(answer.submittedAt)),
    [answers]
  );
  const successfulAnswers = React.useMemo(
    () => answers.filter((answer) => isSubmittedStatus(answer.submitStatus)),
    [answers]
  );
  const runningTaskCount = React.useMemo(
    () => tasks.filter((task) => ['running', 'queued'].includes(task.status)).length,
    [tasks]
  );
  const issueItems = React.useMemo(() => {
    const apiIssues = apiConfig?.keys
      .filter((key) => key.lastCheckStatus === 'error')
      .map((key) => ({
        id: `api-${key.id}`,
        title: `API 异常 · ${key.name}`,
        detail: key.lastCheckReason || '接口检测失败',
        time: key.lastCheckedAt
      })) ?? [];
    const accountIssues = accounts
      .filter((account) => account.status === 'error' || account.monitorStatus === 'error')
      .map((account) => ({
        id: `account-${account.id}`,
        title: `账号异常 · ${account.userId || account.name || account.id}`,
        detail: account.monitorLastError || account.lastErrorReason || '账号状态异常',
        time: account.monitorUpdatedAt || account.lastCheckedAt
      }));
    const taskIssues = tasks
      .filter((task) => task.status === 'failed')
      .map((task) => ({
        id: `task-${task.id}`,
        title: `任务失败 · ${task.type}`,
        detail: task.lastError || task.payloadSummary || '任务执行失败',
        time: task.finishedAt || task.startedAt
      }));
    const answerIssues = answers
      .filter((answer) => !isSubmittedStatus(answer.submitStatus))
      .map((answer) => ({
        id: `answer-${answer.id}`,
        title: `答题未提交 · ${answer.account.userId || answer.account.name}`,
        detail: answer.lastError || answerStatusLabel(answer.submitStatus),
        time: answer.submittedAt
      }));

    return [...apiIssues, ...accountIssues, ...taskIssues, ...answerIssues]
      .sort((left, right) => new Date(right.time || 0).getTime() - new Date(left.time || 0).getTime());
  }, [accounts, answers, apiConfig, tasks]);
  const issueCount = issueItems.length;

  const stateStream = React.useMemo(() => {
    const classroomEvents = accounts
      .filter((account) => account.currentClassroom)
      .map((account) => ({
        id: `classroom-${account.id}-${account.currentClassroom!.lessonId}`,
        at: account.currentClassroom!.detectedAt,
        title: `课堂中 · ${account.userId || account.name || account.id}`,
        detail: account.currentClassroom!.courseTitle || account.currentClassroom!.lessonId
      }));
    const accountLogs = accounts.flatMap((account) =>
      (account.recentLogs ?? []).map((log) => ({
        id: `log-${account.id}-${log.id}`,
        at: log.at,
        title: account.userId || account.name || `账号 ${account.id}`,
        detail: log.message
      }))
    );
    const automationEvents = events.map((event) => ({
      id: `event-${event.id}`,
      at: event.time,
      title: event.title,
      detail: event.description
    }));

    return [...classroomEvents, ...accountLogs, ...automationEvents]
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 8);
  }, [accounts, events]);

  React.useEffect(() => {
    const metrics: SectionMetric[] = [
      {
        label: 'API 密钥',
        value: String(apiConfig?.keys.length ?? 0),
        hint: apiConfig?.hasActiveKey ? '已启用' : '待配置',
        icon: KeyIcon
      },
      {
        label: '账号',
        value: String(accounts.length),
        hint: `${healthyAccountCount} 健康 ${accounts.length - healthyAccountCount} 异常`,
        icon: UserGroupIcon
      },
      {
        label: '今日答题',
        value: String(todayAnswers.length),
        hint: `总计：${answers.length}`,
        icon: ChartBarIcon
      },
      {
        label: '活跃课堂',
        value: String(activeClassrooms.length),
        hint: `监控中：${monitoringAccountCount}`,
        icon: AcademicCapIcon
      },
      {
        label: '监控账号',
        value: String(monitoringAccountCount),
        hint: `${healthyAccountCount} 个健康账号`,
        icon: EyeIcon
      },
      {
        label: '成功提交',
        value: String(successfulAnswers.length),
        hint: '已提交 / 已完成',
        icon: ClipboardDocumentCheckIcon
      },
      {
        label: '任务队列',
        value: String(tasks.length),
        hint: `${runningTaskCount} 个运行或排队`,
        icon: QueueListIcon
      },
      {
        label: '异常项',
        value: String(issueCount),
        hint: issueCount > 0 ? '需要关注' : '当前正常',
        icon: ExclamationTriangleIcon
      }
    ];

    setSectionMetrics('dashboard', metrics);
  }, [
    accounts,
    accounts.length,
    activeClassrooms,
    apiConfig,
    healthyAccountCount,
    issueCount,
    monitoringAccountCount,
    runningTaskCount,
    setSectionMetrics,
    successfulAnswers.length,
    tasks.length,
    todayAnswers.length
  ]);

  React.useEffect(() => {
    return () => {
      setSectionMetrics('dashboard', null);
    };
  }, [setSectionMetrics]);

  return (
    <div className="content-stack">
      {pageError ? (
        <div className="api-inline-alert api-inline-alert-error" role="alert">
          <span>{pageError}</span>
        </div>
      ) : null}

      <section className="dashboard-panel-grid">
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>账号与课堂</h3>
            <span>{accounts.length} 个账号</span>
          </header>
          <div className="dashboard-account-list">
            {accounts.length === 0 ? (
              <p className="account-log-empty">暂无账号</p>
            ) : (
              accounts.slice(0, 4).map((account) => (
                <div key={account.id} className="dashboard-account-row">
                  <div>
                    <strong>{account.userId || account.name || account.id}</strong>
                    <span>{platformLabel(account.platform)} · {account.currentClassroom?.courseTitle || '未在课堂'}</span>
                  </div>
                  <span className={`dashboard-dot dashboard-dot-${account.status === 'healthy' ? 'healthy' : 'error'}`} />
                </div>
              ))
            )}
          </div>
        </article>

        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>最近答题</h3>
            <span>{answers.length} 条记录</span>
          </header>
          <div className="dashboard-answer-list dashboard-scroll-list">
            {answers.length === 0 ? (
              <p className="account-log-empty">暂无答题记录</p>
            ) : (
              answers.map((answer) => {
                const answerText = formatAnswer(answer.answerJson);

                return (
                  <div key={answer.id} className="dashboard-answer-row">
                    <div>
                      <strong title={answerText}>{answerText}</strong>
                      <span>{answer.account.userId || answer.account.name} · {answer.courseTitle || '未知课程'}</span>
                    </div>
                    <span className={`answer-bullet ${isSubmittedStatus(answer.submitStatus) ? 'answer-bullet-submitted' : 'answer-bullet-unsubmitted'}`}>
                      {answerStatusLabel(answer.submitStatus)}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </article>

        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>任务队列</h3>
            <span>{tasks.length}</span>
          </header>
          <div className="dashboard-task-list dashboard-scroll-list">
            {tasks.length === 0 ? (
              <p className="account-log-empty">暂无任务</p>
            ) : (
              tasks.map((task) => (
                <div key={task.id} className="dashboard-task-row">
                  <div>
                    <strong>{task.type}</strong>
                    <span>{task.payloadSummary}</span>
                  </div>
                  <span className={`dashboard-task-status dashboard-task-status-${task.status}`}>
                    {taskStatusLabel(task.status)}
                  </span>
                </div>
              ))
            )}
          </div>
        </article>
      </section>

      <section className="dual-panels dashboard-lower-grid">
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>状态流</h3>
            <span>{stateStream.length}</span>
          </header>
          <div className="account-log-panel account-log-panel-scrollable">
            {stateStream.length === 0 ? (
              <p className="account-log-empty">暂无状态更新</p>
            ) : (
              <ol className="account-log-list">
                {stateStream.map((event) => (
                  <li key={event.id} className="account-log-line">
                    <time className="account-log-time account-log-time-fixed" dateTime={event.at}>
                      {formatTimestamp(event.at)}
                    </time>
                    <span className="account-log-message">{event.title} · {event.detail}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </article>

        <article className="glass-card panel-card dashboard-focus-card">
          <header className="panel-card-header">
            <h3>异常提醒</h3>
            <span>{issueItems.length > 0 ? `${issueItems.length} 项` : '正常'}</span>
          </header>
          {issueItems.length > 0 ? (
            <div className="dashboard-issue-list dashboard-scroll-list">
              {issueItems.map((issue) => (
                <div key={issue.id} className="dashboard-issue-row">
                  <ExclamationTriangleIcon />
                  <div>
                    <strong title={issue.title}>{issue.title}</strong>
                    <span title={issue.detail}>{issue.detail} · {formatTimestamp(issue.time)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="panel-text">当前没有需要处理的异常。</p>
          )}
        </article>
      </section>
    </div>
  );
}
