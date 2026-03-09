import type { Agent } from '../../types';
import { CONTEXT_LABELS, PortfolioSectionCard, TYPE_LABELS } from './portfolioShared';

interface PortfolioIdentitySectionProps {
  type?: Agent['type'];
  contextLevel?: Agent['contextLevel'];
  pronouns?: string;
  timezone?: string;
  onTypeChange: (value?: Agent['type']) => void;
  onContextLevelChange: (value?: Agent['contextLevel']) => void;
  onPronounsChange: (value?: string) => void;
  onTimezoneChange: (value?: string) => void;
}

export function PortfolioIdentitySection({
  type,
  contextLevel,
  pronouns,
  timezone,
  onTypeChange,
  onContextLevelChange,
  onPronounsChange,
  onTimezoneChange,
}: Readonly<PortfolioIdentitySectionProps>) {
  return (
    <PortfolioSectionCard title="Identity" icon="🪪">
      <div className="portfolio-form-grid">
        <label>
          <span>Type</span>
          <select value={type ?? ''} onChange={(event) => onTypeChange((event.target.value as Agent['type']) || undefined)}>
            <option value="">— none —</option>
            {Object.entries(TYPE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Context Level</span>
          <select
            value={contextLevel ?? ''}
            onChange={(event) => onContextLevelChange((event.target.value as Agent['contextLevel']) || undefined)}
          >
            <option value="">— none —</option>
            {Object.entries(CONTEXT_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Pronouns</span>
          <input value={pronouns ?? ''} onChange={(event) => onPronounsChange(event.target.value || undefined)} placeholder="they/them" />
        </label>
        <label>
          <span>Timezone</span>
          <input value={timezone ?? ''} onChange={(event) => onTimezoneChange(event.target.value || undefined)} placeholder="Europe/Berlin" />
        </label>
      </div>
    </PortfolioSectionCard>
  );
}
