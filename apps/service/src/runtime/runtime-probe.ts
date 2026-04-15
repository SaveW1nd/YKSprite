import type { PageSnapshot } from '../browser/browser-controller.js';
import type { LessonState, RuntimeStatus } from './runtime-types.js';
import { extractQuestionsFromHtml } from './question-extractor.js';

const pickLessonState = (html: string, pageTitle: string | null, currentUrl: string | null): LessonState => {
  const target = `${pageTitle ?? ''} ${html}`;
  if (currentUrl && /\/exercise\//.test(currentUrl)) return 'in_class';
  if (/已结束|下课|课程结束/.test(target)) return 'ended';
  if (/未开始|即将开始|待上课/.test(target)) return 'waiting';
  if (/上课中|课中|进行中/.test(target)) return 'in_class';
  return 'idle';
};

const extractCourseTitle = (html: string, pageTitle: string | null) => {
  const headingMatch = html.match(/<h1[^>]*>(.*?)<\/h1>/i) ?? html.match(/<h2[^>]*>(.*?)<\/h2>/i);
  if (headingMatch?.[1]) {
    return headingMatch[1].replace(/<[^>]+>/g, '').trim() || null;
  }

  if (pageTitle) {
    return pageTitle.split('-')[0].trim() || pageTitle;
  }

  return null;
};

export const probeRuntimeStatus = (snapshot: PageSnapshot): RuntimeStatus => {
  const html = snapshot.html ?? '';
  const questions = extractQuestionsFromHtml(
    html,
    extractCourseTitle(html, snapshot.pageTitle),
    snapshot.text ?? null,
    snapshot.currentUrl
  );
  const currentUrl = snapshot.currentUrl;
  const loggedIn = Boolean(currentUrl && /yuketang\.cn/.test(currentUrl) && !/login|signin|passport/.test(currentUrl));

  return {
    connected: Boolean(currentUrl),
    loggedIn,
    courseTitle: extractCourseTitle(html, snapshot.pageTitle),
    lessonState: pickLessonState(html, snapshot.pageTitle, currentUrl),
    checkinAvailable: /签到|立即签到|check-?in/i.test(html),
    questionDetected: questions.length > 0,
    currentUrl,
    pageTitle: snapshot.pageTitle,
    lastScannedAt: new Date().toISOString()
  };
};
