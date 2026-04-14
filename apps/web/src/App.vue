<script setup lang="ts">
import { Menu, MenuButton, MenuItem, MenuItems, Switch } from '@headlessui/vue';
import {
  ArrowTopRightOnSquareIcon,
  ArrowPathIcon,
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
  fetchHealth,
  fetchSessionState,
  saveSession,
  startBrowser,
  startLoginSession,
  stopBrowser,
  type BrowserStatus,
  type HealthResponse,
  type SessionState
} from './lib/api';

type TaskState = 'Running' | 'Queued' | 'Needs Attention' | 'Completed';

type TaskItem = {
  id: string;
  title: string;
  course: string;
  state: TaskState;
  owner: string;
  progress: number;
  updatedAt: string;
};

type EventItem = {
  id: string;
  level: 'live' | 'alert' | 'info';
  title: string;
  description: string;
  time: string;
};

type HealthItem = {
  label: string;
  value: string;
  tone: 'good' | 'watch' | 'neutral';
};

const tasks = ref<TaskItem[]>([
  { id: 'RUN-184', title: '课堂测验自动运行', course: '高等数学 · 第 12 讲', state: 'Running', owner: 'Session Alpha', progress: 82, updatedAt: '2 分钟前' },
  { id: 'RUN-173', title: '补交队列校验', course: '计算机网络 · 随堂测', state: 'Needs Attention', owner: 'Session Delta', progress: 46, updatedAt: '5 分钟前' },
  { id: 'RUN-169', title: '签到守候任务', course: '大学物理 · 课堂签到', state: 'Queued', owner: 'Session Echo', progress: 14, updatedAt: '9 分钟前' },
  { id: 'RUN-161', title: '复盘任务归档', course: '线性代数 · 复盘任务', state: 'Completed', owner: 'Session Sigma', progress: 100, updatedAt: '18 分钟前' }
]);

const events = ref<EventItem[]>([
  { id: 'EV-1', level: 'live', title: '任务仍在推进', description: 'RUN-184 已完成新一轮健康检查，并继续处理当前课次。', time: '刚刚' },
  { id: 'EV-2', level: 'alert', title: '发现需要人工处理的任务', description: 'RUN-173 在最近两次重试后仍未完成，需要你确认页面状态。', time: '2 分钟前' },
  { id: 'EV-3', level: 'info', title: '浏览器桥接恢复', description: '后台浏览器会话已重新接入，任务队列可以继续消费。', time: '8 分钟前' },
  { id: 'EV-4', level: 'info', title: '凌晨归档完成', description: '昨日运行日志与任务快照已经写入归档区。', time: '16 分钟前' }
]);

const healthCards = ref<HealthItem[]>([
  { label: 'Docker Runtime', value: 'Connected', tone: 'good' },
  { label: 'Browser Bridge', value: 'Idle', tone: 'watch' },
  { label: 'Queue Throughput', value: '28 / hour', tone: 'good' },
  { label: 'Retry Budget', value: '3 remaining', tone: 'watch' },
  { label: 'AI Profiles', value: '4 active', tone: 'neutral' },
  { label: 'Log Retention', value: '72 hours', tone: 'neutral' }
]);

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
let refreshTimer: number | null = null;

const runningCount = computed(() => tasks.value.filter((task) => task.state === 'Running').length);
const attentionCount = computed(() => tasks.value.filter((task) => task.state === 'Needs Attention').length);
const queuedCount = computed(() => tasks.value.filter((task) => task.state === 'Queued').length);
const completedCount = computed(() => tasks.value.filter((task) => task.state === 'Completed').length);

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
  if (browser.value.lastError) {
    return browser.value.lastError;
  }

  if (browser.value.status === 'running') {
    return browser.value.pageUrl ?? 'about:blank';
  }

  if (browser.value.status === 'starting') {
    return '无头浏览器正在初始化';
  }

  if (browser.value.status === 'stopping') {
    return '浏览器正在关闭';
  }

  return '等待人工触发启动无头浏览器。';
});

