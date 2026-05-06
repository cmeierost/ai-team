import { useState } from 'react';
import type { Agent, AgentHandoff } from '../../types';
import type { AiTeamHttpClient } from '@ai-team/api-contracts';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioHandoffsSectionProps {
  agentId: string;
  handoffs: AgentHandoff[];
  allAgents: Agent[];
  client: AiTeamHttpClient;
  onSave: (handoffs: AgentHandoff[]) => Promise<void>;
}

export function PortfolioHandoffsSection({
  agentId,
  handoffs,
  allAgents,
  client,
  onSave,
}: Readonly<PortfolioHandoffsSectionProps>) {
  const agentById = (id: string) => allAgents.find((a) => a.id === id);
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerate = async (handoff: AgentHandoff) => {
    setGenerating(handoff.agent);
    setGenerateError(null);
    try {
      const { prompt } = (await client.agents.generateHandoffPrompt(agentId, {
        targetAgentId: handoff.agent,
      })) as { prompt: string };
      const updated = handoffs.map((h) =>
        h.agent === handoff.agent && h.label === handoff.label ? { ...h, prompt } : h
      );
      await onSave(updated);
    } catch (e: any) {
      setGenerateError(e?.message || 'Failed to generate prompt');
    } finally {
      setGenerating(null);
    }
  };

  return (
    <PortfolioSectionCard title="Handoffs" icon="🤝">
      {generateError ? <p className="portfolio-section-error">{generateError}</p> : null}
      <div className="collabs-view">
        {handoffs.length === 0 ? (
          <p className="empty-text">No handoffs configured.</p>
        ) : (
          handoffs.map((entry) => {
            const agent = agentById(entry.agent);
            const isGenerating = generating === entry.agent;
            return (
              <div key={`${entry.agent}-${entry.label}`} className="collab-view-row">
                <Avatar agent={agent ?? null} size="small" />
                <div className="collab-view-info">
                  <span className="collab-view-name">{agent?.name ?? entry.agent}</span>
                  {agent?.role && <span className="collab-view-role">{agent.role}</span>}
                  <p className="collab-view-comment">{entry.label}</p>
                  {entry.prompt && <p className="collab-view-prompt">{entry.prompt}</p>}
                  <button
                    className="btn-generate-handoff"
                    onClick={() => handleGenerate(entry)}
                    disabled={isGenerating || generating !== null}
                    title="Generate handoff prompt using AI"
                  >
                    {isGenerating ? (
                      <>
                        <i className="codicon codicon-loading codicon-modifier-spin" /> Generating…
                      </>
                    ) : (
                      <>
                        <i className="codicon codicon-sparkle" /> Generate prompt
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </PortfolioSectionCard>
  );
}
