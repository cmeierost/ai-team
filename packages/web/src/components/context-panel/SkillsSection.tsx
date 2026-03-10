import type { SkillEntry } from '../../hooks/useSkillsForAgent';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface SkillsSectionProps {
  skillEntries: SkillEntry[];
  skillsLoading: boolean;
  skillsError: string | null;
  skillActionPending: string | null;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
  onToggleSkill: (skillName: string, assigned: boolean) => void;
}

export function SkillsSection({ skillEntries, skillsLoading, skillsError, skillActionPending, expandedSection, onToggleSection, onToggleSkill }: Readonly<SkillsSectionProps>) {
  return (
    <ContextPanelSectionFrame
      section="skills"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={<span><i className="codicon codicon-library" /> Skills</span>}
      count={skillEntries.filter((entry) => entry.assignedToAgent).length}
    >
      {skillsLoading ? (
        <div className="context-loading">Loading skills...</div>
      ) : skillEntries.length === 0 ? (
        <div className="context-empty">No skills available.</div>
      ) : (
        <div className="context-items">
          {skillEntries.map((entry) => {
            const assigned = entry.assignedToAgent === true;
            const pending = skillActionPending === entry.name;
            return (
              <div key={entry.name} className={`context-item ${assigned ? 'context-item-active' : ''}`}>
                <div className="context-item-header">
                  <span className="context-item-title">{entry.name}</span>
                  <button
                    className="context-item-action context-skill-action"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleSkill(entry.name, assigned);
                    }}
                    disabled={pending || !!skillActionPending}
                    title={assigned ? 'Remove skill' : 'Assign skill'}
                  >
                    {pending ? '…' : assigned ? '−' : '+'}
                  </button>
                </div>
                {entry.description ? (
                  <div className="context-item-meta">
                    <span className="context-item-extra">{entry.description}</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      {skillsError ? <div className="context-empty context-skills-error">{skillsError}</div> : null}
    </ContextPanelSectionFrame>
  );
}