const sessionSummary = computed(() => {
  if (!sessionState.value.hasSession) {
    return '未保存会话';
  }

  return `${sessionState.value.cookieCount} cookies · ${sessionState.value.savedAt ?? '未知时间'}`;
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

const syncHealth = async () => {
  try {
    const result = await fetchHealth();
    service.value = result;
    serviceState.value = result.status === 'ok' ? 'online' : 'checking';
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
    browser.value = {
      ...browser.value,
      status: 'error',
      lastError: '无法获取浏览器状态'
    };
  }
};

const syncSession = async () => {
  try {
    sessionState.value = await fetchSessionState();
  } catch {
    sessionState.value = {
      ...sessionState.value,
      hasSession: false,
      savedAt: null,
      origin: null,
      cookieCount: 0
    };
  }
};

const resetRefreshTimer = () => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }

  if (autoRefresh.value) {
    refreshTimer = window.setInterval(() => {
      void syncHealth();
      void syncBrowser();
      void syncSession();
    }, 12000);
  }
};

onMounted(async () => {
  await Promise.all([syncHealth(), syncBrowser(), syncSession()]);
  resetRefreshTimer();
});

onBeforeUnmount(() => {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
  }
});

const toggleRefresh = () => {
  autoRefresh.value = !autoRefresh.value;
  resetRefreshTimer();
};

const handleStartBrowser = async () => {
  browser.value = await startBrowser();
  await syncSession();
};

const handleStartLogin = async () => {
  browser.value = await startLoginSession();
  await syncSession();
};

const handleStopBrowser = async () => {
  browser.value = await stopBrowser();
  await syncSession();
};

const handleSaveSession = async () => {
  sessionState.value = await saveSession();
};

const handleRefreshStatus = async () => {
  await Promise.all([syncHealth(), syncBrowser(), syncSession()]);
};

const serviceChipClass = computed(() =>
  serviceState.value === 'online'
    ? 'status-chip status-chip--online'
    : serviceState.value === 'offline'
      ? 'status-chip status-chip--offline'
      : 'status-chip status-chip--checking'
);

