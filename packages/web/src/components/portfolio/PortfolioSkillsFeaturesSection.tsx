import { useState } from 'react';
import { PortfolioSectionCard, TagInput } from './portfolioShared';

interface SkillsFeaturesFields {
  specializations: string[];
  features: string[];
}

interface PortfolioSkillsFeaturesSectionProps {
  specializations: string[];
  features: string[];
  onSave: (fields: SkillsFeaturesFields) => Promise<void>;
}

export function PortfolioSkillsFeaturesSection({ specializations, features, onSave }: Readonly<PortfolioSkillsFeaturesSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<SkillsFeaturesFields>({ specializations: [], features: [] });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft({ specializations: [...specializations], features: [...features] }); setSaveError(null); setIsEditing(true); };
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

  const v = isEditing ? draft : { specializations, features };

  return (
    <PortfolioSectionCard title="Specializations & Features" icon="⚡" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <div className="portfolio-form-stack">
          <label>
            <span>Specializations</span>
            <TagInput tags={v.specializations} onChange={(tags) => setDraft((d) => ({ ...d, specializations: tags }))} placeholder="Add specialization…" />
          </label>
          <label>
            <span>Features</span>
            <TagInput tags={v.features} onChange={(tags) => setDraft((d) => ({ ...d, features: tags }))} placeholder="Add feature…" />
          </label>
        </div>
      ) : (
        <div className="skill-tags-group">
          {v.specializations.map((item) => <span key={item} className="skill-tag">{item}</span>)}
          {v.features.map((item) => <span key={item} className="skill-tag skill-tag-feature">{item}</span>)}
          {v.specializations.length === 0 && v.features.length === 0 ? <p className="text-muted">No skills or features set.</p> : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
