import { useEffect, useState } from 'react';
import type { AiTeamHttpClient } from '@ai-team/api-contracts';
import type { AnnotatedFile } from '@ai-team/api-contracts';
import { PortfolioSectionCard } from './portfolioShared';

interface PortfolioReadFilesSectionProps {
  agentId: string;
  readTheseFilesFirst: string[];
  client: AiTeamHttpClient;
  onSave: (files: string[]) => Promise<void>;
}

export function PortfolioReadFilesSection({
  agentId,
  readTheseFilesFirst,
  client,
  onSave,
}: Readonly<PortfolioReadFilesSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [availableFiles, setAvailableFiles] = useState<AnnotatedFile[]>([]);
  const [fileSearch, setFileSearch] = useState('');
  const [filesLoaded, setFilesLoaded] = useState(false);

  function startEdit() {
    setDraft([...readTheseFilesFirst]);
    setNewPath('');
    setFileSearch('');
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

  useEffect(() => {
    if (!isEditing || filesLoaded) return;
    const load = async () => {
      try {
        const result = await client.agents.getFiles(agentId);
        setAvailableFiles(result.files);
      } finally {
        setFilesLoaded(true);
      }
    };
    void load();
  }, [isEditing, filesLoaded, agentId, client]);

  function moveUp(index: number) {
    if (index === 0) return;
    setDraft((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }

  function moveDown(index: number) {
    setDraft((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }

  function removeFile(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  function addPath(path: string) {
    const trimmed = path.trim();
    if (!trimmed || draft.includes(trimmed)) return;
    setDraft((prev) => [...prev, trimmed]);
    setNewPath('');
    setFileSearch('');
  }

  const currentSet = new Set(draft);
  const filteredSuggestions = availableFiles
    .filter((f) => {
      if (currentSet.has(f.path)) return false;
      if (!fileSearch.trim()) return false;
      return f.path.toLowerCase().includes(fileSearch.toLowerCase());
    })
    .slice(0, 10);

  return (
    <PortfolioSectionCard
      title="Read These Files First"
      icon="📂"
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {isEditing ? (
        <div className="read-files-edit">
          {draft.length === 0 && (
            <p className="empty-text collab-empty-edit">No priority files defined.</p>
          )}

          <ol className="read-files-list">
            {draft.map((path, idx) => (
              <li key={path} className="read-file-row">
                <span className="read-file-path">{path}</span>
                <span className="read-file-actions">
                  <button
                    type="button"
                    className="read-file-btn"
                    onClick={() => moveUp(idx)}
                    disabled={idx === 0}
                    aria-label="Move up"
                    title="Move up"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="read-file-btn"
                    onClick={() => moveDown(idx)}
                    disabled={idx === draft.length - 1}
                    aria-label="Move down"
                    title="Move down"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    className="read-file-btn read-file-btn-remove"
                    onClick={() => removeFile(idx)}
                    aria-label={`Remove ${path}`}
                    title="Remove"
                  >
                    ×
                  </button>
                </span>
              </li>
            ))}
          </ol>

          <div className="read-files-add">
            <div className="read-files-input-row">
              <input
                type="text"
                className="skill-input"
                placeholder="Type a file path or search…"
                value={fileSearch || newPath}
                onChange={(e) => {
                  const v = e.target.value;
                  setFileSearch(v);
                  setNewPath(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addPath(newPath);
                  }
                }}
                aria-label="Add file path"
              />
              <button
                type="button"
                className="btn-save"
                onClick={() => addPath(newPath)}
                disabled={!newPath.trim()}
              >
                Add
              </button>
            </div>

            {filteredSuggestions.length > 0 && (
              <ul className="read-files-suggestions">
                {filteredSuggestions.map((f) => (
                  <li key={f.path}>
                    <button
                      type="button"
                      className="read-files-suggestion-btn"
                      onClick={() => addPath(f.path)}
                    >
                      {f.path}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <div className="read-files-view">
          {readTheseFilesFirst.length === 0 ? (
            <p className="empty-text">No priority files defined.</p>
          ) : (
            <ol className="read-files-list read-files-list-view">
              {readTheseFilesFirst.map((path) => (
                <li key={path} className="read-file-view-item">
                  <code className="read-file-code">{path}</code>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
