import type { AgentCapabilities } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioAgentCapabilitiesSectionProps {
  isEditing: boolean;
  capabilities?: AgentCapabilities;
  onCapabilityChange?: (patch: Partial<AgentCapabilities>) => void;
}

const agentCapabilities = [
  ['streaming', 'Streaming'],
  ['multimodal', 'Multimodal'],
  ['codeExecution', 'Code Execution'],
  ['reasoning', 'Reasoning'],
] as const;

export function PortfolioAgentCapabilitiesSection({ isEditing, capabilities, onCapabilityChange }: Readonly<PortfolioAgentCapabilitiesSectionProps>) {
  return (
    <PortfolioSectionCard title="Agent Capabilities" icon="⚙️">
      {isEditing ? (
        <div className="portfolio-form-grid">
          {agentCapabilities.map(([capability, label]) => (
            <label key={capability} className="portfolio-checkbox-label">
              <input
                type="checkbox"
                checked={capabilities?.[capability] ?? false}
                onChange={(event) => onCapabilityChange?.({ [capability]: event.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="capabilities-grid">
          {agentCapabilities.map(([capability, label]) => (
            <div key={capability} className="capability-item">
              <span className={`capability-icon ${capabilities?.[capability] ? 'capability-enabled' : ''}`}>{capabilities?.[capability] ? '✓' : '—'}</span>
              <span>{label}</span>
            </div>
          ))}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
