import { describe, expect, it } from 'vitest';
import { probeRuntimeStatus } from '../../apps/service/src/runtime/runtime-probe';
import { extractQuestionsFromHtml } from '../../apps/service/src/runtime/question-extractor';

const lessonHtml = `
  <main>
    <h1>高等数学</h1>
    <div>课堂 · 上课中</div>
    <button>立即签到</button>
    <section data-question-id="q-1">
      <div class="question-body">函数 f(x) 的导数是？</div>
      <div>单选题</div>
      <ul>
        <li data-option-key="A">x</li>
        <li data-option-key="B">2x</li>
      </ul>
    </section>
  </main>
`;

describe('runtime probe', () => {
  it('extracts course and lesson state from a lesson page', () => {
    const status = probeRuntimeStatus({
      currentUrl: 'https://www.yuketang.cn/lesson/123',
      pageTitle: '高等数学 - 雨课堂',
      html: lessonHtml
    });

    expect(status).toMatchObject({
      connected: true,
      loggedIn: true,
      courseTitle: '高等数学',
      lessonState: 'in_class',
      checkinAvailable: true,
      questionDetected: true
    });
  });

  it('keeps the lesson state idle on the logged-in home page', () => {
    const status = probeRuntimeStatus({
      currentUrl: 'https://www.yuketang.cn/v2/web/index',
      pageTitle: '雨课堂',
      html: '<main><div>欢迎使用雨课堂网页版</div></main>'
    });

    expect(status).toMatchObject({
      connected: true,
      loggedIn: true,
      courseTitle: '雨课堂',
      lessonState: 'idle',
      checkinAvailable: false,
      questionDetected: false
    });
  });

  it('extracts structured question records from lesson html', () => {
    const questions = extractQuestionsFromHtml(lessonHtml, '高等数学');

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      questionId: 'q-1',
      courseTitle: '高等数学',
      type: 'single_choice',
      body: '函数 f(x) 的导数是？',
      options: [
        { key: 'A', value: 'x' },
        { key: 'B', value: '2x' }
      ]
    });
  });
});
