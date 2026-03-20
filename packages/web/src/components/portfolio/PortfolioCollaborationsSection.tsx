import { useState } from 'react';
import type { Agent, CollaborationEntry } from '../../types';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioCollaborationsSectionProps {
  collaborations: CollaborationEntry[];
  allAgents: Agent[];
  onSave: (collaborations: CollaborationEntry[]) => Promise<void>;
}

export function PortfolioCollaborationsSection({
  collaborations,
  allAgents,
  onSave,
}: Readonly<PortfolioCollaborationsSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<CollaborationEntry[]>([]);
  const [addSearch, setAddSearch] = useState('');

  function startEdit() {
    setDraft(collaborations.map((c) => ({ ...c })));
    setAddSearch('');
    setIsEditing(true);
  }

  function cancel() {
    setIsEditing(false);
    setDraft([]);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave(draft);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  }

  function removeEntry(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function updateComment(index: number, comment: string) {
    setDraft((prev) =>
      prev.map((entry, i) => (i === index ? { ...entry, comment: comment || undefined } : entry))
    );
  }

  function addAgent(agentId: string) {
    if (!agentId || draft.some((d) => d.agentId === agentId)) return;
    setDraft((prev) => [...prev, { agentId }]);
    setAddSearch('');
  }

  const currentIds = new Set(draft.map((d) => d.agentId));

  const agentById = (id: string) => allAgents.find((a) => a.id === id);

  const filteredCandidates = allAgents.filter((a) => {
    if (currentIds.has(a.id)) return false;
    if (!addSearch.trim()) return true;
    const q = addSearch.toLowerCase();
    return a.name.toLowerCase().includes(q) || a.role.toLowerCase().includes(q);
  });

  return (
    <PortfolioSectionCard
      title="Key Collaborations"
      icon="🤝"
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {isEditing ? (
        <div className="collabs-edit">
          {draft.length === 0 && (
            <p className="empty-text collab-empty-edit">No collaborators yet.</p>
          )}

          {draft.map((entry, idx) => {
            const agent = agentById(entry.agentId);
            return (
              <div key={entry.agentId} className="collab-edit-row">
                <Avatar agent={agent ?? null} size="small" />
                <div className="collab-edit-info">
                  <span className="collab-edit-name">{agent?.name ?? entry.agentId}</span>
                  {agent?.role && <span className="collab-edit-role">{agent.role}</span>}
                  <textarea
                    className="collab-comment-input"
                    placeholder="Comment (optional)"
                    rows={2}
                    value={entry.comment ?? ''}
                    onChange={(e) => updateComment(idx, e.target.value)}
                    aria-label={`Comment for ${agent?.name ?? entry.agentId}`}
                  />
                </div>
                <button
                  type="button"
                  className="collab-remove-btn"
                  onClick={() => removeEntry(idx)}
                  aria-label={`Remove ${agent?.name ?? entry.agentId}`}
                >
                  ×
                </button>
              </div>
            );
          })}

          <div className="collab-add-section">
            <input
              type="text"
              className="skill-input"
              placeholder="Search agents to add…"
              value={addSearch}
              onChange={(e) => setAddSearch(e.target.value)}
              aria-label="Search agents"
            />
            {addSearch.trim().length > 0 && (
              <div className="collab-candidate-list">
                {filteredCandidates.slice(0, 8).map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className="collab-candidate-row"
                    onClick={() => addAgent(a.id)}
                  >
                    <Avatar agent={a} size="small" />
                    <span className="collab-candidate-name">{a.name}</span>
                    {a.role && <span className="collab-candidate-role">{a.role}</span>}
                  </button>
                ))}
                {filteredCandidates.length === 0 && addSearch.trim() && (
                  <p className="empty-text collab-empty-search">No matches.</p>
                )}
              </div>
            )}
            {addSearch.trim().length === 0 ? (
              <p className="empty-text collab-empty-search">Start typing to search and add collaborators.</p>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="collabs-view">
          {collaborations.length === 0 ? (
            <p className="empty-text">No collaborations defined.</p>
          ) : (
            collaborations.map((entry) => {
              const agent = agentById(entry.agentId);
              return (
                <div key={entry.agentId} className="collab-view-row">
                  <Avatar agent={agent ?? null} size="small" />
                  <div className="collab-view-info">
                    <span className="collab-view-name">{agent?.name ?? entry.agentId}</span>
                    {agent?.role && <span className="collab-view-role">{agent.role}</span>}
                    {entry.comment && <p className="collab-view-comment">{entry.comment}</p>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
