import { useEffect, useState } from 'react';
import type { Agent, PermissionRight } from '../../types';
import { useAgentOverlap } from '../../hooks/useAgentOverlap';
import { PortfolioSectionCard } from './portfolioShared';
import { PortfolioOverlapView } from './PortfolioOverlapView';
import { getRegionMetricValue } from '../../utils/permissionMetrics';

interface PortfolioOverlapSectionProps {
  agent: Agent;
  allAgents: readonly Agent[];
}

export function PortfolioOverlapSection({ agent, allAgents }: Readonly<PortfolioOverlapSectionProps>) {
  const [requested, setRequested] = useState(false);
  const [selectedRight, setSelectedRight] = useState<PermissionRight>('write');
  const { view, isLoading, error, analyze, isFetching } = useAgentOverlap(agent.id, { enabled: requested });
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);
  const visibleRegions = view?.peerRegions.filter((region) => getRegionMetricValue(region, selectedRight) > 0) ?? [];

  useEffect(() => {
    setSelectedRegionId(visibleRegions[0]?.id);
  }, [view?.focusAgentId, selectedRight, visibleRegions]);

  return (
    <PortfolioSectionCard title="Overlap Map" icon="◌">
      {!requested ? (
        <div className="permission-analysis-gate">
          <p>This analysis is intentionally not loaded by default because it is expensive. Run it when you want to optimize this specific agent.</p>
          <button type="button" className="permission-analyze-button" onClick={() => setRequested(true)}>
            Analyze overlap
          </button>
        </div>
      ) : isLoading || isFetching ? (
        <div className="permission-overlap-empty">
          <i className="codicon codicon-loading codicon-modifier-spin" /> Loading overlap analysis…
        </div>
      ) : error ? (
        <div className="permission-analysis-gate">
          <p className="portfolio-section-error">{error instanceof Error ? error.message : 'Failed to load overlap analysis'}</p>
          <button type="button" className="permission-analyze-button" onClick={() => void analyze()}>
            Retry overlap analysis
          </button>
        </div>
      ) : !view || visibleRegions.length === 0 ? (
        <div className="permission-overlap-empty">No {selectedRight} overlap regions were found for this agent.</div>
      ) : (
        <PortfolioOverlapView
          focusAgent={agent}
          agents={allAgents}
          regions={view.peerRegions}
          selectedRight={selectedRight}
          onSelectedRightChange={setSelectedRight}
          suggestions={view.suggestions}
          selectedRegionId={selectedRegionId}
          onSelectRegion={setSelectedRegionId}
        />
      )}
    </PortfolioSectionCard>
  );
}
