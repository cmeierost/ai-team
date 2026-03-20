import { useState } from 'react';
import type { Agent, AvatarConfig } from '../../types';
import { Avatar } from '../Avatar';
import { CONTEXT_LABELS, TYPE_LABELS } from './portfolioShared';
import '../Portfolio.css';

interface PortfolioHeaderSaveFields {
  role: string;
  avatar?: AvatarConfig;
}

interface PortfolioHeaderProps {
  agent: Agent;
  onOpenChat: () => void;
  onSave: (fields: PortfolioHeaderSaveFields) => Promise<void>;
  onBack: () => void;
}

export function PortfolioHeader({ agent, onOpenChat, onSave, onBack }: Readonly<PortfolioHeaderProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftRole, setDraftRole] = useState('');
  const [draftAvatarUrl, setDraftAvatarUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => {
    setDraftRole(agent.role);
    setDraftAvatarUrl(agent.avatar?.url ?? '');
    setSaveError(null);
    setIsEditing(true);
  };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const avatarChanged = draftAvatarUrl !== (agent.avatar?.url ?? '');
      const avatar: AvatarConfig | undefined = avatarChanged
        ? { ...agent.avatar, type: 'url', url: draftAvatarUrl || undefined }
        : undefined;
      await onSave({ role: draftRole, ...(avatarChanged ? { avatar } : {}) });
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="portfolio-header">
      <Avatar agent={agent} size="large" />
      <div className="portfolio-header-info">
        <h2>{agent.name}</h2>
        {isEditing ? (
          <div className="portfolio-header-edit-fields">
            <input
              placeholder="Role"
              className="portfolio-role-input"
              value={draftRole}
              onChange={(e) => setDraftRole(e.target.value)}
              aria-label="Role"
            />
            <input
              placeholder="Avatar URL (optional)"
              className="portfolio-role-input"
              value={draftAvatarUrl}
              onChange={(e) => setDraftAvatarUrl(e.target.value)}
              aria-label="Avatar URL"
            />
            {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
          </div>
        ) : (
          <span className="portfolio-header-role">{agent.role}</span>
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
            <button className="btn-save" onClick={save} disabled={saving}>
              <i className="codicon codicon-check" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-header-action" onClick={cancel} disabled={saving}>
              <i className="codicon codicon-close" /> Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={onOpenChat} className="btn-header-action">
              <i className="codicon codicon-comment-discussion" /> Chat
            </button>
            <button onClick={startEdit} className="btn-header-action">
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
