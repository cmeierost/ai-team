import type { AgentPersonality } from '../../types';
import { LEVEL_CHIP, PortfolioSectionCard, STYLE_ICONS } from './portfolioShared';

interface PortfolioPersonalitySectionProps {
  isEditing: boolean;
  personality?: AgentPersonality;
  onCommunicationStyleChange?: (value?: AgentPersonality['communication_style']) => void;
  onExpertiseLevelChange?: (value?: AgentPersonality['expertise_level']) => void;
  onMentoringChange?: (value: boolean) => void;
}

export function PortfolioPersonalitySection({
  isEditing,
  personality,
  onCommunicationStyleChange,
  onExpertiseLevelChange,
  onMentoringChange,
}: Readonly<PortfolioPersonalitySectionProps>) {
  const hasMentoringInfo = typeof personality?.mentoring === 'boolean';

  return (
    <PortfolioSectionCard title="Personality" icon="🧠">
      {isEditing ? (
        <div className="portfolio-form-grid">
          <label>
            <span>Communication Style</span>
            <select
              value={personality?.communication_style ?? ''}
              onChange={(event) => onCommunicationStyleChange?.((event.target.value as AgentPersonality['communication_style']) || undefined)}
            >
              <option value="">— none —</option>
              {(['collaborative', 'direct', 'supportive', 'analytical', 'strategic'] as const).map((style) => (
                <option key={style} value={style}>
                  {STYLE_ICONS[style]} {style.charAt(0).toUpperCase() + style.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Expertise Level</span>
            <select
              value={personality?.expertise_level ?? ''}
              onChange={(event) => onExpertiseLevelChange?.((event.target.value as AgentPersonality['expertise_level']) || undefined)}
            >
              <option value="">— none —</option>
              {(['executive', 'senior', 'mid-level', 'junior'] as const).map((level) => (
                <option key={level} value={level}>
                  {level.charAt(0).toUpperCase() + level.slice(1)}
                </option>
              ))}
            </select>
          </label>
          <label className="portfolio-checkbox-label">
            <input
              type="checkbox"
              checked={personality?.mentoring ?? false}
              onChange={(event) => onMentoringChange?.(event.target.checked)}
            />
            <span>Available for mentoring</span>
          </label>
        </div>
      ) : (
        <div className="personality-grid">
          {personality?.communication_style ? (
            <div className="personality-item">
              <span className="personality-icon">{STYLE_ICONS[personality.communication_style]}</span>
              <div>
                <div className="personality-label">Communication style</div>
                <div className="personality-value">{personality.communication_style}</div>
              </div>
            </div>
          ) : null}
          {personality?.expertise_level ? (
            <div className="personality-item">
              <span className={`portfolio-chip ${LEVEL_CHIP[personality.expertise_level] ?? ''}`}>{personality.expertise_level}</span>
              <div>
                <div className="personality-label">Expertise level</div>
                <div className="personality-value">{personality.expertise_level}</div>
              </div>
            </div>
          ) : null}
          {hasMentoringInfo ? (
            <div className="personality-item">
              <span className="personality-icon">{personality.mentoring ? '✅' : '—'}</span>
              <div>
                <div className="personality-label">Mentoring</div>
                <div className="personality-value">{personality.mentoring ? 'Available' : 'Not available'}</div>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
