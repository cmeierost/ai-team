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

export function PortfolioToolsPermissionsSection({ loading, error, entries, actionPending, onToggleTool }: Readonly<PortfolioToolsPermissionsSectionProps>) {
  return (
    <PortfolioSectionCard title="Tools & Command Permissions" icon="🔧">
      {error ? (
        <div className="tool-permissions-error">
          <i className="codicon codicon-error" /> {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted">Loading tool catalog…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">No tools found.</p>
      ) : (
        <div className="tool-permissions-list">
          {entries.map((tool) => {
            const allowed = tool.allowedForAgent === true;
            const pending = actionPending === tool.name;
            return (
              <div key={tool.name} className="tool-permission-item">
                <div className="tool-permission-main">
                  <div className="tool-permission-name-row">
                    <span className="tool-tag">{tool.name}</span>
                    <span className={`tool-permission-state ${allowed ? 'allowed' : 'disallowed'}`}>
                      {allowed ? 'Allowed' : 'Disallowed'}
                    </span>
                  </div>
                  <p className="tool-permission-description">{tool.description}</p>
                </div>
                <button
                  type="button"
                  className={`tool-permission-toggle ${allowed ? 'is-disallow' : 'is-allow'}`}
                  onClick={() => onToggleTool(tool.name, allowed)}
                  disabled={pending || !!actionPending}
                >
                  {pending ? 'Updating…' : allowed ? 'Disallow' : 'Allow'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
