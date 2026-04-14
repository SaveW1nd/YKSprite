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

  return {
    text,
    sourceImage: screenshot ? `data:${screenshot.mimeType};base64,${screenshot.data}` : null,
    confidenceNote: screenshot ? 'screenshot-captured-html-fallback' : 'html-fallback'
  };
};
