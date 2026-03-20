import { useState } from 'react';
import { PortfolioSectionCard } from './portfolioShared';

interface GoalBackstoryFields {
  goal?: string;
  backstory?: string;
}

interface PortfolioGoalBackstorySectionProps {
  goal?: string;
  backstory?: string;
  onSave: (fields: GoalBackstoryFields) => Promise<void>;
}

export function PortfolioGoalBackstorySection({ goal, backstory, onSave }: Readonly<PortfolioGoalBackstorySectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<GoalBackstoryFields>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft({ goal, backstory }); setSaveError(null); setIsEditing(true); };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const v = isEditing ? draft : { goal, backstory };

  return (
    <PortfolioSectionCard title="Goal & Backstory" icon="🎯" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-form-stack">
          <label>
            <span>Goal</span>
            <textarea
              className="portfolio-textarea"
              rows={2}
              placeholder="What this agent is trying to achieve…"
              value={v.goal ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value || undefined }))}
            />
          </label>
          <label>
            <span>Backstory</span>
            <textarea
              className="portfolio-textarea"
              rows={3}
              placeholder="Background, context, and persona…"
              value={v.backstory ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, backstory: e.target.value || undefined }))}
            />
          </label>
        </div>
      ) : (
        <div className="goal-backstory-grid">
          {v.goal ? (
            <div className="goal-backstory-item">
              <div className="goal-backstory-label">Goal</div>
              <p className="goal-backstory-text">{v.goal}</p>
            </div>
          ) : null}
          {v.backstory ? (
            <div className="goal-backstory-item">
              <div className="goal-backstory-label">Backstory</div>
              <p className="goal-backstory-text">{v.backstory}</p>
            </div>
          ) : null}
          {!v.goal && !v.backstory ? <p className="text-muted">No goal or backstory set.</p> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}

