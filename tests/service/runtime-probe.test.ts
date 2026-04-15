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

const exerciseHtml = `
  <section class="page-exercise">
    <section class="container box-center">
      <section class="slide__cmp">
        <div class="time-box">
          <div class="timing willEnd">老师可能会随时结束答题</div>
        </div>
        <div class="slide__shape problem-title">函数 f(x) 的导数是？</div>
        <div class="slide__shape option">A</div>
        <div class="slide__shape option">B</div>
        <div class="slide__shape submit-btn">提交答案</div>
        <div class="tips f12 c333">请在题目中点击选项后提交答案</div>
      </section>
    </section>
  </section>
`;

const exerciseVisibleText = `
演示文稿1
课堂动态
上课啦！
老师可能会随时结束答题

A

B

提交答案
请在题目中点击选项后提交答案
`;

const subjectiveHtml = `
  <section class="page-subjective">
    <section class="page-container">
      <div class="subjective-inner">
        <div class="problem-tag">主观题</div>
        <div class="submission__text">
          <textarea class="submission-textarea" placeholder="请输入答案"></textarea>
        </div>
        <div class="submit-btn">提交答案</div>
      </div>
    </section>
  </section>
`;

const subjectiveVisibleText = `
4月15日授课（6）
课堂动态
上课啦！
主观题
请简述牛顿第一定律
请输入答案
提交答案
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

  it('detects question state on fullscreen exercise pages', () => {
    const status = probeRuntimeStatus({
      currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/1664192052646150656/exercise/7',
      pageTitle: 'test',
      html: exerciseHtml
    });

    expect(status).toMatchObject({
      connected: true,
      loggedIn: true,
      courseTitle: 'test',
      lessonState: 'in_class',
      questionDetected: true
    });
  });

  it('extracts structured question records from fullscreen exercise html', () => {
    const questions = extractQuestionsFromHtml(
      exerciseHtml,
      'test',
      undefined,
      'https://www.yuketang.cn/lesson/fullscreen/v3/1664192052646150656/exercise/7'
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      questionId: 'exercise-7',
      courseTitle: 'test',
      type: 'single_choice',
      body: '函数 f(x) 的导数是？',
      options: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' }
      ]
    });
  });

  it('falls back to visible text when fullscreen exercise options are not in html nodes', () => {
    const questions = extractQuestionsFromHtml(
      '<section class="page-exercise"></section>',
      'test',
      exerciseVisibleText,
      'https://www.yuketang.cn/lesson/fullscreen/v3/1664192052646150656/exercise/7'
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      questionId: 'exercise-7',
      courseTitle: 'test',
      options: [
        { key: 'A', value: 'A' },
        { key: 'B', value: 'B' }
      ]
    });
  });

  it('detects subjective pages as in-class question pages', () => {
    const status = probeRuntimeStatus({
      currentUrl: 'https://www.yuketang.cn/lesson/fullscreen/v3/1664433050987038464/subjective/2',
      pageTitle: 'test',
      html: subjectiveHtml,
      text: subjectiveVisibleText
    });

    expect(status).toMatchObject({
      connected: true,
      loggedIn: true,
      lessonState: 'in_class',
      questionDetected: true
    });
  });

  it('extracts a subjective question record from subjective pages', () => {
    const questions = extractQuestionsFromHtml(
      subjectiveHtml,
      'test',
      subjectiveVisibleText,
      'https://www.yuketang.cn/lesson/fullscreen/v3/1664433050987038464/subjective/2'
    );

    expect(questions).toHaveLength(1);
    expect(questions[0]).toMatchObject({
      questionId: 'subjective-2',
      courseTitle: 'test',
      type: 'subjective',
      body: '',
      options: []
    });
  });
});
