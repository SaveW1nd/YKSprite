<script setup lang="ts">
import { Menu, MenuButton, MenuItem, MenuItems, Switch } from '@headlessui/vue';
import {
  ArrowPathIcon,
  ArrowTopRightOnSquareIcon,
  BoltIcon,
  CheckCircleIcon,
  ClockIcon,
  EllipsisHorizontalIcon,
  PlayCircleIcon,
  StopCircleIcon
} from '@heroicons/vue/24/outline';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import {
  fetchBrowserStatus,
  fetchQuestionAnalysis,
  fetchQuestionCapture,
  fetchCurrentQuestion,
  fetchEvents,
  fetchHealth,
  fetchRuntimeMonitor,
  fetchRuntimeStatus,
  fetchSessionState,
  fetchTasks,
  saveSession,
  startBrowser,
  startLoginSession,
  startRuntimeMonitor,
  stopRuntimeMonitor,
  stopBrowser,
  type BrowserStatus,
  type CurrentQuestion,
  type EventRecord,
  type HealthResponse,
  type QuestionCapture,
  type RuntimeMonitorStatus,
  type RuntimeStatus,
  type SessionState,
  type TaskRecord,
  type VisionAnalysis
} from './lib/api';

type HealthItem = {
  label: string;
  value: string;
  tone: 'good' | 'watch' | 'neutral';
};

const service = ref<HealthResponse | null>(null);
const serviceState = ref<'checking' | 'online' | 'offline'>('checking');
const lastUpdated = ref('等待第一次健康检查');
const autoRefresh = ref(true);

const sessionState = ref<SessionState>({
  hasSession: false,
  savedAt: null,
  origin: null,
  cookieCount: 0,
  currentUrl: null,
  pageTitle: null,
  mode: null
});

const browser = ref<BrowserStatus>({
  status: 'idle',
  engine: 'chromium',
  headless: true,
  mode: null,
  startedAt: null,
  pageUrl: null,
  lastError: null
});

const runtimeStatus = ref<RuntimeStatus>({
  connected: false,
  loggedIn: false,
  courseTitle: null,
  lessonState: 'idle',
  checkinAvailable: false,
  questionDetected: false,
  currentUrl: null,
  pageTitle: null,
  lastScannedAt: null
});

const monitor = ref<RuntimeMonitorStatus>({
  enabled: false,
  phase: 'idle',
  currentCourse: null,
  currentLessonId: null,
  lastCheckedAt: null,
  lastTransitionAt: null,
  lastError: null
});

const currentQuestion = ref<CurrentQuestion | null>(null);
const currentCapture = ref<QuestionCapture | null>(null);
const currentAnalysis = ref<VisionAnalysis | null>(null);
const tasks = ref<TaskRecord[]>([]);
const events = ref<EventRecord[]>([]);

let refreshTimer: number | null = null;

const runningCount = computed(() => tasks.value.filter((task) => task.status === 'running').length);
const attentionCount = computed(() => tasks.value.filter((task) => task.status === 'failed').length);
const queuedCount = computed(() => tasks.value.filter((task) => task.status === 'queued').length);
const completedCount = computed(() => tasks.value.filter((task) => task.status === 'succeeded').length);

