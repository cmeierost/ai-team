import type { Agent, PermissionOverlapRegion } from '../../types';
import { formatRightMetric } from '../../utils/permissionMetrics';

interface PermissionAgentInfoCardProps {
  summary: {
    agentId: string;
    topRegion?: PermissionOverlapRegion;
    overlapCount: number;
  };
  agent?: Agent;
  selected: boolean;
  onSelect: (agentId: string) => void;
}

function regionPeerName(region: PermissionOverlapRegion, agentsById: Map<string, Agent>): string {
  const peerId = region.peerAgentIds[0];
  return agentsById.get(peerId)?.name ?? peerId;
}

export function PermissionAgentInfoCard({
  summary,
  agent,
  selected,
  onSelect,
  agentsById,
}: Readonly<PermissionAgentInfoCardProps & { agentsById: Map<string, Agent> }>) {
  return (
    <button
      type="button"
      className={`permissions-agent-card ${selected ? 'permissions-agent-card-active' : ''}`}
      onClick={() => onSelect(summary.agentId)}
    >
      <strong>{agent?.name ?? summary.agentId}</strong>
      <span>{summary.overlapCount} overlapping peer{summary.overlapCount === 1 ? '' : 's'}</span>
      <span>
        {summary.topRegion
          ? `Top: ${regionPeerName(summary.topRegion, agentsById)} · ${summary.topRegion.totalLines.toLocaleString()} lines`
          : 'No overlap'}
      </span>
      <span>
        {summary.topRegion
          ? `write: ${formatRightMetric(summary.topRegion, 'write')}`
          : 'write: 0'}
      </span>
      <div className="permission-inline-list">
        {(summary.topRegion?.sharedRights ?? []).map((right) => (
          <span key={right} className={`permission-chip permission-chip-right permission-chip-right-${right}`}>
            {right}
          </span>
        ))}
      </div>
      <div className="permission-inline-list">
        {(summary.topRegion?.rightFileEndingSummary?.write ?? summary.topRegion?.fileEndingSummary ?? []).slice(0, 3).map((entry) => (
          <span key={entry.extension} className="permission-mini-pill">
            {entry.extension}
          </span>
        ))}
      </div>
    </button>
  );
}
