import { useState } from 'react';
import { PortfolioSectionCard } from './portfolioShared';
import { getToolDisplayInfo } from '../../utils/toolDisplay';

interface ToolEntry {
  name: string;
  description: string;
  group?: string;
  allowedForAgent?: boolean;
}

interface PortfolioToolsPermissionsSectionProps {
  loading: boolean;
  error: string | null;
  entries: ToolEntry[];
  actionPending: string | null;
  onToggleTool: (toolName: string, allowed: boolean) => void;
}

function groupEntries(entries: ToolEntry[]): Map<string, ToolEntry[]> {
  const map = new Map<string, ToolEntry[]>();
  for (const entry of entries) {
    const key = entry.group ?? 'other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(entry);
  }
  return new Map(
    [...map.entries()].sort(([a], [b]) => {
      if (a === 'other') return 1;
      if (b === 'other') return -1;
      return a.localeCompare(b);
    })
  );
}

export function PortfolioToolsPermissionsSection({
  loading,
  error,
  entries,
  actionPending,
  onToggleTool,
}: Readonly<PortfolioToolsPermissionsSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);

  const allowed = entries.filter((e) => e.allowedForAgent === true);

  let bodyContent;
  if (loading) {
    bodyContent = <p className="text-muted">Loading tools…</p>;
  } else if (isEditing) {
    const groups = groupEntries(entries);
    bodyContent = (
      <div className="tool-groups">
        {entries.length === 0 ? (
          <p className="text-muted">No tools found.</p>
        ) : (
          [...groups.entries()].map(([group, tools]) => {
            const allAllowed = tools.every((t) => t.allowedForAgent === true);
            const someAllowed = tools.some((t) => t.allowedForAgent === true);
            return (
              <div key={group} className="tool-group">
                <div className="tool-group-header">
                  <span className="tool-group-name">{group}</span>
                  <button
                    type="button"
                    className="tool-group-toggle"
                    disabled={!!actionPending}
                    onClick={() => {
                      for (const t of tools) {
                        if (allAllowed ? t.allowedForAgent === true : t.allowedForAgent !== true) {
                          onToggleTool(t.name, t.allowedForAgent === true);
                        }
                      }
                    }}
                  >
                    {allAllowed ? 'Deny all' : someAllowed ? 'Allow rest' : 'Allow all'}
                  </button>
                </div>
                <div className="tool-active-chips">
                  {tools.map((tool) => {
                    const isAllowed = tool.allowedForAgent === true;
                    const pending = actionPending === tool.name;
                    const display = getToolDisplayInfo(tool.name, tool.group);
                    let chipIcon = isAllowed ? '✓' : '✕';
                    if (pending) chipIcon = '…';
                    return (
                      <button
                        key={tool.name}
                        type="button"
                        title={`${tool.description}\nID: ${display.canonicalId}`}
                        className={`tool-chip-toggle ${isAllowed ? 'tool-chip-allowed' : 'tool-chip-disallowed'}`}
                        onClick={() => onToggleTool(tool.name, isAllowed)}
                        disabled={pending || !!actionPending}
                      >
                        <span className="tool-chip-icon">{chipIcon}</span>
                        <span className="tool-chip-text">
                          <span className="tool-chip-label">{display.label}</span>
                          {display.showCanonicalId ? (
                            <span className="tool-chip-id">{display.canonicalId}</span>
                          ) : null}
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
    const groups = groupEntries(allowed);
    bodyContent = (
      <div className="tool-groups">
        {allowed.length === 0 ? (
          <p className="text-muted">No tools explicitly allowed (uses workspace defaults).</p>
        ) : (
          [...groups.entries()].map(([group, tools]) => (
            <div key={group} className="tool-group">
              <div className="tool-group-header">
                <span className="tool-group-name">{group}</span>
              </div>
              <div className="tool-active-chips">
                {tools.map((tool) => {
                  const display = getToolDisplayInfo(tool.name, tool.group);
                  return (
                    <span
                      key={tool.name}
                      title={`${tool.description}\nID: ${display.canonicalId}`}
                      className="tool-tag tool-tag-active"
                    >
                      <span className="tool-tag-label">{display.label}</span>
                      {display.showCanonicalId ? (
                        <span className="tool-tag-id">{display.canonicalId}</span>
                      ) : null}
                    </span>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    );
  }

  return (
    <PortfolioSectionCard
      title="Tools & Command Permissions"
      icon="🔧"
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
