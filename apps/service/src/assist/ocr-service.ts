import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { PageSnapshot, ScreenshotPayload } from '../browser/browser-controller.js';
import type { OcrResult } from './assist-types.js';

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export const extractOcrResult = (snapshot: PageSnapshot, screenshot: ScreenshotPayload): OcrResult => {
  const text = stripHtml(snapshot.html ?? '');
  let savedImagePath: string | null = null;

  if (screenshot) {
    const captureDir = path.resolve(process.cwd(), 'data', 'captures');
    mkdirSync(captureDir, { recursive: true });
    savedImagePath = path.join(captureDir, `capture-${Date.now()}.png`);
    writeFileSync(savedImagePath, Buffer.from(screenshot.data, 'base64'));
  }

  return {
    text,
    sourceImage: screenshot ? `data:${screenshot.mimeType};base64,${screenshot.data}` : null,
    savedImagePath,
    confidenceNote: screenshot ? 'screenshot-captured-html-fallback' : 'html-fallback'
  };
};
