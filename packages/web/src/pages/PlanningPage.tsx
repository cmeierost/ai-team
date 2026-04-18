import { useState } from 'react';
import { usePlanningIntake, usePlans } from '../hooks/usePlanning';
import type { PlanningIntakeItem, PlanningPlan } from '@ai-team/api-client';
import './PlanningPage.css';

type TabId = 'plans' | 'intake';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  blocked: 'Blocked',
  completed: 'Completed',
  cancelled: 'Cancelled',
  new: 'New',
  triaged: 'Triaged',
  converted_to_plan: 'Converted',
  dismissed: 'Dismissed',
};

const STATUS_COLORS: Record<string, string> = {
  active: 'planning-badge-active',
  draft: 'planning-badge-draft',
  completed: 'planning-badge-completed',
  cancelled: 'planning-badge-cancelled',
  blocked: 'planning-badge-blocked',
  new: 'planning-badge-new',
  triaged: 'planning-badge-triaged',
  converted_to_plan: 'planning-badge-converted',
  dismissed: 'planning-badge-dismissed',
};

function StatusBadge({ status }: Readonly<{ status: string }>) {
  return (
    <span className={`planning-badge ${STATUS_COLORS[status] ?? 'planning-badge-default'}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

function PlansTab() {
  const { plans, plansLoading, plansError } = usePlans();

  if (plansLoading) return <div className="planning-loading">Loading plans…</div>;
  if (plansError) return <div className="planning-error">Failed to load plans.</div>;
  if (plans.length === 0) return <div className="planning-empty">No plans yet.</div>;

  return (
    <ul className="planning-list">
      {plans.map((plan: PlanningPlan) => (
        <li key={plan.id} className="planning-list-item">
          <div className="planning-list-item-header">
            <span className="planning-list-item-title">{plan.title}</span>
            <StatusBadge status={plan.status} />
          </div>
          {plan.goal && <p className="planning-list-item-sub">{plan.goal}</p>}
          <div className="planning-list-item-meta">
            <span>Priority: {plan.priority}</span>
            <span>By: {plan.createdBy}</span>
            <span>{new Date(plan.createdAt).toLocaleDateString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function IntakeTab() {
  const { intakeItems, intakeLoading, intakeError } = usePlanningIntake();

  if (intakeLoading) return <div className="planning-loading">Loading intake…</div>;
  if (intakeError) return <div className="planning-error">Failed to load intake.</div>;
  if (intakeItems.length === 0) return <div className="planning-empty">No intake items.</div>;

  return (
    <ul className="planning-list">
      {intakeItems.map((item: PlanningIntakeItem) => (
        <li key={item.id} className="planning-list-item">
          <div className="planning-list-item-header">
            <span className="planning-list-item-title">{item.title}</span>
            <StatusBadge status={item.status} />
          </div>
          {item.description && <p className="planning-list-item-sub">{item.description}</p>}
          <div className="planning-list-item-meta">
            <span>{item.sourceType}</span>
            <span>{item.sourceRef}</span>
            <span>{new Date(item.createdAt).toLocaleDateString()}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

export function PlanningPage() {
  const [activeTab, setActiveTab] = useState<TabId>('plans');

  return (
    <div className="planning-page">
      <div className="planning-header">
        <h1>Planning</h1>
      </div>

      <div className="planning-tabs">
        <button
          className={`planning-tab ${activeTab === 'plans' ? 'planning-tab-active' : ''}`}
          onClick={() => setActiveTab('plans')}
        >
          Plans
        </button>
        <button
          className={`planning-tab ${activeTab === 'intake' ? 'planning-tab-active' : ''}`}
          onClick={() => setActiveTab('intake')}
        >
          Intake
        </button>
      </div>

      <div className="planning-content">
        {activeTab === 'plans' ? <PlansTab /> : null}
        {activeTab === 'intake' ? <IntakeTab /> : null}
      </div>
    </div>
  );
}
