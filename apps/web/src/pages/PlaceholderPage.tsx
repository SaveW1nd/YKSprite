import React from 'react';

type PlaceholderPageProps = {
  title: string;
  intro: string;
  highlights: string[];
};

export function PlaceholderPage(props: PlaceholderPageProps) {
  return (
    <div className="content-stack">
      <section className="hero-grid">
        <article className="glass-card feature-card">
          <div className="feature-card-copy">
            <span className="eyebrow">结构占位</span>
            <h2>{props.title}</h2>
            <p>{props.intro}</p>
          </div>
        </article>
      </section>

      <section className="dual-panels">
        {props.highlights.map((item) => (
          <article key={item} className="glass-card panel-card">
            <header className="panel-card-header">
              <h3>{item}</h3>
              <span>待接入</span>
            </header>
            <p className="panel-text">主结构已经预留，这里后续补真实图表、筛选和明细交互。</p>
          </article>
        ))}
      </section>
    </div>
  );
}
