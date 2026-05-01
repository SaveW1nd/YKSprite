import React from 'react';
import type { SectionMetric } from '../app-data';
import { answerStatusLabel, formatAnswer, formatTimestamp, isSubmittedStatus, platformLabel } from '../lib/display';
import { fetchAnswerHistory, subscribeDashboardEvents, type AnswerHistoryItem } from '../lib/api';
import { usePageMetrics } from '../lib/page-metrics';

const getUnsubmittedReason = (item: AnswerHistoryItem) => item.lastError || answerStatusLabel(item.submitStatus);

export function AnswersPage() {
  const { setSectionMetrics } = usePageMetrics();
  const [items, setItems] = React.useState<AnswerHistoryItem[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [pageError, setPageError] = React.useState<string | null>(null);
  const [previewItem, setPreviewItem] = React.useState<AnswerHistoryItem | null>(null);
  const successCount = React.useMemo(
    () => items.filter((item) => ['submitted', 'already_completed'].includes(item.submitStatus)).length,
    [items]
  );
  const uniqueAccountCount = React.useMemo(
    () => new Set(items.map((item) => item.account.id ?? item.account.name)).size,
    [items]
  );

  const loadAnswers = React.useCallback(async (showLoading = false) => {
    if (showLoading) {
      setIsLoading(true);
    }
    try {
      setPageError(null);
      const nextItems = await fetchAnswerHistory();
      setItems(nextItems);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : '加载答题情况失败');
      setItems([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let cancelled = false;

    void loadAnswers(true);

    const unsubscribe = subscribeDashboardEvents(() => {
      if (!cancelled) {
        void loadAnswers();
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [loadAnswers]);

  React.useEffect(() => {
    const metrics: SectionMetric[] = [
      {
        label: '答题记录',
        value: String(items.length),
        hint: '已记录的自动答题 attempt'
      },
      {
        label: '成功提交',
        value: String(successCount),
        hint: '已提交和已完成'
      },
      {
        label: '涉及账号',
        value: String(uniqueAccountCount),
        hint: '按账号归属统计'
      }
    ];

    setSectionMetrics('answers', metrics);
  }, [items.length, setSectionMetrics, successCount, uniqueAccountCount]);

  React.useEffect(() => {
    return () => {
      setSectionMetrics('answers', null);
    };
  }, [setSectionMetrics]);

  return (
    <div className="content-stack">
      <section className="section-card">
        <header className="section-header answer-list-header">
          <div>
            <h2>答题记录</h2>
            <p>查看截图、提交答案和账号归属。</p>
          </div>
        </header>

        {pageError ? (
          <div className="api-inline-alert api-inline-alert-error" role="alert">
            <span>{pageError}</span>
          </div>
        ) : null}

        {isLoading ? <div className="account-card account-card-empty">正在加载答题记录…</div> : null}

        {!isLoading && items.length === 0 ? (
          <div className="account-card account-card-empty">暂无答题记录</div>
        ) : null}

        {!isLoading && items.length > 0 ? (
          <div className="answer-card-list">
            {items.map((item) => {
              const accountName = item.account.userId || item.account.name;
              const answerText = formatAnswer(item.answerJson);
              const platformText = platformLabel(item.account.platform);
              const submitted = isSubmittedStatus(item.submitStatus);
              const submittedAtText = formatTimestamp(item.submittedAt, '未提交');

              return (
                <article key={item.id} className="answer-card">
                  <div className="answer-card-bullets" aria-label="答题状态">
                    <span className="answer-bullet answer-bullet-platform" title={platformText}>
                      {platformText}
                    </span>
                    <span
                      className={`answer-bullet ${submitted ? 'answer-bullet-submitted' : 'answer-bullet-unsubmitted'}`}
                      title={submitted ? answerStatusLabel(item.submitStatus) : getUnsubmittedReason(item)}
                    >
                      {submitted ? '已提交' : '未提交'}
                    </span>
                  </div>

                  <div className="answer-capture-pane">
                    <button
                      aria-label={`查看题目截图 ${item.problemId || item.id}`}
                      className="answer-thumb-button"
                      disabled={!item.capture}
                      type="button"
                      onClick={() => setPreviewItem(item)}
                    >
                      {item.capture ? (
                        <>
                          <img alt="题目截图缩略图" className="answer-thumb-image" src={item.capture.url} />
                          <span className="answer-thumb-overlay">点击放大</span>
                        </>
                      ) : (
                        <span>无截图</span>
                      )}
                    </button>
                  </div>

                  <div className="answer-card-body">
                    <dl className="answer-field-grid">
                      <div className="answer-field">
                        <dt>用户 ID</dt>
                        <dd title={accountName}>{accountName}</dd>
                      </div>
                      <div className="answer-field">
                        <dt>提交时间</dt>
                        <dd title={submittedAtText}>{submittedAtText}</dd>
                      </div>
                      <div className="answer-field answer-field-course">
                        <dt>课程</dt>
                        <dd title={item.courseTitle || '未知课程'}>{item.courseTitle || '未知课程'}</dd>
                      </div>
                      <div className="answer-field answer-field-answer">
                        <dt>最终提交答案</dt>
                        <dd title={answerText}>{answerText}</dd>
                      </div>
                    </dl>
                  </div>
                </article>
              );
            })}
          </div>
        ) : null}
      </section>

      {previewItem?.capture ? (
        <div className="floating-modal-overlay answer-preview-overlay" role="presentation" onClick={() => setPreviewItem(null)}>
          <div
            aria-label="题目截图预览"
            aria-modal="true"
            className="floating-modal answer-preview-modal"
            role="dialog"
            onClick={(event) => event.stopPropagation()}
          >
            <img alt="放大的题目截图" className="answer-preview-image" src={previewItem.capture.url} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
