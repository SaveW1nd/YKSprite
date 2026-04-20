import React from 'react';
import { navigationItems } from '../app-data';

export function DashboardPage() {
  return (
    <div className="content-stack">
      <section className="hero-grid">
        <article className="glass-card feature-card">
          <div className="feature-card-copy">
            <span className="eyebrow">全局运行概览</span>
            <h2>后台主结构已经建立，后续细节会沿着这套骨架继续深化。</h2>
            <p>这里先固定布局语言、信息区块和页面节奏，避免后续每个模块各做各的。</p>
          </div>
          <div className="signal-cluster" aria-hidden="true">
            <span className="signal-pill">监控中</span>
            <span className="signal-pill muted">统一主题</span>
            <span className="signal-pill muted">桌面端可复用</span>
          </div>
        </article>
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>今日重点</h3>
            <span>实时</span>
          </header>
          <ul className="timeline-list">
            <li>账号池巡检已完成第 4 轮。</li>
            <li>自动化任务模板已切换到新结构。</li>
            <li>API 管理页等待接入真实数据。</li>
          </ul>
        </article>
      </section>

      <section className="dual-panels">
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>导航映射</h3>
            <span>5 个主模块</span>
          </header>
          <div className="chip-grid">
            {navigationItems.map((item) => (
              <span key={item.id} className="soft-chip">
                {item.label}
              </span>
            ))}
          </div>
        </article>
        <article className="glass-card panel-card">
          <header className="panel-card-header">
            <h3>下一步</h3>
            <span>细节深化</span>
          </header>
          <p className="panel-text">后续会逐页补齐字段、筛选、图表和真实接口联动，但不会再推翻这一层框架。</p>
        </article>
      </section>
    </div>
  );
}
