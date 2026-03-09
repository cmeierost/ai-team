import type { Agent } from '../../types';
import { Avatar } from '../Avatar';
import { CONTEXT_LABELS, TYPE_LABELS } from './portfolioShared';
import '../Portfolio.css';

interface PortfolioHeaderProps {
  agent: Agent;
  isEditing: boolean;
  saving: boolean;
  draftName?: string;
  draftRole?: string;
  onDraftNameChange: (value: string) => void;
  onDraftRoleChange: (value: string) => void;
  onOpenChat: () => void;
  onStartEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onBack: () => void;
}

export function PortfolioHeader({
  agent,
  isEditing,
  saving,
  draftName,
  draftRole,
  onDraftNameChange,
  onDraftRoleChange,
  onOpenChat,
  onStartEdit,
  onSave,
  onCancel,
  onBack,
}: Readonly<PortfolioHeaderProps>) {
  return (
    <div className="portfolio-header">
      <Avatar agent={agent} size="large" />
      <div className="portfolio-header-info">
        {isEditing ? (
          <>
            <input
              placeholder="Name"
              className="portfolio-name-input"
              value={draftName ?? agent.name}
              onChange={(event) => onDraftNameChange(event.target.value)}
            />
            <input
              placeholder="Role"
              className="portfolio-role-input"
              value={draftRole ?? agent.role}
              onChange={(event) => onDraftRoleChange(event.target.value)}
            />
          </>
        ) : (
          <>
            <h2>{agent.name}</h2>
            <span className="portfolio-header-role">{agent.role}</span>
          </>
        )}
        <div className="portfolio-meta-chips">
          {agent.type ? <span className="portfolio-chip chip-type">{TYPE_LABELS[agent.type] ?? agent.type}</span> : null}
          {agent.contextLevel ? <span className="portfolio-chip chip-context">{CONTEXT_LABELS[agent.contextLevel] ?? agent.contextLevel}</span> : null}
          <span className={`status-badge status-${agent.status ?? 'available'}`}>{(agent.status ?? 'available').replace('-', ' ')}</span>
        </div>
      </div>
      <div className="portfolio-header-actions">
        {isEditing ? (
          <>
            <button className="btn-save" onClick={onSave} disabled={saving}>
              <i className="codicon codicon-check" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-header-action" onClick={onCancel} disabled={saving}>
              <i className="codicon codicon-close" /> Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={onOpenChat} className="btn-header-action">
              <i className="codicon codicon-comment-discussion" /> Chat
            </button>
            <button onClick={onStartEdit} className="btn-header-action">
              <i className="codicon codicon-edit" /> Edit
            </button>
            <button onClick={onBack} className="btn-header-action">
              <i className="codicon codicon-arrow-left" /> Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}