const browserStatusLabel = computed(() => {
  switch (browser.value.status) {
    case 'running':
      return 'Running';
    case 'starting':
      return 'Starting';
    case 'stopping':
      return 'Stopping';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
});

const browserStatusDescription = computed(() => {
  if (browser.value.lastError) return browser.value.lastError;
  if (browser.value.status === 'running') return browser.value.pageUrl ?? 'about:blank';
  if (browser.value.status === 'starting') return '无头浏览器正在初始化';
  if (browser.value.status === 'stopping') return '浏览器正在关闭';
  return '等待人工触发启动无头浏览器。';
});

const sessionSummary = computed(() => {
  if (!sessionState.value.hasSession) return '未保存会话';
  return `${sessionState.value.cookieCount} cookies · ${sessionState.value.savedAt ?? '未知时间'}`;
});

const lessonStateLabel = computed(() => {
  switch (runtimeStatus.value.lessonState) {
    case 'in_class':
      return '课堂中';
    case 'waiting':
      return '待上课';
    case 'ended':
      return '已结束';
    default:
      return '空闲';
  }
});

const runtimeSummary = computed(() => {
  if (!runtimeStatus.value.connected) return '浏览器尚未附着页面';
  return `${runtimeStatus.value.courseTitle ?? '未识别课程'} · ${lessonStateLabel.value}`;
});

const monitorSummary = computed(() => {
  if (monitor.value.lastError) return monitor.value.lastError;
  if (monitor.value.currentCourse) return monitor.value.currentCourse;
  if (monitor.value.phase === 'home_polling') return '正在首页轮询进行中的课堂';
  if (monitor.value.phase === 'idle') return '监控未启动';
  return '等待下一轮监控';
});

const analysisAnswerLabel = computed(() => {
  if (!currentAnalysis.value?.suggestedAnswer) return '待分析';
  return Array.isArray(currentAnalysis.value.suggestedAnswer)
    ? currentAnalysis.value.suggestedAnswer.join(', ')
    : currentAnalysis.value.suggestedAnswer;
});

const browserToneClass = computed(() => {
  if (browser.value.status === 'running') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (browser.value.status === 'error') return 'bg-rose-50 text-rose-700 ring-1 ring-rose-100';
  if (browser.value.status === 'starting' || browser.value.status === 'stopping') {
    return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  }
  return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200';
});

const canStartBrowser = computed(() => !['starting', 'running'].includes(browser.value.status));
const canStopBrowser = computed(() => !['idle', 'stopping'].includes(browser.value.status));

const healthCards = computed<HealthItem[]>(() => [
  { label: 'Docker Runtime', value: serviceState.value === 'online' ? 'Connected' : 'Unknown', tone: serviceState.value === 'online' ? 'good' : 'neutral' },
  { label: 'Browser Bridge', value: browserStatusLabel.value, tone: browser.value.status === 'running' ? 'good' : browser.value.status === 'error' ? 'watch' : 'neutral' },
  { label: 'Lesson State', value: lessonStateLabel.value, tone: runtimeStatus.value.lessonState === 'in_class' ? 'good' : 'neutral' },
  { label: 'Check-in', value: runtimeStatus.value.checkinAvailable ? 'Available' : 'Unavailable', tone: runtimeStatus.value.checkinAvailable ? 'watch' : 'neutral' },
  { label: 'Current Question', value: currentQuestion.value?.questionId ?? 'None', tone: currentQuestion.value ? 'good' : 'neutral' },
  { label: 'Saved Session', value: sessionState.value.hasSession ? 'Present' : 'Missing', tone: sessionState.value.hasSession ? 'good' : 'watch' }
]);

const syncHealth = async () => {
  try {
    service.value = await fetchHealth();
    serviceState.value = service.value.status === 'ok' ? 'online' : 'checking';
    lastUpdated.value = `最近同步 ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    serviceState.value = 'offline';
    lastUpdated.value = '健康检查不可达';
  }
};

const syncBrowser = async () => {
  try {
    browser.value = await fetchBrowserStatus();
  } catch {
    browser.value = { ...browser.value, status: 'error', lastError: '无法获取浏览器状态' };
  }
};

const syncSession = async () => {
  try {
    sessionState.value = await fetchSessionState();
  } catch {
    sessionState.value = { ...sessionState.value, hasSession: false, savedAt: null, origin: null, cookieCount: 0 };
  }
};

const syncRuntime = async () => {
  try {
    runtimeStatus.value = await fetchRuntimeStatus();
  } catch {
    runtimeStatus.value = {
      connected: false,
      loggedIn: false,
      courseTitle: null,
      lessonState: 'idle',
      checkinAvailable: false,
      questionDetected: false,
      currentUrl: null,
      pageTitle: null,
      lastScannedAt: null
    };
  }
};

const syncMonitor = async () => {
  try {
    monitor.value = await fetchRuntimeMonitor();
  } catch {
    monitor.value = {
      enabled: false,
      phase: 'idle',
      currentCourse: null,
      currentLessonId: null,
      lastCheckedAt: null,
      lastTransitionAt: null,
      lastError: '无法获取监控状态'
    };
  }
};

const syncCurrentQuestion = async () => {
  try {
    currentQuestion.value = await fetchCurrentQuestion();
    if (currentQuestion.value?.questionId) {
      const [capture, analysis] = await Promise.all([
        fetchQuestionCapture(currentQuestion.value.questionId),
        fetchQuestionAnalysis(currentQuestion.value.questionId)
      ]);
      currentCapture.value = capture;
      currentAnalysis.value = analysis;
    } else {
      currentCapture.value = null;
      currentAnalysis.value = null;
    }
  } catch {
    currentQuestion.value = null;
    currentCapture.value = null;
    currentAnalysis.value = null;
  }
};

const syncTasks = async () => {
  try {
    tasks.value = await fetchTasks();
  } catch {
    tasks.value = [];
  }
};

const syncEvents = async () => {
  try {
    events.value = await fetchEvents();
  } catch {
    events.value = [];
  }
};

const syncAll = async () => {
  await Promise.all([syncHealth(), syncBrowser(), syncSession(), syncRuntime(), syncMonitor(), syncCurrentQuestion(), syncTasks(), syncEvents()]);
};

const resetRefreshTimer = () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (autoRefresh.value) {
    refreshTimer = window.setInterval(() => {
      void syncAll();
    }, 12000);
  }
};

onMounted(async () => {
  await syncAll();
  resetRefreshTimer();
});

onBeforeUnmount(() => {
  if (refreshTimer !== null) window.clearInterval(refreshTimer);
});

const toggleRefresh = () => {
  autoRefresh.value = !autoRefresh.value;
  resetRefreshTimer();
};

const handleStartBrowser = async () => {
  browser.value = await startBrowser();
  await Promise.all([syncSession(), syncRuntime(), syncCurrentQuestion(), syncTasks(), syncEvents()]);
};

const handleStartLogin = async () => {
  browser.value = await startLoginSession();
  await Promise.all([syncSession(), syncRuntime(), syncCurrentQuestion(), syncTasks(), syncEvents()]);
};

const handleStopBrowser = async () => {
  browser.value = await stopBrowser();
  await Promise.all([syncSession(), syncRuntime(), syncCurrentQuestion(), syncTasks(), syncEvents()]);
};

const handleSaveSession = async () => {
  sessionState.value = await saveSession();
};

const handleRefreshStatus = async () => {
  await syncAll();
};

const handleStartMonitor = async () => {
  monitor.value = await startRuntimeMonitor();
  await syncAll();
};

const handleStopMonitor = async () => {
  monitor.value = await stopRuntimeMonitor();
  await syncAll();
};

const serviceChipClass = computed(() =>
  serviceState.value === 'online'
    ? 'status-chip status-chip--online'
    : serviceState.value === 'offline'
      ? 'status-chip status-chip--offline'
      : 'status-chip status-chip--checking'
);

const taskBadgeClass = (status: TaskRecord['status']) => {
  if (status === 'running') return 'task-badge task-badge--running';
  if (status === 'queued') return 'task-badge task-badge--queued';
  if (status === 'failed') return 'task-badge task-badge--attention';
  return 'task-badge task-badge--completed';
};

const eventToneClass = (level: EventRecord['level']) => ({
  'bg-emerald-50 text-emerald-700': level === 'live',
  'bg-amber-50 text-amber-700': level === 'alert',
  'bg-slate-100 text-slate-700': level === 'info'
});

const healthToneClass = (tone: HealthItem['tone']) => {
  if (tone === 'good') return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100';
  if (tone === 'watch') return 'bg-amber-50 text-amber-700 ring-1 ring-amber-100';
  return 'bg-slate-50 text-slate-700 ring-1 ring-slate-200';
};
</script>

<template>
  <div class="min-h-screen bg-grid bg-[size:28px_28px]">
    <div class="mx-auto flex min-h-screen max-w-[1680px] gap-6 px-4 py-4 text-shell-900 lg:px-6">
      <aside class="hidden w-[284px] shrink-0 flex-col rounded-[30px] bg-shell-900 px-5 py-6 text-white shadow-panel lg:flex">
        <div class="flex items-center gap-4">
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 font-display text-lg font-semibold tracking-[0.2em]">YK</div>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">Operations Console</p>
            <h1 class="font-display text-lg font-semibold">YKSprite</h1>
          </div>
        </div>

        <nav class="mt-10 space-y-2 text-sm">
          <a class="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 font-medium text-white" href="#overview"><span>概览</span><span class="text-xs text-white/50">01</span></a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#tasks"><span>任务</span><span class="text-xs text-white/40">02</span></a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#events"><span>事件</span><span class="text-xs text-white/40">03</span></a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#health"><span>系统健康</span><span class="text-xs text-white/40">04</span></a>
        </nav>

        <div class="mt-auto rounded-[28px] border border-white/10 bg-white/5 p-4">
          <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/45">服务状态</p>
          <div :class="serviceChipClass" class="mt-3">
            <span class="inline-block h-2.5 w-2.5 rounded-full bg-current" />
            <span v-if="serviceState === 'online'">在线</span>
            <span v-else-if="serviceState === 'offline'">离线</span>
            <span v-else>检查中</span>
          </div>
          <p class="mt-3 text-sm text-white/60">{{ lastUpdated }}</p>
        </div>
      </aside>

      <main class="flex-1 animate-rise space-y-6 py-1">
        <header id="overview" class="panel overflow-hidden p-6">
          <div class="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div class="space-y-5">
              <div class="space-y-2">
                <p class="section-kicker">任务运行总览</p>
                <h2 class="font-display text-3xl font-semibold tracking-tight text-shell-900 sm:text-4xl">YKSprite 控制台</h2>
                <p class="max-w-3xl text-sm leading-7 text-shell-700 sm:text-[15px]">
                  首页现在直接读取真实任务、事件、课堂状态和会话信息。没有数据时会明确显示空状态，避免误导。
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <div :class="serviceChipClass">
                  <span class="inline-block h-2.5 w-2.5 rounded-full bg-current" />
                  <span>{{ service?.name ?? 'Service Probe' }}</span>
                </div>
                <span class="rounded-full bg-shell-900/5 px-3 py-1 text-xs font-medium text-shell-700">{{ lastUpdated }}</span>
              </div>

              <div class="grid gap-3 sm:grid-cols-3">
                <div class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">浏览器接管</p>
                  <div class="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold" :class="browserToneClass">
                    <BoltIcon class="h-4 w-4" />
                    {{ browserStatusLabel }}
                  </div>
                  <p class="mt-3 text-sm text-shell-700 break-all">{{ browserStatusDescription }}</p>
                </div>
                <div class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">最近事件</p>
                  <strong class="mt-3 block font-display text-xl font-semibold tracking-tight text-shell-900">{{ events.length }} 条</strong>
                  <p class="mt-2 text-sm text-shell-700">{{ events[0]?.title ?? '当前没有事件，等待运行数据写入。' }}</p>
                </div>
                <div class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">已保存会话</p>
                  <strong class="mt-3 block font-display text-xl font-semibold tracking-tight text-shell-900">{{ sessionState.hasSession ? '已保存' : '未保存' }}</strong>
                  <p class="mt-2 text-sm text-shell-700">{{ sessionSummary }}</p>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3 sm:w-[360px]">
              <div class="rounded-[24px] bg-brand-600 px-4 py-4 text-white shadow-soft">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">当前题目</p>
                    <h3 class="mt-2 font-display text-xl">{{ currentQuestion?.questionId ?? '暂无题目' }}</h3>
                  </div>
                  <CheckCircleIcon class="h-10 w-10 text-white/80" />
                </div>
                <p class="mt-3 text-sm leading-6 text-white/80">
                  {{ currentQuestion?.body ?? '当前尚未检测到题目。进入课堂并触发扫描后，这里会显示真实题干。' }}
                </p>
              </div>

              <div class="panel space-y-4 px-4 py-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="section-kicker">操作入口</p>
                    <p class="mt-1 text-sm text-shell-700">手动触发浏览器接管、扫码登录和状态刷新。</p>
                  </div>
                  <div class="rounded-full bg-shell-100 px-3 py-1 text-xs font-semibold text-shell-700">Manual</div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <button :disabled="!canStartBrowser" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-shell-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-shell-700 disabled:cursor-not-allowed disabled:bg-shell-300" @click="handleStartBrowser">
                    <PlayCircleIcon class="h-5 w-5" />启动浏览器接管
                  </button>
                  <button class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300" @click="handleStartLogin">
                    <ArrowTopRightOnSquareIcon class="h-5 w-5" />扫码登录
                  </button>
                  <button :disabled="!canStopBrowser" class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400" @click="handleStopBrowser">
                    <StopCircleIcon class="h-5 w-5" />停止浏览器
                  </button>
                  <button class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300" @click="handleSaveSession">
                    <CheckCircleIcon class="h-5 w-5" />保存当前会话
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-shell-50 px-4 py-3">
                  <div>
                    <p class="section-kicker">刷新状态</p>
                    <p class="mt-1 text-sm text-shell-700">同步服务、浏览器、会话、课堂、任务与事件。</p>
                  </div>
                  <button class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-shell-900 transition hover:border-shell-300" @click="handleRefreshStatus">
                    <ArrowPathIcon class="h-4 w-4" />刷新状态
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-shell-50 px-4 py-3">
                  <div>
                    <p class="section-kicker">自动刷新</p>
                    <p class="mt-1 text-sm text-shell-700">保持首页与后台状态同步。</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="text-sm font-medium text-shell-700">{{ autoRefresh ? '已开启' : '已关闭' }}</span>
                    <Switch :model-value="autoRefresh" class="group inline-flex h-7 w-12 items-center rounded-full border border-transparent bg-shell-200 transition data-[checked]:bg-brand-600" @click="toggleRefresh">
                      <span class="sr-only">切换自动刷新</span>
                      <span :class="autoRefresh ? 'translate-x-6' : 'translate-x-1'" class="inline-block h-5 w-5 rounded-full bg-white shadow transition" />
                    </Switch>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        <section class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article class="metric-card">
            <p class="section-kicker">运行中</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-4xl font-semibold tracking-tight">{{ runningCount }}</strong>
              <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">活跃</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">当前有 {{ runningCount }} 个任务在消费任务队列。</p>
          </article>
          <article class="metric-card">
            <p class="section-kicker">待人工处理</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-4xl font-semibold tracking-tight">{{ attentionCount }}</strong>
              <span class="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">关注</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">任务失败或需要确认时，会优先出现在这里。</p>
          </article>
          <article class="metric-card">
            <p class="section-kicker">排队中</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-4xl font-semibold tracking-tight">{{ queuedCount }}</strong>
              <span class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">队列</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">等待浏览器、扫描或 OCR 执行的任务数量。</p>
          </article>
          <article class="metric-card">
            <p class="section-kicker">最近同步</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-xl font-semibold tracking-tight">{{ lastUpdated }}</strong>
              <ClockIcon class="h-6 w-6 text-shell-400" />
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">用于确认后端实时状态是否正常返回。</p>
          </article>
        </section>

        <section class="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(330px,0.9fr)]">
          <section id="tasks" class="panel p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="section-kicker">运行任务</p>
                <h3 class="section-title mt-2">Running Tasks</h3>
              </div>
              <Menu as="div" class="relative">
                <MenuButton class="inline-flex h-10 w-10 items-center justify-center rounded-2xl border border-slate-200 bg-white text-shell-700 transition hover:border-shell-200 hover:text-shell-900">
                  <EllipsisHorizontalIcon class="h-5 w-5" />
                </MenuButton>
                <MenuItems class="absolute right-0 z-10 mt-2 w-48 rounded-2xl border border-slate-200 bg-white p-2 shadow-panel focus:outline-none">
                  <MenuItem v-slot="{ active }">
                    <button :class="active ? 'bg-shell-100 text-shell-900' : 'text-shell-700'" class="w-full rounded-xl px-3 py-2 text-left text-sm">只看运行中</button>
                  </MenuItem>
                  <MenuItem v-slot="{ active }">
                    <button :class="active ? 'bg-shell-100 text-shell-900' : 'text-shell-700'" class="w-full rounded-xl px-3 py-2 text-left text-sm">导出任务快照</button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            </div>

            <div class="mt-5 space-y-4">
              <article v-if="tasks.length === 0" class="rounded-[24px] border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-shell-700 shadow-soft">
                暂无任务数据。启动浏览器、扫描课堂页面或生成草稿后，这里会出现真实任务。
              </article>
              <article v-for="task in tasks" :key="task.id" class="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-panel">
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">{{ task.id }}</p>
                      <span :class="taskBadgeClass(task.status)">{{ task.status }}</span>
                    </div>
                    <h4 class="font-display text-lg font-semibold text-shell-900">{{ task.type }}</h4>
                    <p class="text-sm text-shell-700">{{ task.payloadSummary }}</p>
                    <p class="text-sm text-shell-700">尝试次数：{{ task.attempt }}</p>
                  </div>
                  <div class="min-w-[180px]">
                    <div class="flex items-center justify-between text-sm text-shell-700">
                      <span>状态</span>
                      <strong>{{ task.status }}</strong>
                    </div>
                    <p class="mt-3 text-right text-xs text-shell-700">开始于 {{ task.startedAt }}</p>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section id="events" class="panel p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="section-kicker">最近事件</p>
                <h3 class="section-title mt-2">Event Stream</h3>
              </div>
              <a class="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700" href="#health">
                查看系统健康
                <ArrowTopRightOnSquareIcon class="h-4 w-4" />
              </a>
            </div>

            <div class="mt-5 space-y-4">
              <article v-if="events.length === 0" class="rounded-[22px] border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-sm text-shell-700 shadow-soft">
                暂无事件。执行浏览器接管、扫描、OCR 或草稿生成后，这里会显示真实事件流。
              </article>
              <article v-for="event in events" :key="event.id" class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
                <div class="flex items-center justify-between gap-3">
                  <span class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em]" :class="eventToneClass(event.level)">
                    <span class="h-2 w-2 rounded-full bg-current" />
                    {{ event.level }}
                  </span>
                  <time class="text-xs text-shell-700">{{ event.time }}</time>
                </div>
                <h4 class="mt-3 font-display text-base font-semibold text-shell-900">{{ event.title }}</h4>
                <p class="mt-2 text-sm leading-6 text-shell-700">{{ event.description }}</p>
              </article>
            </div>
          </section>
        </section>

        <section class="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
          <section class="panel p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="section-kicker">任务快照</p>
                <h3 class="section-title mt-2">Task Ledger</h3>
              </div>
              <span class="rounded-full bg-shell-100 px-3 py-1 text-xs font-semibold text-shell-700">持久化任务视图</span>
            </div>

            <div class="mt-5 overflow-hidden rounded-[22px] border border-slate-200">
              <div class="grid grid-cols-[0.95fr_1.8fr_1fr_0.85fr] bg-shell-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-shell-700">
                <span>Run</span>
                <span>Summary</span>
                <span>Status</span>
                <span>Started</span>
              </div>
              <div v-for="task in tasks" :key="`${task.id}-row`" class="grid grid-cols-[0.95fr_1.8fr_1fr_0.85fr] items-center border-t border-slate-200 bg-white px-4 py-4 text-sm text-shell-700">
                <span class="font-medium text-shell-900">{{ task.id }}</span>
                <span>{{ task.payloadSummary }}</span>
                <span><span :class="taskBadgeClass(task.status)">{{ task.status }}</span></span>
                <span>{{ task.startedAt }}</span>
              </div>
            </div>
          </section>

          <section id="health" class="panel p-5">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="section-kicker">系统健康</p>
                <h3 class="section-title mt-2">System Health</h3>
              </div>
              <span class="rounded-full bg-shell-100 px-3 py-1 text-xs font-semibold text-shell-700">Last sync · live</span>
            </div>

            <div class="mt-5 grid gap-3 sm:grid-cols-2">
              <article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">会话信息</p>
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">{{ sessionState.currentUrl ?? '尚未附着页面' }}</strong>
                <p class="mt-2 text-sm text-shell-700">{{ sessionState.pageTitle ?? '暂无页面标题' }} · 模式 {{ sessionState.mode ?? 'none' }}</p>
              </article>
              <article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">课堂状态</p>
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">{{ runtimeSummary }}</strong>
                <p class="mt-2 text-sm text-shell-700">
                  {{ runtimeStatus.checkinAvailable ? '检测到可签到入口' : '当前未发现签到入口' }} ·
                  {{ runtimeStatus.questionDetected ? '已检测到题目' : '当前未检测到题目' }}
                </p>
              </article>
              <article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">自动监控</p>
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">{{ monitor.phase }}</strong>
                <p class="mt-2 text-sm text-shell-700">{{ monitorSummary }}</p>
                <div class="mt-4 flex gap-3">
                  <button class="inline-flex items-center justify-center gap-2 rounded-2xl bg-shell-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-shell-700" @click="handleStartMonitor">
                    启动自动监控
                  </button>
                  <button class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-shell-900 transition hover:border-shell-300" @click="handleStopMonitor">
                    停止自动监控
                  </button>
                </div>
              </article>
              <article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">题目截图</p>
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">
                  {{ currentCapture?.questionId ?? '暂无截图' }}
                </strong>
                <p class="mt-2 text-sm text-shell-700">{{ currentCapture?.filePath ?? '当前题目还没有保存截图' }}</p>
              </article>
              <article class="rounded-[22px] bg-slate-50 px-4 py-4 ring-1 ring-slate-200">
                <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">建议答案</p>
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">{{ analysisAnswerLabel }}</strong>
                <p class="mt-2 text-sm text-shell-700">{{ currentAnalysis?.questionText ?? '暂无题干识别结果' }}</p>
                <p class="mt-2 text-sm text-shell-700">{{ currentAnalysis?.provider ?? '未分析' }} · {{ currentAnalysis?.reasoningSummary ?? '暂无分析理由' }}</p>
              </article>
              <article v-for="item in healthCards" :key="item.label" :class="healthToneClass(item.tone)" class="rounded-[22px] px-4 py-4">
                <p class="text-xs font-semibold uppercase tracking-[0.18em]">{{ item.label }}</p>
                <strong class="mt-3 block font-display text-xl font-semibold tracking-tight">{{ item.value }}</strong>
              </article>
            </div>
          </section>
        </section>
      </main>
    </div>
  </div>
</template>
