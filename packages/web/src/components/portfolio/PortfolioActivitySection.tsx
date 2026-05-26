import { RelativeTime } from '../RelativeTime';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioActivitySectionProps {
  conversationCount?: number;
  lastInteraction?: string;
  createdAt?: string;
}

export function PortfolioActivitySection({ conversationCount, lastInteraction, createdAt }: Readonly<PortfolioActivitySectionProps>) {
  return (
    <PortfolioSectionCard title="Activity" icon="📊">
      <div className="activity-row">
        {conversationCount == undefined ? null : (
          <div className="activity-item">
            <span className="activity-value">{conversationCount}</span>
            <span className="activity-label">Conversations</span>
          </div>
        )}
        {lastInteraction ? (
          <div className="activity-item">
            <RelativeTime timestamp={lastInteraction} className="activity-value" />
            <span className="activity-label">Last interaction</span>
          </div>
        ) : null}
        {createdAt ? (
          <div className="activity-item">
            <RelativeTime timestamp={createdAt} className="activity-value" />
            <span className="activity-label">Created</span>
          </div>
        ) : null}
      </div>
    </PortfolioSectionCard>
  );
}
