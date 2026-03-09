import { PortfolioSectionCard } from './portfolioShared';

interface SkillEntry {
  name: string;
  description: string;
  assignedToAgent?: boolean;
}

interface PortfolioSkillAssignmentsSectionProps {
  loading: boolean;
  error: string | null;
  entries: SkillEntry[];
  actionPending: string | null;
  onToggleSkill: (skillName: string, assigned: boolean) => void;
}

export function PortfolioSkillAssignmentsSection({ loading, error, entries, actionPending, onToggleSkill }: Readonly<PortfolioSkillAssignmentsSectionProps>) {
  return (
    <PortfolioSectionCard title="Skill Assignments" icon="🎓">
      {error ? (
        <div className="tool-permissions-error">
          <i className="codicon codicon-error" /> {error}
        </div>
      ) : null}

      {loading ? (
        <p className="text-muted">Loading skills…</p>
      ) : entries.length === 0 ? (
        <p className="text-muted">No skills found.</p>
      ) : (
        <div className="tool-permissions-list">
          {entries.map((entry) => {
            const assigned = entry.assignedToAgent === true;
            const pending = actionPending === entry.name;
            return (
              <div key={entry.name} className="tool-permission-item">
                <div className="tool-permission-main">
                  <div className="tool-permission-name-row">
                    <span className="tool-tag">{entry.name}</span>
                    <span className={`tool-permission-state ${assigned ? 'allowed' : 'disallowed'}`}>
                      {assigned ? 'Assigned' : 'Unassigned'}
                    </span>
                  </div>
                  {entry.description ? <p className="tool-permission-description">{entry.description}</p> : null}
                </div>
                <button
                  type="button"
                  className={`tool-permission-toggle ${assigned ? 'is-disallow' : 'is-allow'}`}
                  onClick={() => onToggleSkill(entry.name, assigned)}
                  disabled={pending || !!actionPending}
                >
                  {pending ? 'Updating…' : assigned ? 'Remove' : 'Assign'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
