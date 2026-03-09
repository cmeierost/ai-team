import type { AgentLlm } from '../../types';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioLlmSectionProps {
  llm: AgentLlm;
}

export function PortfolioLlmSection({ llm }: Readonly<PortfolioLlmSectionProps>) {
  return (
    <PortfolioSectionCard title="LLM Configuration" icon="🤖">
      <div className="llm-row">
        {llm.provider ? <span className="llm-item"><span className="llm-label">Provider</span>{llm.provider}</span> : null}
        {llm.model || llm.modelKey ? <span className="llm-item"><span className="llm-label">Model</span>{llm.model ?? llm.modelKey}</span> : null}
      </div>
    </PortfolioSectionCard>
  );
}
