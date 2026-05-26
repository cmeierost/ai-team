import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent } from '../../types';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioHierarchySectionProps {
  agentId: string;
  manager?: Agent;
  directReports: Agent[];
  reportsTo?: string;
  selectableAgents: Agent[];
  onSave: (reportsTo?: string) => Promise<void>;
}

export function PortfolioHierarchySection({ agentId, manager, directReports, reportsTo, selectableAgents, onSave }: Readonly<PortfolioHierarchySectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftReportsTo, setDraftReportsTo] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraftReportsTo(reportsTo); setSaveError(null); setIsEditing(true); };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draftReportsTo);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <PortfolioSectionCard title="Hierarchy" icon="🏢" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <label className="portfolio-form-label-full">
          <span>Reports To</span>
          <select value={draftReportsTo ?? ''} onChange={(e) => setDraftReportsTo(e.target.value || undefined)}>
            <option value="">— none (top level) —</option>
            {selectableAgents
              .filter((a) => a.id !== agentId)
              .sort((l, r) => l.name.localeCompare(r.name))
              .map((a) => (
                <option key={a.id} value={a.id}>{a.name} · {a.role}</option>
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

