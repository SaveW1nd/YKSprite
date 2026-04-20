import React from 'react';
import { CheckCircleIcon, PlusIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { SectionMetric } from '../app-data';
import {
  addQwenApiKey,
  deleteQwenApiKey,
  enableQwenApiKey,
  fetchApiConfig,
  type ApiConfigSnapshot
} from '../lib/api';
import { usePageMetrics } from '../lib/page-metrics';

const formatTimestamp = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export function ApiPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [snapshot, setSnapshot] = React.useState<ApiConfigSnapshot | null>(null);
  const [name, setName] = React.useState('');
  const [apiKey, setApiKey] = React.useState('');
  const [isLoading, setIsLoading] = React.useState(true);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [pendingActionId, setPendingActionId] = React.useState<number | null>(null);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = React.useState(false);

  const loadSnapshot = React.useCallback(async () => {
    try {
      setPageError(null);
      setSnapshot(await fetchApiConfig());
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '加载 API 配置失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  React.useEffect(() => {
    const metrics: SectionMetric[] = [
      {
        label: 'API 总数',
        value: String(snapshot?.keys.length ?? 0),
        hint: '已保存的 Qwen key'
      },
      {
        label: 'API 管理',
        value: snapshot?.hasActiveKey ? '就绪' : '待配置',
        hint: snapshot?.activeKeyName ?? '暂无启用 key'
      }
    ];

    setSectionMetrics('api', metrics);
  }, [setSectionMetrics, snapshot]);

  React.useEffect(() => {
    return () => {
      setSectionMetrics('api', null);
    };
  }, [setSectionMetrics]);

  const resetCreateForm = React.useCallback(() => {
    setName('');
    setApiKey('');
  }, []);

  const closeCreateModal = React.useCallback(() => {
    setIsCreateModalOpen(false);
    resetCreateForm();
  }, [resetCreateForm]);

  const handleAdd = React.useCallback(async () => {
    setIsSubmitting(true);
    setPageError(null);

    try {
      const nextSnapshot = await addQwenApiKey({
        name: name.trim(),
        apiKey: apiKey.trim()
      });
      setSnapshot(nextSnapshot);
      closeCreateModal();
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '添加 API 失败');
    } finally {
      setIsSubmitting(false);
    }
  }, [apiKey, closeCreateModal, name]);

  const handleEnable = React.useCallback(async (id: number) => {
    setPendingActionId(id);
    setPageError(null);

    try {
      setSnapshot(await enableQwenApiKey(id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '启用 API 失败');
    } finally {
      setPendingActionId(null);
    }
  }, []);

  const handleDelete = React.useCallback(async (id: number) => {
    setPendingActionId(id);
    setPageError(null);

    try {
      setSnapshot(await deleteQwenApiKey(id));
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '删除 API 失败');
    } finally {
      setPendingActionId(null);
    }
  }, []);

  return (
    <div className="content-stack">
      <section className="section-card">
        <header className="section-header api-list-header">
          <div>
            <h2>API 列表</h2>
            <p>可以添加多个 Qwen key，但同一时间只会启用一条。</p>
          </div>
          <button
            aria-label="打开添加 API 弹窗"
            className="toolbar-button-primary api-action-button"
            type="button"
            onClick={() => {
              setPageError(null);
              setIsCreateModalOpen(true);
            }}
          >
            <PlusIcon />
            添加 API
          </button>
        </header>

        {pageError ? (
          <div className="api-inline-alert api-inline-alert-error" role="alert">
            <span>{pageError}</span>
          </div>
        ) : null}

        {isLoading && !snapshot ? <div className="account-card account-card-empty">正在加载 API 列表…</div> : null}

        {!isLoading && snapshot ? (
          <div className="account-card-grid">
            {snapshot.keys.length === 0 ? (
              <div className="account-card account-card-empty">还没有保存任何 API key</div>
            ) : (
              snapshot.keys.map((key) => (
                <article key={key.id} className="account-card">
                  <div className="account-card-header">
                    <div className="account-card-primary">
                      <span className="account-card-kicker">{key.isActive ? '启用中' : '未启用'}</span>
                      <strong>{key.name}</strong>
                      <span className="account-card-name">{key.apiKeyMasked}</span>
                    </div>
                    {key.isActive ? (
                      <span className="status-badge status-badge-healthy">
                        <CheckCircleIcon />
                        启用
                      </span>
                    ) : null}
                  </div>

                  <div className="account-card-meta">
                    <div className="account-meta-item">
                      <span>固定模型</span>
                      <strong>{snapshot.model}</strong>
                    </div>
                    <div className="account-meta-item">
                      <span>更新时间</span>
                      <strong>{formatTimestamp(key.updatedAt)}</strong>
                    </div>
                  </div>

                  <div className="row-actions">
                    <button
                      aria-label={`启用 ${key.name}`}
                      className="toolbar-button"
                      disabled={pendingActionId === key.id || key.isActive}
                      type="button"
                      onClick={() => void handleEnable(key.id)}
                    >
                      启用
                    </button>
                    <button
                      aria-label={`删除 ${key.name}`}
                      className="account-action-button account-action-button-danger api-action-button"
                      disabled={pendingActionId === key.id}
                      type="button"
                      onClick={() => void handleDelete(key.id)}
                    >
                      <TrashIcon />
                      删除
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        ) : null}
      </section>

      {isCreateModalOpen ? (
        <div
          aria-hidden={false}
          className="floating-modal-overlay"
          role="presentation"
          onClick={(event) => {
            if (event.target === event.currentTarget && !isSubmitting) {
              closeCreateModal();
            }
          }}
        >
          <div aria-label="添加 API" aria-modal="true" className="floating-modal api-create-modal" role="dialog">
            <header className="panel-card-header">
              <h3>添加 API</h3>
              <button
                aria-label="关闭添加 API 弹窗"
                className="toolbar-button api-modal-close"
                disabled={isSubmitting}
                type="button"
                onClick={() => closeCreateModal()}
              >
                <XMarkIcon />
              </button>
            </header>

            <div className="api-form-grid">
              <label className="strategy-field">
                <span>API 名称</span>
                <input
                  aria-label="API 名称"
                  className="api-text-input"
                  placeholder="例如：主账号 key"
                  type="text"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>

              <label className="strategy-field">
                <span>API Key</span>
                <input
                  aria-label="API Key"
                  className="api-text-input"
                  placeholder="输入新的 Qwen API key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                />
              </label>
            </div>

            <div className="row-actions api-provider-actions">
              <button
                aria-label="确认添加 API"
                className="toolbar-button-primary"
                disabled={isSubmitting || !name.trim() || !apiKey.trim()}
                type="button"
                onClick={() => void handleAdd()}
              >
                {isSubmitting ? '添加中' : '添加 API'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
