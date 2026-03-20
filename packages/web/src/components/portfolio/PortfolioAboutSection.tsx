import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MarkdownEditor, PortfolioSectionCard, stripAvatarLine } from './portfolioShared';

interface PortfolioAboutSectionProps {
  markdown?: string;
  onSave: (markdown: string) => Promise<void>;
}

export function PortfolioAboutSection({ markdown, onSave }: Readonly<PortfolioAboutSectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEdit = () => { setDraft(stripAvatarLine(markdown)); setSaveError(null); setIsEditing(true); };
  const cancel = () => { setIsEditing(false); setSaveError(null); };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const bio = isEditing ? draft : stripAvatarLine(markdown);

  return (
    <PortfolioSectionCard title="About" icon="📝" onEdit={startEdit} isEditing={isEditing} saving={saving} onSave={save} onCancel={cancel}>
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {(() => {
        if (isEditing) return <MarkdownEditor value={draft} onChange={setDraft} />;
        if (bio) return <div className="portfolio-bio"><ReactMarkdown remarkPlugins={[remarkGfm]}>{bio}</ReactMarkdown></div>;
        return <p className="text-muted">No bio written yet.</p>;
      })()}
    </PortfolioSectionCard>
  );
}
