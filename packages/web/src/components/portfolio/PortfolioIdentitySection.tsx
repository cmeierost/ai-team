import { useState } from 'react';
import type { Agent } from '../../types';
import { CONTEXT_LABELS, PortfolioSectionCard, TYPE_LABELS } from './portfolioShared';

interface IdentityFields {
  type?: Agent['type'];
  contextLevel?: Agent['contextLevel'];
  pronouns?: string;
}

interface PortfolioIdentitySectionProps {
  type?: Agent['type'];
  contextLevel?: Agent['contextLevel'];
  pronouns?: string;
  onSave: (fields: IdentityFields) => Promise<void>;
}

export function PortfolioIdentitySection({ type, contextLevel, pronouns, onSave }: Readonly<PortfolioIdentitySectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<IdentityFields>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft({ type, contextLevel, pronouns }); setSaveError(null); setIsEditing(true); };
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

  const v = isEditing ? draft : { type, contextLevel, pronouns };

  return (
    <PortfolioSectionCard title="Identity" icon="🪦" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-form-grid">
          <label>
            <span>Type</span>
            <select value={v.type ?? ''} onChange={(e) => setDraft((d) => ({ ...d, type: (e.target.value as Agent['type']) || undefined }))}>
              <option value="">— none —</option>
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Context Level</span>
            <select value={v.contextLevel ?? ''} onChange={(e) => setDraft((d) => ({ ...d, contextLevel: (e.target.value as Agent['contextLevel']) || undefined }))}>
              <option value="">— none —</option>
              {Object.entries(CONTEXT_LABELS).map(([key, label]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Pronouns</span>
            <input value={v.pronouns ?? ''} onChange={(e) => setDraft((d) => ({ ...d, pronouns: e.target.value || undefined }))} placeholder="they/them" />
          </label>
        </div>
      ) : (
        <div className="identity-chips">
          {v.type ? <span className="portfolio-chip chip-type">{TYPE_LABELS[v.type] ?? v.type}</span> : null}
          {v.contextLevel ? <span className="portfolio-chip chip-context">{CONTEXT_LABELS[v.contextLevel] ?? v.contextLevel}</span> : null}
          {v.pronouns ? <span className="portfolio-chip">{v.pronouns}</span> : null}
          {!v.type && !v.contextLevel && !v.pronouns ? <p className="text-muted">No identity details set.</p> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
