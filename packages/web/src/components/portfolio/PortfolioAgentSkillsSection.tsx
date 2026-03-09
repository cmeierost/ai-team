import type { AgentSkill } from '../../types';
import { PortfolioSectionCard, SkillEditor } from './portfolioShared';

interface PortfolioAgentSkillsSectionProps {
  isEditing: boolean;
  skills: AgentSkill[];
  onSkillsChange?: (skills: AgentSkill[]) => void;
}

export function PortfolioAgentSkillsSection({ isEditing, skills, onSkillsChange }: Readonly<PortfolioAgentSkillsSectionProps>) {
  return (
    <PortfolioSectionCard title="Agent Skills" icon="🧩">
      {isEditing ? (
        <SkillEditor skills={skills} onChange={(nextSkills) => onSkillsChange?.(nextSkills)} />
      ) : (
        <div className="agent-skills-list">
          {skills.map((skill) => (
            <div key={skill.id} className="agent-skill-card">
              <div className="agent-skill-header">
                <span className="agent-skill-name">{skill.name}</span>
                {skill.tags?.map((tag) => (
                  <span key={tag} className="skill-tag skill-tag-sm">
                    {tag}
                  </span>
                ))}
              </div>
              {skill.description ? <p className="agent-skill-desc">{skill.description}</p> : null}
              {skill.examples && skill.examples.length > 0 ? (
                <ul className="agent-skill-examples">
                  {skill.examples.map((example, index) => (
                    <li key={`${skill.id}-${index}`}>{example}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
