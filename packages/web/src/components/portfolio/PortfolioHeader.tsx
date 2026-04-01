import { useRef, useState } from 'react';
import type React from 'react';
import type { Agent, AvatarConfig } from '../../types';
import { Avatar } from '../Avatar';
import { getAgentHue, getAgentColorHex } from '../../utils/color';
import { CONTEXT_LABELS, TYPE_LABELS } from './portfolioShared';
import '../Portfolio.css';

interface PortfolioHeaderSaveFields {
  role: string;
  color?: string;
}

interface PortfolioHeaderProps {
  agent: Agent;
  onOpenChat: () => void;
  onSave: (fields: PortfolioHeaderSaveFields) => Promise<void>;
  onUploadAvatar: (base64: string, ext: string) => Promise<void>;
  onBack: () => void;
}

export function PortfolioHeader({ agent, onOpenChat, onSave, onUploadAvatar, onBack }: Readonly<PortfolioHeaderProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftRole, setDraftRole] = useState('');
  const [draftColor, setDraftColor] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startEdit = () => {
    setDraftRole(agent.role);
    setDraftColor(getAgentColorHex(agent));
    setSaveError(null);
    setIsEditing(true);
  };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const colorChanged = draftColor !== getAgentColorHex(agent);
      await onSave({ role: draftRole, ...(colorChanged ? { color: draftColor } : {}) });
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const ext = file.name.split('.').pop()?.toLowerCase() ?? 'jpg';
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = (reader.result as string).split(',')[1];
      setUploading(true);
      setSaveError(null);
      try {
        await onUploadAvatar(base64, ext);
      } catch (err: any) {
        setSaveError(err?.message || 'Upload failed');
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  const liveHue = isEditing ? (() => {
    const m = draftColor.match(/^#([0-9a-f]{6})$/i);
    if (!m) return getAgentHue(agent);
    const r = parseInt(m[1].slice(0,2),16)/255, g = parseInt(m[1].slice(2,4),16)/255, b = parseInt(m[1].slice(4,6),16)/255;
    const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
    if (d === 0) return 0;
    let h = 0;
    if (max === r) h = (g-b)/d + (g<b?6:0);
    else if (max === g) h = (b-r)/d + 2;
    else h = (r-g)/d + 4;
    return Math.round(h*60);
  })() : getAgentHue(agent);

  return (
    <div className="portfolio-header" style={{ '--agent-hue': liveHue } as React.CSSProperties}>
      {isEditing ? (
        <div
          className="portfolio-header-avatar-edit"
          onClick={() => !uploading && fileInputRef.current?.click()}
          title="Click to upload a new avatar"
        >
          <Avatar agent={agent} size="large" />
          <div className="portfolio-header-avatar-overlay">
            {uploading
              ? <i className="codicon codicon-loading codicon-modifier-spin" />
              : <i className="codicon codicon-cloud-upload" />}
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" hidden onChange={handleFileChange} />
        </div>
      ) : (
        <Avatar agent={agent} size="large" />
      )}

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
            <label className="portfolio-color-field" title="Agent color">
              <input
                type="color"
                value={draftColor}
                onChange={(e) => setDraftColor(e.target.value)}
                className="portfolio-color-picker"
                aria-label="Agent color"
              />
              <span className="portfolio-color-label">Color</span>
            </label>
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
            <button className="btn-save" onClick={save} disabled={saving || uploading}>
              <i className="codicon codicon-check" /> {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn-header-action" onClick={cancel} disabled={saving || uploading}>
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

