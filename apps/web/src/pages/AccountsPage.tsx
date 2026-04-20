import React from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowPathIcon,
  ChevronDownIcon,
  CommandLineIcon,
  ExclamationTriangleIcon,
  UserPlusIcon
} from '@heroicons/react/24/outline';
import { CheckBadgeIcon } from '@heroicons/react/24/solid';
import {
  deleteAccount,
  fetchAccountLoginState,
  fetchAccounts,
  startAccountLogin,
  stopAccountLogin,
  subscribeAccountEvents,
  updateAccountMonitoring,
  type AccountLoginState,
  type ManagedAccount
} from '../lib/api';
import { usePageMetrics } from '../lib/page-metrics';
import type { SectionMetric } from '../app-data';

const LOGIN_STATUS_POLL_INTERVAL_MS = 2000;

const platformOptions = [
  { value: 'all', label: '全部平台' },
  { value: 'rain-classroom', label: '雨课堂' },
  { value: 'changjiang-rain-classroom', label: '长江雨课堂' },
  { value: 'hotang-rain-classroom', label: '荷塘雨课堂' },
  { value: 'huanghe-rain-classroom', label: '黄河雨课堂' }
] as const;

const platformLabelByValue = Object.fromEntries(platformOptions.map((option) => [option.value, option.label])) as Record<string, string>;

const statusOptions = [
  { value: 'all', label: '全部状态' },
  { value: 'healthy', label: '健康' },
  { value: 'error', label: '异常' }
] as const;

type FilterDropdownProps = {
  label: string;
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  open: boolean;
  onToggle: () => void;
  onSelect: (value: string) => void;
};

