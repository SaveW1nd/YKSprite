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
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        },
        {
          id: 2,
          name: '备用 key',
          apiKeyMasked: 'qwen-tes••••',
          isActive: false,
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        }
      ]
    };
    fetchApiConfigMock.mockResolvedValue(initialSnapshot);
    addQwenApiKeyMock.mockResolvedValue({
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
          createdAt: '2026-04-20T00:00:00.000Z',
          updatedAt: '2026-04-20T00:00:00.000Z'
        }
      ]
    });
    enableQwenApiKeyMock.mockResolvedValue({
      model: 'qwen3-vl-flash-2026-01-22',
      hasActiveKey: true,
      activeKeyId: 2,
      activeKeyName: '备用 key',
      keys: initialSnapshot.keys.map((key) => ({
        ...key,
        isActive: key.id === 2
      }))
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

    fireEvent.click(screen.getByRole('button', { name: '启用 备用 key' }));

    await waitFor(() => {
      expect(enableQwenApiKeyMock).toHaveBeenCalledWith(2);
    });

    fireEvent.click(screen.getByRole('button', { name: '删除 备用 key' }));

    await waitFor(() => {
      expect(deleteQwenApiKeyMock).toHaveBeenCalledWith(2);
    });
  });
});
