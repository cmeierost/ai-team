import type { AgentCapabilities } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioCapabilitiesSectionProps {
  isEditing: boolean;
  capabilities?: AgentCapabilities;
  onCapabilityChange?: (patch: Partial<AgentCapabilities>) => void;
}

const capabilityKeys = ['streaming', 'multimodal', 'codeExecution', 'reasoning'] as const;

function formatCapabilityLabel(capability: (typeof capabilityKeys)[number]) {
  return capability.charAt(0).toUpperCase() + capability.split(/(?=[A-Z])/).join(' ').slice(1);
}

export function PortfolioCapabilitiesSection({ isEditing, capabilities, onCapabilityChange }: Readonly<PortfolioCapabilitiesSectionProps>) {
  return (
    <PortfolioSectionCard title="Capabilities" icon="⚙️">
      {isEditing ? (
        <div className="portfolio-capabilities-grid">
          {capabilityKeys.map((capability) => (
            <label key={capability} className="portfolio-checkbox-label">
              <input
                type="checkbox"
                checked={!!capabilities?.[capability]}
                onChange={(event) => onCapabilityChange?.({ [capability]: event.target.checked || undefined })}
              />
              <span>{formatCapabilityLabel(capability)}</span>
            </label>
          ))}
        </div>
      ) : (
        <div className="capabilities-grid">
          {capabilities?.streaming ? <span className="capability-chip">Streaming</span> : null}
          {capabilities?.multimodal ? <span className="capability-chip">Multimodal</span> : null}
          {capabilities?.codeExecution ? <span className="capability-chip">Code Execution</span> : null}
          {capabilities?.reasoning ? <span className="capability-chip">Reasoning</span> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
