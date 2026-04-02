import type { CSSProperties } from 'react';
import type { Agent, PermissionAgentResponsibilitySummary, PermissionRight } from '../../types';
import { getAgentHue } from '../../utils/color';
import { Avatar } from '../Avatar';

interface PermissionAgentContextCardProps {
  agent?: Agent;
  agentId: string;
  responsibility?: PermissionAgentResponsibilitySummary;
  workspaceFileCount?: number;
  onOpenPermissionFile?: () => void;
  onOpenPortfolio?: () => void;
  onFocusAgent?: () => void;
  focusLabel?: string;
}

const RIGHTS: PermissionRight[] = ['read', 'write', 'list'];

export function PermissionAgentContextCard({
  agent,
  agentId,
  responsibility,
  workspaceFileCount = 0,
  onOpenPermissionFile,
  onOpenPortfolio,
  onFocusAgent,
  focusLabel = 'Focus',
}: Readonly<PermissionAgentContextCardProps>) {
  const hue = agent ? getAgentHue(agent) : 210;
  const name = agent?.name ?? agentId;
  return (
    <div
      className="permission-summary-card permission-agent-context-card"
      style={{ '--agent-hue': `${hue}` } as CSSProperties}
    >
      <div className="permission-inspector-agent-row">
        <Avatar agent={agent} size="small" />
        <span className="permission-summary-label">{name}</span>
      </div>
      <span className="permission-muted">{agent?.role ?? 'agent'}</span>
      <div className="permission-inline-list">
        {onFocusAgent ? (
          <button type="button" className="permission-context-mini-button" onClick={onFocusAgent}>
            {focusLabel}
          </button>
        ) : null}
        {onOpenPermissionFile ? (
          <button type="button" className="permission-context-mini-button" onClick={onOpenPermissionFile}>
            Open perm
          </button>
        ) : null}
        {onOpenPortfolio ? (
          <button type="button" className="permission-context-mini-button" onClick={onOpenPortfolio}>
            Open portfolio
          </button>
        ) : null}
      </div>
      <div className="permission-right-grid">
        {RIGHTS.map((right) => (
          <div key={`${agentId}-${right}`} className={`permission-right-card permission-chip-right-${right}`}>
            <span className="permission-right-name">{right}</span>
            {(right === 'read' || right === 'write')
              ? (
                  <span>
                    {(responsibility?.rightLineCounts[right] ?? 0).toLocaleString()} lines
                  </span>
                )
              : (
                  <span>{(responsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files</span>
                )}
            {(right === 'read' || right === 'write') ? (
              <span className="permission-muted">
                {(responsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files
              </span>
            ) : null}
            <span className="permission-muted">
              {workspaceFileCount > 0
                ? `${(((responsibility?.rightFileCounts[right] ?? 0) / workspaceFileCount) * 100).toFixed(1)}% workspace`
                : '0.0% workspace'}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
