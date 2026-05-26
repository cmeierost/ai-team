import { useState } from 'react';
import type { AgentCapabilities } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioCapabilitiesSectionProps {
  capabilities?: AgentCapabilities;
  onSave: (capabilities: AgentCapabilities) => Promise<void>;
}

const CAPABILITY_KEYS: Array<keyof AgentCapabilities> = ['streaming', 'multimodal', 'codeExecution', 'reasoning'];

function formatLabel(key: keyof AgentCapabilities): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

export function PortfolioCapabilitiesSection({ capabilities, onSave }: Readonly<PortfolioCapabilitiesSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AgentCapabilities>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft({ ...capabilities }); setSaveError(null); setIsEditing(true); };
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

  const cap = isEditing ? draft : (capabilities ?? {});

  return (
    <PortfolioSectionCard title="Capabilities" icon="⚙️" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-capabilities-grid">
          {CAPABILITY_KEYS.map((key) => (
            <label key={key} className="portfolio-checkbox-label">
              <input
                type="checkbox"
                checked={!!cap[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked || undefined }))}
              />
              <span>{formatLabel(key)}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="capabilities-grid">
          {CAPABILITY_KEYS.filter((key) => cap[key]).map((key) => (
            <span key={key} className="capability-chip">{formatLabel(key)}</span>
          ))}
          {CAPABILITY_KEYS.every((key) => !cap[key]) ? <p className="text-muted">No capabilities set.</p> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}

