import { useState } from 'react';
import type { AgentSkill } from '../../types';
import { PortfolioSectionCard, SkillEditor } from './portfolioShared';

interface PortfolioAgentSkillsSectionProps {
  skills: AgentSkill[];
  onSave: (skills: AgentSkill[]) => Promise<void>;
}

export function PortfolioAgentSkillsSection({ skills, onSave }: Readonly<PortfolioAgentSkillsSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AgentSkill[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft([...skills]); setSaveError(null); setIsEditing(true); };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortfolioSectionCard title="Agent Skills" icon="🧩" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <SkillEditor skills={draft} onChange={setDraft} />
      ) : (
        <div className="agent-skills-list">
          {skills.map((skill) => (
            <div key={skill.id} className="agent-skill-card">
              <div className="agent-skill-header">
                <span className="agent-skill-name">{skill.name}</span>
                {skill.tags?.map((tag) => <span key={tag} className="skill-tag skill-tag-sm">{tag}</span>)}
              </div>
              {skill.description ? <p className="agent-skill-desc">{skill.description}</p> : null}
              {skill.examples && skill.examples.length > 0 ? (
                <ul className="agent-skill-examples">
                  {skill.examples.map((ex, i) => <li key={`${skill.id}-${i}`}>{ex}</li>)}
                </ul>
              ) : null}
            </div>
          ))}
          {skills.length === 0 ? <p className="text-muted">No agent skills defined.</p> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}

