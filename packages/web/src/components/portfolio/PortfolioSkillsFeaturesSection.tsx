import { PortfolioSectionCard, TagInput } from './portfolioShared';

interface PortfolioSkillsFeaturesSectionProps {
  isEditing: boolean;
  specializations: string[];
  features: string[];
  onSpecializationsChange?: (values: string[]) => void;
  onFeaturesChange?: (values: string[]) => void;
}

export function PortfolioSkillsFeaturesSection({
  isEditing,
  specializations,
  features,
  onSpecializationsChange,
  onFeaturesChange,
}: Readonly<PortfolioSkillsFeaturesSectionProps>) {
  return (
    <PortfolioSectionCard title="Skills & Features" icon="⚡">
      {isEditing ? (
        <div className="portfolio-form-stack">
          <label>
            <span>Specializations</span>
            <TagInput tags={specializations} onChange={(tags) => onSpecializationsChange?.(tags)} placeholder="Add specialization…" />
          </label>
          <label>
            <span>Features</span>
            <TagInput tags={features} onChange={(tags) => onFeaturesChange?.(tags)} placeholder="Add feature…" />
          </label>
        </div>
      ) : (
        <div className="skill-tags-group">
          {specializations.map((item) => (
            <span key={item} className="skill-tag">
              {item}
            </span>
          ))}
          {features.map((item) => (
            <span key={item} className="skill-tag skill-tag-feature">
              {item}
            </span>
          ))}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
