import { useState } from 'react';
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

function skillButtonLabel(pending: boolean, isAssigned: boolean): string {
  if (pending) return 'Updating…';
  if (isAssigned) return 'Remove';
  return 'Assign';
}

export function PortfolioSkillAssignmentsSection({
  loading,
  error,
  entries,
  actionPending,
  onToggleSkill,
}: Readonly<PortfolioSkillAssignmentsSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);

  const assigned = entries.filter((e) => e.assignedToAgent === true);

  let bodyContent;
  if (loading) {
    bodyContent = <p className="text-muted">Loading skills…</p>;
  } else if (isEditing) {
    bodyContent = (
      <div className="tool-permissions-list">
        {entries.length === 0 ? (
          <p className="text-muted">No skills available.</p>
        ) : (
          entries.map((entry) => {
            const isAssigned = entry.assignedToAgent === true;
            const pending = actionPending === entry.name;
            return (
              <div key={entry.name} className="tool-permission-item">
                <div className="tool-permission-main">
                  <div className="tool-permission-name-row">
                    <span className="tool-tag">{entry.name}</span>
                    <span className={`tool-permission-state ${isAssigned ? 'allowed' : 'disallowed'}`}>
                      {isAssigned ? 'Assigned' : 'Not assigned'}
                    </span>
                  </div>
                  {entry.description ? <p className="tool-permission-description">{entry.description}</p> : null}
                </div>
                <button
                  type="button"
                  className={`tool-permission-toggle ${isAssigned ? 'is-disallow' : 'is-allow'}`}
                  onClick={() => onToggleSkill(entry.name, isAssigned)}
                  disabled={pending || !!actionPending}
                >
                  {skillButtonLabel(pending, isAssigned)}
                </button>
              </div>
            );
          })
        )}
      </div>
    );
  } else {
    bodyContent = (
      <div className="tool-active-chips">
        {assigned.length === 0 ? (
          <p className="text-muted">No skills assigned.</p>
        ) : (
          assigned.map((e) => (
            <span key={e.name} className="tool-tag tool-tag-active">{e.name}</span>
          ))
        )}
      </div>
    );
  }

  return (
    <PortfolioSectionCard
      title="Skills"
      icon="🎓"
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

