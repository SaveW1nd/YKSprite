import React from 'react';
import {
  Bars3Icon,
  BellIcon,
  ChevronDoubleLeftIcon,
  ChevronDoubleRightIcon,
  MoonIcon
} from '@heroicons/react/24/outline';
import { SunIcon } from '@heroicons/react/24/solid';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { navigationItems, sectionMetrics, type NavItem, type RouteSectionId, type SectionMetric } from '../app-data';
import { PageMetricsContext } from '../lib/page-metrics';

const cx = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' ');

const routeToSectionId = (pathname: string): RouteSectionId => {
  if (pathname.startsWith('/dashboard')) return 'dashboard';
  if (pathname.startsWith('/answers')) return 'answers';
  if (pathname.startsWith('/monitoring')) return 'monitoring';
  if (pathname.startsWith('/api')) return 'api';
  return 'accounts';
};

const matchNavigationItem = (pathname: string): NavItem => {
  const item = navigationItems.find((entry) => pathname === entry.path || pathname.startsWith(`${entry.path}/`));
  return item ?? navigationItems[1];
};

export function AdminLayout() {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);
  const [topbarMode, setTopbarMode] = React.useState<'full' | 'compact' | 'stacked'>('full');
  const [dynamicMetrics, setDynamicMetrics] = React.useState<Partial<Record<RouteSectionId, SectionMetric[]>>>({});
  const [isDark, setIsDark] = React.useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    const storedTheme = window.localStorage.getItem('theme');
    if (storedTheme === 'dark') return true;
    if (storedTheme === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  const activeItem = matchNavigationItem(location.pathname);
  const activeSectionId = routeToSectionId(location.pathname);
  const metrics = dynamicMetrics[activeSectionId] ?? sectionMetrics[activeSectionId];
  const topbarRef = React.useRef<HTMLElement | null>(null);
  const toggleRef = React.useRef<HTMLButtonElement | null>(null);
  const titleRef = React.useRef<HTMLHeadingElement | null>(null);
  const subtitleRef = React.useRef<HTMLParagraphElement | null>(null);
  const noticeRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  React.useEffect(() => {
    const recalculateTopbarMode = () => {
      if (
        !topbarRef.current ||
        !titleRef.current ||
        !noticeRef.current
      ) {
        return;
      }

      const containerWidth = topbarRef.current.clientWidth;
      const toggleWidth = toggleRef.current && window.getComputedStyle(toggleRef.current).display !== 'none'
        ? toggleRef.current.getBoundingClientRect().width + 14
        : 0;
      const titleWidth = titleRef.current.scrollWidth;
      const subtitleWidth = subtitleRef.current?.scrollWidth ?? 0;
      const headFullWidth = toggleWidth + Math.max(titleWidth, subtitleWidth);
      const headCompactWidth = toggleWidth + titleWidth;

      const noticeWidth = noticeRef.current.getBoundingClientRect().width;
      const actionsFullWidth = noticeWidth;
      const actionsCompactWidth = noticeWidth;

      if (headFullWidth + actionsFullWidth + 36 <= containerWidth) {
        setTopbarMode('full');
        return;
      }

      if (headCompactWidth + actionsCompactWidth + 28 <= containerWidth) {
        setTopbarMode('compact');
        return;
      }

      setTopbarMode('stacked');
    };

    const run = () => {
      window.requestAnimationFrame(recalculateTopbarMode);
    };

    run();
    window.addEventListener('resize', run);
    return () => window.removeEventListener('resize', run);
  }, [sidebarCollapsed, mobileMenuOpen, location.pathname]);

  React.useEffect(() => {
    const syncDrawerWithViewport = () => {
      if (window.innerWidth >= 1024) {
        setMobileMenuOpen(false);
      }
    };

    window.addEventListener('resize', syncDrawerWithViewport);
    return () => window.removeEventListener('resize', syncDrawerWithViewport);
  }, []);

  React.useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    window.localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  const setSectionMetrics = React.useCallback((sectionId: RouteSectionId, metricsForSection: SectionMetric[] | null) => {
    setDynamicMetrics((current) => {
      if (metricsForSection === null) {
        const next = { ...current };
        delete next[sectionId];
        return next;
      }

      return {
        ...current,
        [sectionId]: metricsForSection
      };
    });
  }, []);

  return (
    <div className={cx('admin-shell', sidebarCollapsed && 'admin-shell-collapsed')}>
      <aside
        className={cx(
          'sidebar',
          sidebarCollapsed && 'sidebar-collapsed',
          mobileMenuOpen && 'sidebar-mobile-open'
        )}
      >
        <div className={cx('sidebar-header', sidebarCollapsed && 'sidebar-header-collapsed')}>
          <div className="sidebar-logo" aria-hidden="true">
            <div className="brand-mark">
              <img alt="" className="brand-mark-svg" src="/favicon.png" />
            </div>
          </div>
          <div
            aria-hidden={sidebarCollapsed}
            className={cx('sidebar-brand brand-copy brand-copy-stack', sidebarCollapsed && 'sidebar-brand-collapsed')}
          >
              <strong>YKSprite</strong>
          </div>
        </div>

        <nav aria-label="主导航" className="sidebar-nav">
          {navigationItems.map((item) => {
            const Icon = item.icon;

            return (
              <NavLink
                key={item.id}
                className={({ isActive }) =>
                  cx('sidebar-link', isActive && 'sidebar-link-active', sidebarCollapsed && 'sidebar-link-collapsed')
                }
                to={item.path}
              >
                <Icon />
                <span
                  aria-hidden={sidebarCollapsed}
                  className={cx('sidebar-label', sidebarCollapsed && 'sidebar-label-collapsed')}
                >
                  {item.label}
                </span>
              </NavLink>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <button
            aria-label={isDark ? '浅色模式' : '深色模式'}
            className={cx('sidebar-link', sidebarCollapsed && 'sidebar-link-collapsed')}
            type="button"
            onClick={() => setIsDark((current) => !current)}
          >
            {isDark ? <SunIcon /> : <MoonIcon />}
            <span
              aria-hidden={sidebarCollapsed}
              className={cx('sidebar-label', sidebarCollapsed && 'sidebar-label-collapsed')}
            >
              {isDark ? '浅色模式' : '深色模式'}
            </span>
          </button>

          <button
            aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            className={cx('sidebar-link', sidebarCollapsed && 'sidebar-link-collapsed')}
            type="button"
            onClick={() => setSidebarCollapsed((current) => !current)}
          >
            {sidebarCollapsed ? <ChevronDoubleRightIcon /> : <ChevronDoubleLeftIcon />}
            <span
              aria-hidden={sidebarCollapsed}
              className={cx('sidebar-label', sidebarCollapsed && 'sidebar-label-collapsed')}
            >
              {sidebarCollapsed ? '展开' : '收起'}
            </span>
          </button>
        </div>
      </aside>

      {mobileMenuOpen && (
        <div
          aria-hidden="true"
          className="mobile-sidebar-overlay"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <div className="shell-main">
        <header
          ref={topbarRef}
          className={cx(
            'topbar',
            topbarMode === 'compact' && 'topbar-compact',
            topbarMode === 'stacked' && 'topbar-stacked'
          )}
        >
          <div className="topbar-head">
            <button
              ref={toggleRef}
              aria-label={mobileMenuOpen ? '关闭导航' : '打开导航'}
              className="mobile-nav-toggle"
              type="button"
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              <Bars3Icon />
            </button>
            <div className="page-intro">
              <h1 ref={titleRef}>{activeItem.label}</h1>
              <p ref={subtitleRef}>{activeItem.subtitle}</p>
            </div>
          </div>

          <div className="topbar-actions">
            <button ref={noticeRef} className="icon-button" type="button" aria-label="通知中心">
              <BellIcon />
            </button>
          </div>
        </header>

        <main className="page-stage">
          <div className="ambient-glow" aria-hidden="true" />

          <section className={`metric-row metric-row-${activeSectionId}`} aria-label="页面摘要">
            {metrics.map((metric) => {
              const MetricIcon = metric.icon;

              return (
                <article key={metric.label} className="metric-card">
                  <div className="metric-card-icon" aria-hidden="true">
                    {MetricIcon ? <MetricIcon /> : null}
                  </div>
                  <div className="metric-card-copy">
                    <span>{metric.label}</span>
                    <strong>{metric.value}</strong>
                    <small>{metric.hint}</small>
                  </div>
                </article>
              );
            })}
          </section>

          <PageMetricsContext.Provider value={{ setSectionMetrics }}>
            <Outlet />
          </PageMetricsContext.Provider>
        </main>
      </div>
    </div>
  );
}
