import type { JSX, ReactNode } from 'react';
import { publishWorkflowLabels } from './presentation';

export function PageHeader({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }): JSX.Element {
  return <div className="page-title"><div>{eyebrow && <div className="eyebrow">{eyebrow}</div>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="page-title-actions">{action}</div>}</div>;
}

export function StatusBadge({ label, tone = 'muted' }: { label: string; tone?: string }): JSX.Element {
  return <span className={`status-pill ${tone}`}>{label}</span>;
}

export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }): JSX.Element {
  return <div className="empty-state"><div className="empty-icon" aria-hidden="true">◇</div><h3>{title}</h3><p>{description}</p>{action && <div className="empty-actions">{action}</div>}</div>;
}

export function StatCard({ label, value, hint, tone = 'blue', icon }: { label: string; value: number | string; hint: string; tone?: string; icon: string }): JSX.Element {
  return <div className={`stat-card ${tone}`}><div className="stat-icon" aria-hidden="true">{icon}</div><div className="stat-label">{label}</div><div className="stat-value">{value}</div><div className="stat-hint">{hint}</div></div>;
}

export function LoadingState({ title, description, rows = 3 }: { title: string; description?: string; rows?: number }): JSX.Element {
  return <div className="loading-state" role="status"><strong>{title}</strong>{description && <p>{description}</p>}<div className="skeleton-list" aria-hidden="true">{Array.from({ length: rows }, (_, index) => <div className="skeleton-row" key={index}><span /><span /><span /></div>)}</div></div>;
}

export function PublishWorkflow(): JSX.Element {
  return <ol className="publish-workflow" aria-label="发布工作流程">{publishWorkflowLabels.map((label, index) => <li key={label}><span aria-hidden="true">{index + 1}</span>{label}</li>)}</ol>;
}
