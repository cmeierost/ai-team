import { useState } from 'react';
import { PortfolioSectionCard } from './portfolioShared';

interface ToolEntry {
  name: string;
  description: string;
  allowedForAgent?: boolean;
}

interface PortfolioToolsPermissionsSectionProps {
  loading: boolean;
  error: string | null;
  entries: ToolEntry[];
  actionPending: string | null;
  onToggleTool: (toolName: string, allowed: boolean) => void;
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
    bodyContent = (
      <div className="tool-active-chips">
        {entries.length === 0 ? (
          <p className="text-muted">No tools found.</p>
        ) : (
          entries.map((tool) => {
            const isAllowed = tool.allowedForAgent === true;
            const pending = actionPending === tool.name;
            let chipIcon = isAllowed ? '✓' : '✕';
            if (pending) chipIcon = '…';
            return (
              <button
                key={tool.name}
                type="button"
                title={tool.description}
                className={`tool-chip-toggle ${isAllowed ? 'tool-chip-allowed' : 'tool-chip-disallowed'}`}
                onClick={() => onToggleTool(tool.name, isAllowed)}
                disabled={pending || !!actionPending}
              >
                <span className="tool-chip-icon">{chipIcon}</span>
                {tool.name}
              </button>
            );
          })
        )}
      </div>
    );
  } else {
    bodyContent = (
      <div className="tool-active-chips">
        {allowed.length === 0 ? (
          <p className="text-muted">No tools explicitly allowed (uses workspace defaults).</p>
        ) : (
          allowed.map((t) => (
            <span key={t.name} title={t.description} className="tool-tag tool-tag-active">{t.name}</span>
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