function FilterDropdown(props: FilterDropdownProps) {
  const selected = props.options.find((option) => option.value === props.value) ?? props.options[0];

  return (
    <div
      className="filter-dropdown"
      onClick={(event) => {
        event.stopPropagation();
      }}
    >
      <button
        aria-expanded={props.open}
        aria-haspopup="listbox"
        aria-label={props.label}
        className={`filter-dropdown-trigger ${props.open ? 'filter-dropdown-trigger-open' : ''}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          props.onToggle();
        }}
      >
        <span>{selected?.label}</span>
        <ChevronDownIcon />
      </button>

      {props.open ? (
        <div aria-label={`${props.label}菜单`} className="filter-dropdown-menu" role="listbox">
          {props.options.map((option) => (
            <button
              key={option.value}
              aria-selected={option.value === props.value}
              className={`filter-dropdown-option ${option.value === props.value ? 'filter-dropdown-option-active' : ''}`}
              role="option"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                props.onSelect(option.value);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

const statusTone = {
  healthy: {
    label: '健康',
    className: 'status-badge status-badge-healthy',
    icon: CheckBadgeIcon
  },
  error: {
    label: '异常',
    className: 'status-badge status-badge-error',
    icon: ExclamationTriangleIcon
  }
} as const;

const createIdleLoginState = (): AccountLoginState => ({
  loginSessionId: null,
  accountId: null,
  status: 'idle',
  qrCodeDataUrl: null,
  lastError: null,
  notice: null,
  updatedAt: null
});

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return '未检测';
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

export function AccountsPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [accounts, setAccounts] = React.useState<ManagedAccount[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isRefreshing, setIsRefreshing] = React.useState(false);
  const [isModalOpen, setIsModalOpen] = React.useState(false);
  const [expandedAccounts, setExpandedAccounts] = React.useState<number[]>([]);
  const [loginNotice, setLoginNotice] = React.useState<string | null>(null);
  const [platformFilter, setPlatformFilter] = React.useState<string>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [selectedLoginPlatform, setSelectedLoginPlatform] = React.useState<string>('rain-classroom');
  const [openDropdown, setOpenDropdown] = React.useState<'platform' | 'status' | 'loginPlatform' | null>(null);
  const [loginState, setLoginState] = React.useState<AccountLoginState>(createIdleLoginState());
  const [hoveredErrorBadgeAccountId, setHoveredErrorBadgeAccountId] = React.useState<number | null>(null);
  const loginRequestRef = React.useRef(0);
  const loginAccountCountBeforeStartRef = React.useRef<number | null>(null);

  const resetModalState = React.useCallback(() => {
    loginRequestRef.current += 1;
    loginAccountCountBeforeStartRef.current = null;
    setLoginState(createIdleLoginState());
  }, []);

  const loadAccounts = React.useCallback(async (mode: 'initial' | 'manual' | 'push' = 'manual') => {
    if (mode === 'manual') {
      setIsRefreshing(true);
    }

    try {
      const nextAccounts = await fetchAccounts();
      setAccounts(nextAccounts);
      return nextAccounts;
    } catch {
      setAccounts([]);
      return [];
    } finally {
      setIsLoading(false);
      if (mode === 'manual') {
        setIsRefreshing(false);
      }
    }
  }, []);

  const handleLoginCompleted = React.useCallback(
    async (state: Pick<AccountLoginState, 'notice'> | null = null) => {
      const accountCountBeforeStart = loginAccountCountBeforeStartRef.current;
      const explicitNotice = state?.notice?.trim() || null;
      setIsModalOpen(false);
      resetModalState();
      if (explicitNotice) {
        setLoginNotice(explicitNotice);
      }

      const nextAccounts = await loadAccounts('push');
      if (!explicitNotice) {
        setLoginNotice(
          accountCountBeforeStart !== null && nextAccounts.length <= accountCountBeforeStart ? '重复账号，已刷新会话' : '登录成功'
        );
      }
      loginAccountCountBeforeStartRef.current = null;
    },
    [loadAccounts, resetModalState]
  );

  React.useEffect(() => {
    void loadAccounts('initial');
  }, [loadAccounts]);

  React.useEffect(() => {
    return subscribeAccountEvents(() => {
      void loadAccounts('push');
    });
  }, [loadAccounts]);

  React.useEffect(() => {
    if (!loginNotice) {
      return;
    }

    const clearTimer = window.setTimeout(() => {
      setLoginNotice(null);
    }, 3000);

    return () => {
      window.clearTimeout(clearTimer);
    };
  }, [loginNotice]);

  React.useEffect(() => {
    const totalCount = accounts.length;
    const healthyCount = accounts.filter((account) => account.status === 'healthy').length;
    const errorCount = accounts.filter((account) => account.status === 'error').length;

    const metrics: SectionMetric[] = [
      {
        label: '账号总数',
        value: String(totalCount),
        hint: '当前账号池总量'
      },
      {
        label: '健康账号',
        value: String(healthyCount),
        hint: '按账号健康状态统计'
      },
      {
        label: '异常账号',
        value: String(errorCount),
        hint: '按账号健康状态统计'
      }
    ];

    setSectionMetrics('accounts', metrics);
  }, [accounts, setSectionMetrics]);

  React.useEffect(() => {
    return () => {
      setSectionMetrics('accounts', null);
    };
  }, [setSectionMetrics]);

  React.useEffect(() => {
    if (!openDropdown) {
      return;
    }

    const close = () => setOpenDropdown(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [openDropdown]);

  React.useEffect(() => {
    if (!isModalOpen || !loginState.loginSessionId || loginState.status !== 'pending') {
      return;
    }

    const timer = window.setInterval(async () => {
      try {
        const nextState = await fetchAccountLoginState(loginState.loginSessionId!);
        if (nextState.status === 'completed') {
          window.clearInterval(timer);
          await handleLoginCompleted(nextState);
          return;
        }

        setLoginState(nextState);
      } catch (error) {
        setLoginState((current) => ({
          ...current,
          status: 'error',
          lastError: error instanceof Error ? error.message : '登录状态检查失败'
        }));
      }
    }, LOGIN_STATUS_POLL_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [handleLoginCompleted, isModalOpen, loginState]);

  const filteredAccounts = React.useMemo(
    () =>
      accounts.filter((account) => {
        const matchesPlatform = platformFilter === 'all' || account.platform === platformFilter;
        const matchesStatus = statusFilter === 'all' || account.status === statusFilter;
        return matchesPlatform && matchesStatus;
      }),
    [accounts, platformFilter, statusFilter]
  );

  const toggleExpanded = (accountId: number) => {
    setExpandedAccounts((current) =>
      current.includes(accountId) ? current.filter((id) => id !== accountId) : [...current, accountId]
    );
  };

  const closeLoginModal = async () => {
    const loginSessionId = loginState.loginSessionId;
    setIsModalOpen(false);
    resetModalState();

    if (loginSessionId) {
      await stopAccountLogin(loginSessionId).catch(() => undefined);
    }
  };

  const handleCreateAccount = React.useCallback(
    async (platform: string) => {
      const requestId = loginRequestRef.current + 1;
      loginRequestRef.current = requestId;
      loginAccountCountBeforeStartRef.current = accounts.length;
      setLoginState({
        loginSessionId: null,
        accountId: null,
        status: 'pending',
        qrCodeDataUrl: null,
        lastError: null,
        notice: null,
        updatedAt: new Date().toISOString()
      });

      try {
        const nextLoginState = await startAccountLogin({ platform });
        if (loginRequestRef.current !== requestId) {
          if (nextLoginState.loginSessionId) {
            await stopAccountLogin(nextLoginState.loginSessionId).catch(() => undefined);
          }
          return;
        }
        if (nextLoginState.status === 'completed') {
          await handleLoginCompleted(nextLoginState);
          return;
        }
        setLoginState(nextLoginState);
      } catch (error) {
        if (loginRequestRef.current !== requestId) {
          return;
        }

        setLoginState({
          loginSessionId: null,
          accountId: null,
          status: 'error',
          qrCodeDataUrl: null,
          lastError: error instanceof Error ? error.message : '二维码生成失败',
          notice: null,
          updatedAt: new Date().toISOString()
        });
        loginAccountCountBeforeStartRef.current = null;
      }
    },
    [accounts.length, handleLoginCompleted]
  );

  const handleToggleMonitoring = async (accountId: number, enabled: boolean) => {
    const confirmed = window.confirm(enabled ? '确定要启用该账号的侦测吗？' : '确定要停用该账号的侦测吗？');
    if (!confirmed) {
      return;
    }

    const updatedAccount = await updateAccountMonitoring(accountId, enabled);
    setAccounts((current) => current.map((account) => (account.id === accountId ? updatedAccount : account)));
  };

  const handleDeleteAccount = async (accountId: number) => {
    const confirmed = window.confirm('确定要删除该账号吗？此操作不可恢复。');
    if (!confirmed) {
      return;
    }

    await deleteAccount(accountId);
    setAccounts((current) => current.filter((account) => account.id !== accountId));
  };

  return (
    <div className="content-stack">
      {loginNotice && typeof document !== 'undefined'
        ? createPortal(
            <div aria-live="polite" className="account-notice account-notice-success" role="status">
              {loginNotice}
            </div>,
            document.body
          )
        : null}

      <section className="section-card">
        <div className="accounts-toolbar-row">
          <div className="accounts-toolbar-item">
            <button className="toolbar-button toolbar-button-wide" type="button">
              <CommandLineIcon />
              批量巡检
            </button>
          </div>

          <div className="accounts-toolbar-item">
            <button
              className="toolbar-button toolbar-button-primary toolbar-button-wide"
              type="button"
              onClick={() => {
                resetModalState();
                setSelectedLoginPlatform('rain-classroom');
                setIsModalOpen(true);
              }}
            >
              <UserPlusIcon />
              添加账号
            </button>
          </div>

          <div className="accounts-toolbar-item">
            <button
              aria-label="刷新账号列表"
              className="toolbar-button toolbar-button-wide"
              type="button"
              onClick={() => void loadAccounts('manual')}
            >
              <ArrowPathIcon />
              {isRefreshing ? '刷新中' : '刷新'}
            </button>
          </div>

          <div className="accounts-toolbar-item">
            <FilterDropdown
              label="平台筛选"
              value={platformFilter}
              options={platformOptions}
              open={openDropdown === 'platform'}
              onToggle={() => setOpenDropdown((current) => (current === 'platform' ? null : 'platform'))}
              onSelect={(value) => {
                setPlatformFilter(value);
                setOpenDropdown(null);
              }}
            />
          </div>

          <div className="accounts-toolbar-item">
            <FilterDropdown
              label="状态筛选"
              value={statusFilter}
              options={statusOptions}
              open={openDropdown === 'status'}
              onToggle={() => setOpenDropdown((current) => (current === 'status' ? null : 'status'))}
              onSelect={(value) => {
                setStatusFilter(value);
                setOpenDropdown(null);
              }}
            />
          </div>
        </div>
      </section>

      <section className="section-card">
        <header className="section-header">
          <div>
            <h2>账号池概览</h2>
            <p>当前以“登录后接口返回是否正常”为唯一健康判断标准。</p>
          </div>
        </header>

        <div className="account-card-grid account-card-grid-fixed">
          {isLoading ? (
            <div className="account-card account-card-empty">加载中...</div>
          ) : filteredAccounts.length === 0 ? (
            <div className="account-card account-card-empty">暂无账号数据</div>
          ) : (
            filteredAccounts.map((row) => {
              const tone = statusTone[row.status];
              const ToneIcon = tone.icon;
              const expanded = expandedAccounts.includes(row.id);
              const statusTooltip =
                row.status === 'error'
                  ? row.lastErrorReason || row.monitorLastError || 'api error'
                  : undefined;
              const isErrorTooltipVisible = row.status === 'error' && statusTooltip && hoveredErrorBadgeAccountId === row.id;

              return (
                <article key={row.id} className="account-card">
                  <div className="account-card-header">
                    <div className="account-card-primary">
                      <span className="account-card-kicker">用户ID</span>
                      <strong>{row.userId || '-'}</strong>
                      <span className="account-card-name">{row.name || row.accountKey}</span>
                    </div>
                    <span
                      className="status-badge-anchor"
                      onMouseEnter={() => {
                        if (statusTooltip) {
                          setHoveredErrorBadgeAccountId(row.id);
                        }
                      }}
                      onMouseLeave={() => setHoveredErrorBadgeAccountId((current) => (current === row.id ? null : current))}
                      onFocus={() => {
                        if (statusTooltip) {
                          setHoveredErrorBadgeAccountId(row.id);
                        }
                      }}
                      onBlur={() => setHoveredErrorBadgeAccountId((current) => (current === row.id ? null : current))}
                    >
                      <span className={tone.className} title={statusTooltip} tabIndex={statusTooltip ? 0 : -1}>
                        <ToneIcon />
                        {tone.label}
                      </span>
                      {isErrorTooltipVisible ? (
                        <span className="status-badge-tooltip" role="tooltip">
                          {statusTooltip}
                        </span>
                      ) : null}
                    </span>
                  </div>

                  <div className="account-card-meta">
                    <div className="account-meta-item">
                      <span>平台</span>
                      <strong>{platformLabelByValue[row.platform] ?? row.platform}</strong>
                    </div>
                    <div className="account-meta-item">
                      <span>监测状态</span>
                      <strong>{row.monitorStatus || 'idle'}</strong>
                    </div>
                    <div className="account-meta-item">
                      <span>最近检测</span>
                      <strong>{formatTimestamp(row.monitorUpdatedAt || row.lastCheckedAt)}</strong>
                    </div>
                    <div className="account-meta-item">
                      <span>创建时间</span>
                      <strong>{formatTimestamp(row.createdAt)}</strong>
                    </div>
                  </div>

                  <div className="account-card-actions">
                    <button
                      aria-label={row.monitoringEnabled ? '停用侦测' : '启用侦测'}
                      className="account-action-button"
                      type="button"
                      onClick={() => void handleToggleMonitoring(row.id, !row.monitoringEnabled)}
                    >
                      {row.monitoringEnabled ? '停用侦测' : '启用侦测'}
                    </button>
                    <button
                      aria-label="删除账号"
                      className="account-action-button account-action-button-danger"
                      type="button"
                      onClick={() => void handleDeleteAccount(row.id)}
                    >
                      删除账号
                    </button>
                  </div>

                  <button
                    aria-label={expanded ? '收起账号详情' : '展开账号详情'}
                    className="account-log-toggle"
                    type="button"
                    onClick={() => toggleExpanded(row.id)}
                  >
                    {expanded ? '收起日志' : '展开日志'}
                  </button>

                  {expanded ? (
                    <div aria-label="账号日志" className="account-log-panel account-log-panel-scrollable">
                      {(row.recentLogs?.length ?? 0) === 0 ? (
                        <p className="account-log-empty">暂无实时日志</p>
                      ) : (
                        <ol className="account-log-list">
                          {row.recentLogs!.map((log) => (
                            <li key={log.id} className="account-log-line">
                              <time className="account-log-time account-log-time-fixed" dateTime={log.at}>
                                {formatTimestamp(log.at)}
                              </time>
                              <span className="account-log-message">{log.message}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  ) : null}
                </article>
              );
            })
          )}
        </div>
      </section>

      {isModalOpen ? (
        <div className="floating-modal-overlay" onClick={() => void closeLoginModal()}>
          <section
            aria-label="添加账号弹层"
            className="floating-modal floating-modal-qr"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="floating-modal-body floating-modal-body-centered">
              {loginState.qrCodeDataUrl ? (
                <img alt="扫码登录二维码" className="qr-code-image qr-code-image-full" src={loginState.qrCodeDataUrl} />
              ) : loginState.status === 'pending' ? (
                <div aria-label="二维码加载中" className="qr-spinner" />
              ) : loginState.status === 'error' ? (
                <div className="qr-login-panel qr-login-panel-error">
                  <p>{loginState.lastError || '二维码生成失败'}</p>
                  <button
                    className="toolbar-button toolbar-button-primary"
                    type="button"
                    onClick={() => void handleCreateAccount(selectedLoginPlatform)}
                  >
                    重试
                  </button>
                </div>
              ) : (
                <div className="qr-login-panel qr-login-panel-select">
                  <FilterDropdown
                    label="登录平台"
                    value={selectedLoginPlatform}
                    options={platformOptions.filter((option) => option.value !== 'all')}
                    open={openDropdown === 'loginPlatform'}
                    onToggle={() => setOpenDropdown((current) => (current === 'loginPlatform' ? null : 'loginPlatform'))}
                    onSelect={(value) => {
                      setSelectedLoginPlatform(value);
                      setOpenDropdown(null);
                    }}
                  />
                  <button
                    className="toolbar-button toolbar-button-primary"
                    type="button"
                    onClick={() => void handleCreateAccount(selectedLoginPlatform)}
                  >
                    生成登录二维码
                  </button>
                </div>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
