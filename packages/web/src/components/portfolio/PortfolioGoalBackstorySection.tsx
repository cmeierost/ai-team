import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioGoalBackstorySectionProps {
  isEditing: boolean;
  goal?: string;
  backstory?: string;
  onGoalChange?: (value?: string) => void;
  onBackstoryChange?: (value?: string) => void;
}

export function PortfolioGoalBackstorySection({ isEditing, goal, backstory, onGoalChange, onBackstoryChange }: Readonly<PortfolioGoalBackstorySectionProps>) {
  return (
    <PortfolioSectionCard title="Goal & Backstory" icon="🎯">
      {isEditing ? (
        <div className="portfolio-form-stack">
          <label>
            <span>Goal</span>
            <textarea
              className="portfolio-textarea"
              rows={2}
              placeholder="What this agent is trying to achieve…"
              value={goal ?? ''}
              onChange={(event) => onGoalChange?.(event.target.value || undefined)}
            />
          </label>
          <label>
            <span>Backstory</span>
            <textarea
              className="portfolio-textarea"
              rows={3}
              placeholder="Background, context, and persona…"
              value={backstory ?? ''}
              onChange={(event) => onBackstoryChange?.(event.target.value || undefined)}
            />
          </label>
        </div>
      ) : (
        <div className="goal-backstory-grid">
          {goal ? (
            <div className="goal-backstory-item">
              <div className="goal-backstory-label">Goal</div>
              <p className="goal-backstory-text">{goal}</p>
            </div>
          ) : null}
          {backstory ? (
            <div className="goal-backstory-item">
              <div className="goal-backstory-label">Backstory</div>
              <p className="goal-backstory-text">{backstory}</p>
            </div>
          ) : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
