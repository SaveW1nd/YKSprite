import type { ComponentType, SVGProps } from 'react';
import {
  ClipboardDocumentListIcon,
  KeyIcon,
  ServerStackIcon,
  Squares2X2Icon,
  UsersIcon
} from '@heroicons/react/24/outline';

export type RouteSectionId = 'dashboard' | 'accounts' | 'answers' | 'monitoring' | 'api';

export type NavItem = {
  id: RouteSectionId;
  path: string;
  label: string;
  subtitle: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

export type SectionMetric = {
  label: string;
  value: string;
  hint: string;
  icon?: ComponentType<SVGProps<SVGSVGElement>>;
};

export const navigationItems: NavItem[] = [
  {
    id: 'dashboard',
    path: '/dashboard',
    label: '仪表盘',
    subtitle: '系统概览与统计数据',
    icon: Squares2X2Icon
  },
  {
    id: 'accounts',
    path: '/accounts',
    label: '账号管理',
    subtitle: '统一管理需要由后台自动监测的业务账号池。',
    icon: UsersIcon
  },
  {
    id: 'answers',
    path: '/answers',
    label: '答题情况',
    subtitle: '聚合查看答题结果、命中率和异常记录。',
    icon: ClipboardDocumentListIcon
  },
  {
    id: 'monitoring',
    path: '/monitoring',
    label: '后台监控',
    subtitle: '查看账号 worker、课堂上下文与后台任务状态。',
    icon: ServerStackIcon
  },
  {
    id: 'api',
    path: '/api',
    label: 'API管理',
    subtitle: '维护 API 接口、密钥状态与调用配额。',
    icon: KeyIcon
  }
];

export const sectionMetrics: Record<RouteSectionId, SectionMetric[]> = {
  dashboard: [
    { label: '健康账号', value: '184', hint: '占总账号池 91.5%' },
    { label: '自动化任务', value: '12', hint: '3 个任务正在运行' },
    { label: '今日答题', value: '2,431', hint: '平均成功率 97.2%' }
  ],
  accounts: [
    { label: '账号总数', value: '201', hint: '含 17 个新接入账号' },
    { label: '健康账号', value: '184', hint: '最近一轮巡检正常' },
    { label: '异常账号', value: '17', hint: '需要关注返回值异常' }
  ],
  answers: [
    { label: '总答题数', value: '15,024', hint: '近 7 天累计' },
    { label: '命中率', value: '97.2%', hint: '异常题目自动归档' },
    { label: '待复核', value: '31', hint: '人工复核队列' }
  ],
  monitoring: [
    { label: '监控线程', value: '0', hint: '账号 worker 数' },
    { label: '活跃课堂', value: '0', hint: '当前 lessonId/classroomId' },
    { label: '运行任务', value: '0', hint: '自动化任务状态' }
  ],
  api: [
    { label: '在线接口', value: '9', hint: '2 个处于只读模式' },
    { label: '有效密钥', value: '27', hint: '本周新增 4 个' },
    { label: '今日请求', value: '64K', hint: '峰值在 14:00 出现' }
  ]
};
