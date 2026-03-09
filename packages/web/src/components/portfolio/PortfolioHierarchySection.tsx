import { Link } from 'react-router-dom';
import type { Agent } from '../../types';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioHierarchySectionProps {
  agentId: string;
  isEditing: boolean;
  manager?: Agent;
  directReports: Agent[];
  reportsTo?: string;
  selectableAgents: Agent[];
  onReportsToChange?: (value?: string) => void;
}

export function PortfolioHierarchySection({
  agentId,
  isEditing,
  manager,
  directReports,
  reportsTo,
  selectableAgents,
  onReportsToChange,
}: Readonly<PortfolioHierarchySectionProps>) {
  return (
    <PortfolioSectionCard title="Hierarchy" icon="🏢">
      {isEditing ? (
        <label className="portfolio-form-label-full">
          <span>Reports To</span>
          <select value={reportsTo ?? ''} onChange={(event) => onReportsToChange?.(event.target.value || undefined)}>
            <option value="">— none (top level) —</option>
            {selectableAgents
              .filter((agent) => agent.id !== agentId)
              .sort((left, right) => left.name.localeCompare(right.name))
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.role}
                </option>
              ))}
          </select>
        </label>
      ) : (
        <div className="hierarchy-section">
          {manager ? (
            <div className="hierarchy-row">
              <span className="hierarchy-label">Reports to</span>
              <Link to={`/portfolio/${manager.id}`} className="hierarchy-agent-link">
                <Avatar agent={manager} size="small" />
                <span>{manager.name}</span>
                <span className="hierarchy-role">{manager.role}</span>
              </Link>
            </div>
          ) : (
            <p className="text-muted">No manager defined (top level).</p>
          )}
          {directReports.length > 0 ? (
            <div className="hierarchy-row">
              <span className="hierarchy-label">Direct reports</span>
              <div className="direct-reports-list">
                {directReports.map((report) => (
                  <Link key={report.id} to={`/portfolio/${report.id}`} className="hierarchy-agent-link">
                    <Avatar agent={report} size="small" />
                    <span>{report.name}</span>
                    <span className="hierarchy-role">{report.role}</span>
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
