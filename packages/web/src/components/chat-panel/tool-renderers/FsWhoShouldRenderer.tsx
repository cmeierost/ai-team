import type { ReactNode } from 'react';
import type { SessionActivatedTool } from '../../../types';
import { registerRenderer } from './registry';

interface WhoMatch {
  agentId?: string;
  agentName?: string;
  agentRole?: string;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

registerRenderer({
  toolName: 'fs_who_should',
  render(result: unknown, _resultLlm: unknown, _event: SessionActivatedTool): ReactNode {
    if (!result || typeof result !== 'object') return null;
    const r = result as Record<string, unknown>;
    const matches: WhoMatch[] = Array.isArray(r.matches) ? r.matches as WhoMatch[] : [];
    const task = typeof r.task === 'string' ? r.task : undefined;

    return (
      <div className="tc-who-should">
        {task && <div className="tc-label">{task}</div>}
        {matches.length === 0 ? (
          <div className="tc-muted">No matching teammate found</div>
        ) : (
          <div className="tc-who-list">
            {matches.slice(0, 6).map((match, i) => (
              <div key={match.agentId ?? i} className="tc-who-item">
                <span className="tc-who-avatar">{getInitials(match.agentName ?? '?')}</span>
                <span className="tc-who-name">{match.agentName ?? match.agentId}</span>
                {match.agentRole && <span className="tc-meta"> · {match.agentRole}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  },
});
