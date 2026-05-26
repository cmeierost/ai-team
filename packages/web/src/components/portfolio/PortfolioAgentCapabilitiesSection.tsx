import { useState } from 'react';
import type { AgentCapabilities } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioAgentCapabilitiesSectionProps {
  capabilities?: AgentCapabilities;
  onSave: (capabilities: AgentCapabilities) => Promise<void>;
}

const AGENT_CAPABILITY_LABELS: Array<[keyof AgentCapabilities, string]> = [
  ['streaming', 'Streaming'],
  ['multimodal', 'Multimodal'],
  ['codeExecution', 'Code Execution'],
  ['reasoning', 'Reasoning'],
];

export function PortfolioAgentCapabilitiesSection({ capabilities, onSave }: Readonly<PortfolioAgentCapabilitiesSectionProps>) {
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
    <PortfolioSectionCard title="Agent Capabilities" icon="⚙️" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-form-grid">
          {AGENT_CAPABILITY_LABELS.map(([key, label]) => (
            <label key={key} className="portfolio-checkbox-label">
              <input
                type="checkbox"
                checked={cap[key] ?? false}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.checked }))}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="capabilities-grid">
          {AGENT_CAPABILITY_LABELS.map(([key, label]) => (
            <div key={key} className="capability-item">
              <span className={`capability-icon ${cap[key] ? 'capability-enabled' : ''}`}>{cap[key] ? '✓' : '—'}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </PortfolioSectionCard>
  );
}

