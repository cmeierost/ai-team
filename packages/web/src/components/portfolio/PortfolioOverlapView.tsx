import type { Agent, PermissionOverlapRegion, PermissionRight } from '../../types';
import { PermissionOverlapDiagram } from '../permissions/PermissionOverlapDiagram';
import { PermissionOverlapInspector } from '../permissions/PermissionOverlapInspector';
import { formatRightMetric, getRegionMetricValue } from '../../utils/permissionMetrics';
import '../permissions/PermissionsAnalysis.css';

interface PortfolioOverlapViewProps {
  focusAgent: Agent;
  agents: readonly Agent[];
  regions: readonly PermissionOverlapRegion[];
  selectedRight: PermissionRight;
  onSelectedRightChange: (right: PermissionRight) => void;
  suggestions?: ReadonlyArray<{ id: string; title: string; rationale: string; severity: 'high' | 'medium' | 'low' }>;
  selectedRegionId?: string;
  onSelectRegion: (regionId: string) => void;
}

export function PortfolioOverlapView({
  focusAgent,
  agents,
  regions,
  selectedRight,
  onSelectedRightChange,
  suggestions = [],
  selectedRegionId,
  onSelectRegion,
}: Readonly<PortfolioOverlapViewProps>) {
  const filteredRegions = regions.filter((region) => getRegionMetricValue(region, selectedRight) > 0);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const selectedRegion = filteredRegions.find((region) => region.id === selectedRegionId) ?? filteredRegions[0];
  const strongestRegion = filteredRegions[0];
  const highestWriteRegion = [...filteredRegions]
    .sort((left, right) =>
      right.rightLineCounts.write - left.rightLineCounts.write
      || right.totalLines - left.totalLines
    )[0];
  const strongestForSelectedRight = [...filteredRegions]
    .sort((left, right) =>
      getRegionMetricValue(right, selectedRight) - getRegionMetricValue(left, selectedRight)
      || right.rightFileCounts[selectedRight] - left.rightFileCounts[selectedRight]
      || right.totalLines - left.totalLines
    )[0];

  return (
    <div className="permission-overlap-layout">
      <div className="permissions-right-toggle">
        <span>Permission type</span>
        <div className="permission-chip-row">
          {(['write', 'read', 'list'] as PermissionRight[]).map((right) => (
            <button
              key={right}
              type="button"
              className={`permission-right-toggle-button ${selectedRight === right ? 'permission-right-toggle-button-active' : ''}`}
              onClick={() => onSelectedRightChange(right)}
            >
              {right}
            </button>
          ))}
        </div>
      </div>

      <div className="permission-overlap-summary-row">
        <div className="permission-summary-card">
          <span className="permission-summary-label">Overlapping peers</span>
          <strong>{filteredRegions.length}</strong>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Strongest {selectedRight} overlap</span>
            <strong>{strongestForSelectedRight?.peerAgentIds[0] ?? '—'}</strong>
            <span>
              {strongestForSelectedRight
                ? formatRightMetric(strongestForSelectedRight, selectedRight)
                : 'No overlap yet'}
            </span>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Highest write overlap</span>
          <strong>{highestWriteRegion?.peerAgentIds[0] ?? '—'}</strong>
          <span>{highestWriteRegion ? `${highestWriteRegion.rightFileCounts.write} writable files` : 'No write overlap'}</span>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Dominant endings</span>
          <div className="permission-inline-list">
            {(selectedRegion?.rightFileEndingSummary?.[selectedRight] ?? selectedRegion?.fileEndingSummary ?? []).slice(0, 3).map((entry) => (
              <span key={entry.extension} className="permission-mini-pill">
                {entry.extension}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="permission-overlap-main">
        <PermissionOverlapDiagram
          focusAgent={focusAgent}
          agentsById={agentsById}
          regions={filteredRegions}
          selectedRight={selectedRight}
          onSelectAgent={() => {}}
          selectedRegionId={selectedRegion?.id}
          onSelectRegion={onSelectRegion}
          emptyLabel={`No ${selectedRight} overlap found for this agent.`}
        />
        <PermissionOverlapInspector
          region={selectedRegion}
          agentsById={agentsById}
          workspaceFileCount={0}
        />
      </div>

      <div className="permission-section-block">
        <h4>Agent-specific suggestions</h4>
        <div className="permissions-suggestion-list">
          {suggestions.length === 0 ? (
            <div className="permissions-suggestion">
              <p>No deterministic suggestions were generated for this agent yet.</p>
            </div>
          ) : (
            suggestions.map((suggestion) => (
              <article key={suggestion.id} className={`permissions-suggestion permissions-suggestion-${suggestion.severity}`}>
                <header>
                  <span className={`permission-chip permission-chip-severity permission-chip-severity-${suggestion.severity}`}>
                    {suggestion.severity}
                  </span>
                  <h3>{suggestion.title}</h3>
                </header>
                <p>{suggestion.rationale}</p>
              </article>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
