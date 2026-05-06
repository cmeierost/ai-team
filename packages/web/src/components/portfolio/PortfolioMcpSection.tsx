import { useState } from 'react';
import type { McpServerEntry } from '@ai-team/api-contracts';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioMcpSectionProps {
  servers: McpServerEntry[];
  loading: boolean;
  error: string | null;
  actionPending: string | null;
  onToggleServer: (serverId: string, currentlyAllowed: boolean) => void;
}

function groupByType(servers: McpServerEntry[]): Map<string, McpServerEntry[]> {
  const map = new Map<string, McpServerEntry[]>();
  for (const s of servers) {
    const key = s.type === 'http' ? 'HTTP' : 'stdio';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(s);
  }
  return map;
}

function serverTitle(s: McpServerEntry): string {
  if (s.type === 'http') return s.url ?? s.id;
  return [s.command, ...(s.args ?? [])].filter(Boolean).join(' ');
}

export function PortfolioMcpSection({
  servers,
  loading,
  error,
  actionPending,
  onToggleServer,
}: Readonly<PortfolioMcpSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);

  const allowed = servers.filter((s) => s.allowedForAgent !== false);

  let bodyContent;
  if (loading) {
    bodyContent = <p className="text-muted">Loading MCP servers…</p>;
  } else if (isEditing) {
    const groups = groupByType(servers);
    bodyContent = (
      <div className="tool-groups">
        {servers.length === 0 ? (
          <p className="text-muted">No MCP servers configured.</p>
        ) : (
          [...groups.entries()].map(([group, groupServers]) => {
            const allAllowed = groupServers.every((s) => s.allowedForAgent !== false);
            const someAllowed = groupServers.some((s) => s.allowedForAgent !== false);
            return (
              <div key={group} className="tool-group">
                <div className="tool-group-header">
                  <span className="tool-group-name">{group}</span>
                  <button
                    type="button"
                    className="tool-group-toggle"
                    disabled={!!actionPending}
                    onClick={() => {
                      for (const s of groupServers) {
                        const isAllowed = s.allowedForAgent !== false;
                        if (allAllowed ? isAllowed : !isAllowed) {
                          onToggleServer(s.id, isAllowed);
                        }
                      }
                    }}
                  >
                    {allAllowed ? 'Deny all' : someAllowed ? 'Allow rest' : 'Allow all'}
                  </button>
                </div>
                <div className="tool-active-chips">
                  {groupServers.map((s) => {
                    const isAllowed = s.allowedForAgent !== false;
                    const pending = actionPending === s.id;
                    let chipIcon = isAllowed ? '✓' : '✕';
                    if (pending) chipIcon = '…';
                    return (
                      <button
                        key={s.id}
                        type="button"
                        title={serverTitle(s)}
                        className={`tool-chip-toggle ${isAllowed ? 'tool-chip-allowed' : 'tool-chip-disallowed'}`}
                        onClick={() => onToggleServer(s.id, isAllowed)}
                        disabled={pending || !!actionPending}
                      >
                        <span className="tool-chip-icon">{chipIcon}</span>
                        <span className="tool-chip-text">
                          <span className="tool-chip-label">{s.id}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    );
  } else {
    const groups = groupByType(allowed);
    bodyContent = (
      <div className="tool-groups">
        {allowed.length === 0 ? (
          <p className="text-muted">No MCP servers allowed for this agent.</p>
        ) : (
          [...groups.entries()].map(([group, groupServers]) => (
            <div key={group} className="tool-group">
              <div className="tool-group-header">
                <span className="tool-group-name">{group}</span>
              </div>
              <div className="tool-active-chips">
                {groupServers.map((s) => (
                  <span key={s.id} className="tool-tag tool-tag-active" title={serverTitle(s)}>
                    {s.id}
                  </span>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <PortfolioSectionCard
      title="MCP Servers"
      icon="🔌"
      onEdit={() => setIsEditing(true)}
      isEditing={isEditing}
      onCancel={() => setIsEditing(false)}
    >
      {error ? (
        <div className="tool-permissions-error">
          <i className="codicon codicon-error" /> {error}
        </div>
      ) : null}
      {bodyContent}
    </PortfolioSectionCard>
  );
}