const taskBadgeClass = (state: TaskState) => {
  if (state === 'Running') return 'task-badge task-badge--running';
  if (state === 'Queued') return 'task-badge task-badge--queued';
  if (state === 'Needs Attention') return 'task-badge task-badge--attention';
  return 'task-badge task-badge--completed';
};

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
          <div class="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 font-display text-lg font-semibold tracking-[0.2em]">
            YK
          </div>
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/50">Operations Console</p>
            <h1 class="font-display text-lg font-semibold">YKSprite</h1>
          </div>
        </div>

        <nav class="mt-10 space-y-2 text-sm">
          <a class="flex items-center justify-between rounded-2xl bg-white/10 px-4 py-3 font-medium text-white" href="#overview">
            <span>概览</span>
            <span class="text-xs text-white/50">01</span>
          </a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#tasks">
            <span>运行任务</span>
            <span class="text-xs text-white/40">02</span>
          </a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#events">
            <span>事件流</span>
            <span class="text-xs text-white/40">03</span>
          </a>
          <a class="flex items-center justify-between rounded-2xl px-4 py-3 text-white/75 transition hover:bg-white/5 hover:text-white" href="#health">
            <span>系统健康</span>
            <span class="text-xs text-white/40">04</span>
          </a>
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
                <h2 class="font-display text-3xl font-semibold tracking-tight text-shell-900 sm:text-4xl">
                  YKSprite 控制台
                </h2>
                <p class="max-w-3xl text-sm leading-7 text-shell-700 sm:text-[15px]">
                  当前页只保留运行监控需要的关键信息：任务状态、异常、事件流、浏览器接管和系统健康。
                </p>
              </div>

              <div class="flex flex-wrap items-center gap-3">
                <div :class="serviceChipClass">
                  <span class="inline-block h-2.5 w-2.5 rounded-full bg-current" />
                  <span>{{ service?.name ?? 'Service Probe' }}</span>
                </div>
                <span class="rounded-full bg-shell-900/5 px-3 py-1 text-xs font-medium text-shell-700">
                  {{ lastUpdated }}
                </span>
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
                  <strong class="mt-3 block font-display text-xl font-semibold tracking-tight text-shell-900">4 条</strong>
                  <p class="mt-2 text-sm text-shell-700">最近一次异常发生在 2 分钟前。</p>
                </div>
                <div class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft">
                  <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">已保存会话</p>
                  <strong class="mt-3 block font-display text-xl font-semibold tracking-tight text-shell-900">
                    {{ sessionState.hasSession ? '已保存' : '未保存' }}
                  </strong>
                  <p class="mt-2 text-sm text-shell-700">{{ sessionSummary }}</p>
                </div>
              </div>
            </div>

            <div class="flex flex-col gap-3 sm:w-[360px]">
              <div class="rounded-[24px] bg-brand-600 px-4 py-4 text-white shadow-soft">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/70">当前主任务</p>
                    <h3 class="mt-2 font-display text-xl">RUN-184 正在处理课堂测验</h3>
                  </div>
                  <CheckCircleIcon class="h-10 w-10 text-white/80" />
                </div>
                <p class="mt-3 text-sm leading-6 text-white/80">Session Alpha 已完成 82%，最近一次健康检查通过。</p>
              </div>

              <div class="panel space-y-4 px-4 py-4">
                <div class="flex items-center justify-between">
                  <div>
                    <p class="section-kicker">操作入口</p>
                    <p class="mt-1 text-sm text-shell-700">手动触发浏览器接管或刷新状态。</p>
                  </div>
                  <div class="rounded-full bg-shell-100 px-3 py-1 text-xs font-semibold text-shell-700">Manual</div>
                </div>

                <div class="grid gap-3 sm:grid-cols-2">
                  <button
                    :disabled="!canStartBrowser"
                    class="inline-flex items-center justify-center gap-2 rounded-2xl bg-shell-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-shell-700 disabled:cursor-not-allowed disabled:bg-shell-300"
                    @click="handleStartBrowser"
                  >
                    <PlayCircleIcon class="h-5 w-5" />
                    启动浏览器接管
                  </button>
                  <button
                    class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300"
                    @click="handleStartLogin"
                  >
                    <ArrowTopRightOnSquareIcon class="h-5 w-5" />
                    扫码登录
                  </button>
                  <button
                    :disabled="!canStopBrowser"
                    class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                    @click="handleStopBrowser"
                  >
                    <StopCircleIcon class="h-5 w-5" />
                    停止浏览器
                  </button>
                  <button
                    class="inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-shell-900 transition hover:border-shell-300"
                    @click="handleSaveSession"
                  >
                    <CheckCircleIcon class="h-5 w-5" />
                    保存当前会话
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-shell-50 px-4 py-3">
                  <div>
                    <p class="section-kicker">刷新状态</p>
                    <p class="mt-1 text-sm text-shell-700">每 12 秒自动轮询，也可以手动刷新。</p>
                  </div>
                  <button
                    class="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-shell-900 transition hover:border-shell-300"
                    @click="handleRefreshStatus"
                  >
                    <ArrowPathIcon class="h-4 w-4" />
                    刷新状态
                  </button>
                </div>

                <div class="flex items-center justify-between rounded-2xl bg-shell-50 px-4 py-3">
                  <div>
                    <p class="section-kicker">自动刷新</p>
                    <p class="mt-1 text-sm text-shell-700">保持服务状态持续更新。</p>
                  </div>
                  <div class="flex items-center gap-3">
                    <span class="text-sm font-medium text-shell-700">{{ autoRefresh ? '已开启' : '已关闭' }}</span>
                    <Switch
                      :model-value="autoRefresh"
                      class="group inline-flex h-7 w-12 items-center rounded-full border border-transparent bg-shell-200 transition data-[checked]:bg-brand-600"
                      @click="toggleRefresh"
                    >
                      <span class="sr-only">切换自动刷新</span>
                      <span
                        :class="autoRefresh ? 'translate-x-6' : 'translate-x-1'"
                        class="inline-block h-5 w-5 rounded-full bg-white shadow transition"
                      />
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
            <p class="mt-3 text-sm leading-6 text-shell-700">异常、超时或等待确认的任务会集中出现在这里。</p>
          </article>

          <article class="metric-card">
                <p class="section-kicker">排队中</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-4xl font-semibold tracking-tight">{{ queuedCount }}</strong>
              <span class="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">队列</span>
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">等待浏览器桥接和模型资源的任务数量。</p>
          </article>

          <article class="metric-card">
                <p class="section-kicker">最近同步</p>
            <div class="mt-3 flex items-end justify-between">
              <strong class="font-display text-xl font-semibold tracking-tight">{{ lastUpdated }}</strong>
              <ClockIcon class="h-6 w-6 text-shell-400" />
            </div>
            <p class="mt-3 text-sm leading-6 text-shell-700">用来确认后端是否仍在稳定返回健康状态。</p>
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
                    <button :class="active ? 'bg-shell-100 text-shell-900' : 'text-shell-700'" class="w-full rounded-xl px-3 py-2 text-left text-sm">
                      只看运行中
                    </button>
                  </MenuItem>
                  <MenuItem v-slot="{ active }">
                    <button :class="active ? 'bg-shell-100 text-shell-900' : 'text-shell-700'" class="w-full rounded-xl px-3 py-2 text-left text-sm">
                      导出任务快照
                    </button>
                  </MenuItem>
                </MenuItems>
              </Menu>
            </div>

            <div class="mt-5 space-y-4">
              <article
                v-for="task in tasks"
                :key="task.id"
                class="rounded-[24px] border border-slate-200 bg-white px-4 py-4 shadow-soft transition hover:-translate-y-0.5 hover:shadow-panel"
              >
                <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div class="space-y-1">
                    <div class="flex flex-wrap items-center gap-3">
                      <p class="text-xs font-semibold uppercase tracking-[0.18em] text-shell-700">{{ task.id }}</p>
                      <span :class="taskBadgeClass(task.state)">{{ task.state }}</span>
                    </div>
                    <h4 class="font-display text-lg font-semibold text-shell-900">{{ task.title }}</h4>
                    <p class="text-sm text-shell-700">{{ task.course }}</p>
                    <p class="text-sm text-shell-700">会话：{{ task.owner }}</p>
                  </div>

                  <div class="min-w-[180px]">
                    <div class="flex items-center justify-between text-sm text-shell-700">
                      <span>进度</span>
                      <strong>{{ task.progress }}%</strong>
                    </div>
                    <div class="mt-2 h-2 rounded-full bg-shell-100">
                      <div class="h-2 rounded-full bg-gradient-to-r from-brand-500 to-cyan-500" :style="{ width: `${task.progress}%` }" />
                    </div>
                    <p class="mt-3 text-right text-xs text-shell-700">更新于 {{ task.updatedAt }}</p>
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
              <article
                v-for="event in events"
                :key="event.id"
                class="rounded-[22px] border border-slate-200 bg-white px-4 py-4 shadow-soft"
              >
                <div class="flex items-center justify-between gap-3">
                  <span
                    class="inline-flex items-center gap-2 rounded-full px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.16em]"
                    :class="{
                      'bg-emerald-50 text-emerald-700': event.level === 'live',
                      'bg-amber-50 text-amber-700': event.level === 'alert',
                      'bg-slate-100 text-slate-700': event.level === 'info'
                    }"
                  >
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
              <span class="rounded-full bg-shell-100 px-3 py-1 text-xs font-semibold text-shell-700">Today · 18 tasks</span>
            </div>

            <div class="mt-5 overflow-hidden rounded-[22px] border border-slate-200">
              <div class="grid grid-cols-[0.95fr_1.8fr_1fr_0.85fr] bg-shell-100 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-shell-700">
                <span>Run</span>
                <span>Course</span>
                <span>Status</span>
                <span>Updated</span>
              </div>
              <div
                v-for="task in tasks"
                :key="`${task.id}-row`"
                class="grid grid-cols-[0.95fr_1.8fr_1fr_0.85fr] items-center border-t border-slate-200 bg-white px-4 py-4 text-sm text-shell-700"
              >
                <span class="font-medium text-shell-900">{{ task.id }}</span>
                <span>{{ task.course }}</span>
                <span><span :class="taskBadgeClass(task.state)">{{ task.state }}</span></span>
                <span>{{ task.updatedAt }}</span>
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
                <strong class="mt-3 block font-display text-lg font-semibold tracking-tight text-shell-900">
                  {{ sessionState.currentUrl ?? '尚未附着页面' }}
                </strong>
                <p class="mt-2 text-sm text-shell-700">
                  {{ sessionState.pageTitle ?? '暂无页面标题' }} · 模式 {{ sessionState.mode ?? 'none' }}
                </p>
              </article>
              <article
                v-for="item in healthCards"
                :key="item.label"
                :class="healthToneClass(item.tone)"
                class="rounded-[22px] px-4 py-4"
              >
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
