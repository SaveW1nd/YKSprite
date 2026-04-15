import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

type DownloadedQuestionImage = {
  filePath: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  sha256: string;
};

const extensionFromMimeType = (mimeType: string) => {
  if (mimeType.includes('png')) return 'png';
  if (mimeType.includes('webp')) return 'webp';
  if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
  return 'bin';
};

export const downloadQuestionImage = async (
  imageUrl: string,
  outputDir = path.resolve(process.cwd(), 'data', 'captures')
): Promise<DownloadedQuestionImage> => {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Failed to download question image with status ${response.status}`);
  }

  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream';
  const extension = extensionFromMimeType(mimeType);
  const buffer = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(buffer).digest('hex');

  mkdirSync(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `capture-${Date.now()}.${extension}`);
  writeFileSync(filePath, buffer);

  return {
    filePath,
    mimeType,
    width: null,
    height: null,
    sha256
  };
};
