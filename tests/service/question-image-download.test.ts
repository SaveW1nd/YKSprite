import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadQuestionImage } from '../../apps/service/src/assist/question-image-download';

const outputDir = '/tmp/yksprite-question-image-test';

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(outputDir, { recursive: true, force: true });
});

describe('downloadQuestionImage', () => {
  it('downloads a question image to the capture directory with checksum metadata', async () => {
    const payload = Buffer.from('fake-image-payload');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        headers: {
          get: (name: string) => (name === 'content-type' ? 'image/jpeg' : null)
        },
        arrayBuffer: async () => payload
      })
    );

    const result = await downloadQuestionImage('https://example.com/question-image', outputDir);

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.filePath.startsWith(path.join(outputDir, 'capture-'))).toBe(true);
    expect(result.filePath.endsWith('.jpg')).toBe(true);
    expect(existsSync(result.filePath)).toBe(true);
    expect(readFileSync(result.filePath)).toEqual(payload);
    expect(result.sha256).toHaveLength(64);
  });
});
