import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiPage } from './ApiPage';

const {
  fetchApiConfigMock,
  addQwenApiKeyMock,
  enableQwenApiKeyMock,
  deleteQwenApiKeyMock
} = vi.hoisted(() => ({
  fetchApiConfigMock: vi.fn<typeof import('../lib/api').fetchApiConfig>(),
  addQwenApiKeyMock: vi.fn<typeof import('../lib/api').addQwenApiKey>(),
  enableQwenApiKeyMock: vi.fn<typeof import('../lib/api').enableQwenApiKey>(),
  deleteQwenApiKeyMock: vi.fn<typeof import('../lib/api').deleteQwenApiKey>()
}));

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api');
  return {
    ...actual,
    fetchApiConfig: fetchApiConfigMock,
    addQwenApiKey: addQwenApiKeyMock,
    enableQwenApiKey: enableQwenApiKeyMock,
    deleteQwenApiKey: deleteQwenApiKeyMock
  };
});

afterEach(() => {
  fetchApiConfigMock.mockReset();
  addQwenApiKeyMock.mockReset();
  enableQwenApiKeyMock.mockReset();
  deleteQwenApiKeyMock.mockReset();
});

describe('ApiPage', () => {
  it('loads qwen keys and supports add, enable, and delete actions', async () => {
    const initialSnapshot = {
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: true,
      activeKeyId: 1,
      activeKeyName: '主账号 key',
      keys: [
        {
          id: 1,
          name: '主账号 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: true,
          lastCheckStatus: 'success' as const,
          lastCheckReason: null,
          lastCheckedAt: '2026-04-20T00:00:00.000Z',
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        },
        {
          id: 2,
          name: '备用 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: false,
          lastCheckStatus: 'unchecked' as const,
          lastCheckReason: null,
          lastCheckedAt: null,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        }
      ]
    };
    fetchApiConfigMock.mockResolvedValue(initialSnapshot);
    addQwenApiKeyMock.mockResolvedValue({
      snapshot: {
        model: 'qwen3-vl-flash-2026-01-22',
        hasActiveKey: true,
        activeKeyId: 1,
        activeKeyName: '主账号 key',
        keys: [
          ...initialSnapshot.keys,
          {
            id: 3,
            name: '新 key',
            apiKeyMasked: 'qwen-tes••••',
            isActive: false,
            lastCheckStatus: 'success' as const,
            lastCheckReason: null,
            lastCheckedAt: '2026-04-20T00:00:01.000Z',
            createdAt: '2026-04-20T00:00:00.000Z',
            updatedAt: '2026-04-20T00:00:00.000Z'
          }
        ]
      },
      check: {
        status: 'success',
        reason: null,
        checkedAt: '2026-04-20T00:00:01.000Z',
        activated: false
      }
    });
    enableQwenApiKeyMock.mockResolvedValue({
      snapshot: {
        model: 'qwen3-vl-flash-2026-01-22',
        hasActiveKey: true,
        activeKeyId: 2,
        activeKeyName: '备用 key',
        keys: initialSnapshot.keys.map((key) => ({
          ...key,
          isActive: key.id === 2,
          lastCheckStatus: key.id === 2 ? 'success' as const : key.lastCheckStatus,
          lastCheckedAt: key.id === 2 ? '2026-04-20T00:00:02.000Z' : key.lastCheckedAt
        }))
      },
      check: {
        status: 'success',
        reason: null,
        checkedAt: '2026-04-20T00:00:02.000Z',
        activated: true
      }
    });
    deleteQwenApiKeyMock.mockResolvedValue({
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: true,
      activeKeyId: 1,
      activeKeyName: '主账号 key',
      keys: initialSnapshot.keys.filter((key) => key.id !== 2)
    });

    render(<ApiPage />);

    expect(await screen.findByRole('heading', { name: 'API 列表' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'API 管理中心' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开添加 API 弹窗' })).toHaveClass('api-action-button');
    expect(screen.getByRole('button', { name: '删除 备用 key' })).toHaveClass('api-action-button');

    fireEvent.click(screen.getByRole('button', { name: '打开添加 API 弹窗' }));
    expect(screen.getByRole('dialog', { name: '添加 API' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('API 名称'), { target: { value: '新 key' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'qwen-test-key-3' } });
    fireEvent.click(screen.getByRole('button', { name: '确认添加 API' }));

    await waitFor(() => {
      expect(addQwenApiKeyMock).toHaveBeenCalledWith({
        name: '新 key',
        apiKey: 'qwen-test-key-3'
      });
    });
    expect(await screen.findByText('检测成功，已保存')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '添加 API' })).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: '启用 备用 key' }));

    await waitFor(() => {
      expect(enableQwenApiKeyMock).toHaveBeenCalledWith(2);
    });

    fireEvent.click(screen.getByRole('button', { name: '删除 备用 key' }));

    await waitFor(() => {
      expect(deleteQwenApiKeyMock).toHaveBeenCalledWith(2);
    });
  });

  it('shows api validation errors in the card status badge while keeping enable action', async () => {
    fetchApiConfigMock.mockResolvedValue({
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: false,
      activeKeyId: null,
      activeKeyName: null,
      keys: [
        {
          id: 1,
          name: '错误 key',
          apiKeyMasked: 'bad-key••••',
          isActive: false,
          lastCheckStatus: 'error',
          lastCheckReason: 'Invalid API-key provided.',
          lastCheckedAt: '2026-04-20T00:00:00.000Z',
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        }
      ]
    });

    render(<ApiPage />);

    const errorBadge = await screen.findByText('错误');
    expect(errorBadge).toHaveClass('status-badge-error');
    expect(errorBadge).toHaveAttribute('title', 'Invalid API-key provided.');
    expect(screen.getByRole('button', { name: '启用 错误 key' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '删除 错误 key' })).toBeInTheDocument();
  });

  it('keeps the add modal open and shows a floating failure notice when validation fails', async () => {
    const emptySnapshot = {
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: false,
      activeKeyId: null,
      activeKeyName: null,
      keys: []
    };
    fetchApiConfigMock.mockResolvedValue(emptySnapshot);
    addQwenApiKeyMock.mockResolvedValue({
      snapshot: emptySnapshot,
      check: {
        status: 'error',
        reason: 'Invalid API-key provided.',
        checkedAt: '2026-04-20T00:00:01.000Z',
        activated: false
      }
    });

    render(<ApiPage />);

    fireEvent.click(await screen.findByRole('button', { name: '打开添加 API 弹窗' }));
    fireEvent.change(screen.getByLabelText('API 名称'), { target: { value: '错误 key' } });
    fireEvent.change(screen.getByLabelText('API Key'), { target: { value: 'bad-key' } });
    fireEvent.click(screen.getByRole('button', { name: '确认添加 API' }));

    expect(await screen.findByText('检测失败：Invalid API-key provided.')).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: '添加 API' })).toBeInTheDocument();
    expect(screen.queryByText('错误 key')).not.toBeInTheDocument();
  });
});
