import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AiTeamHttpClient } from '@ai-team/api-contracts';
import type { AgentPersonality } from '../../types';
import { LEVEL_CHIP, MarkdownEditor, PortfolioSectionCard, STYLE_ICONS } from './portfolioShared';

interface PortfolioPersonalitySectionProps {
  agentId: string;
  client: AiTeamHttpClient;
  personality?: AgentPersonality;
  onSave: (personality: AgentPersonality) => Promise<void>;
}

function PersonalityView({
  p,
  hasMentoringInfo,
}: Readonly<{ p: AgentPersonality; hasMentoringInfo: boolean }>) {
  return (
    <div className="personality-grid">
      {p.communication_style ? (
        <div className="personality-item">
          <span className="personality-icon">{STYLE_ICONS[p.communication_style]}</span>
          <div>
            <div className="personality-label">Communication style</div>
            <div className="personality-value">{p.communication_style}</div>
          </div>
        </div>
      ) : null}
      {p.expertise_level ? (
        <div className="personality-item">
          <span className={`portfolio-chip ${LEVEL_CHIP[p.expertise_level] ?? ''}`}>
            {p.expertise_level}
          </span>
          <div>
            <div className="personality-label">Expertise level</div>
            <div className="personality-value">{p.expertise_level}</div>
          </div>
        </div>
      ) : null}
      {hasMentoringInfo ? (
        <div className="personality-item">
          <span className="personality-icon">{p.mentoring ? '✅' : '—'}</span>
          <div>
            <div className="personality-label">Mentoring</div>
            <div className="personality-value">{p.mentoring ? 'Available' : 'Not available'}</div>
          </div>
        </div>
      ) : null}
      {!p.communication_style && !p.expertise_level && !hasMentoringInfo ? (
        <p className="text-muted">No personality set.</p>
      ) : null}
    </div>
  );
}

export function PortfolioPersonalitySection({
  agentId,
  client,
  personality,
  onSave,
}: Readonly<PortfolioPersonalitySectionProps>) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<AgentPersonality>({});
  const [profileMarkdown, setProfileMarkdown] = useState('');
  const [draftMarkdown, setDraftMarkdown] = useState('');
  const [bio, setBio] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Load "Personality Profile" section and bio on mount
  useEffect(() => {
    void client.agents
      .getSections(agentId)
      .then((sections) => {
        const section = sections.find((s) => s.heading === 'Personality Profile');
        setProfileMarkdown(section?.content ?? '');
      })
      .catch(() => {
        /* ignore */
      });
    void client.agents
      .getBio(agentId)
      .then((r) => setBio(r.bio))
      .catch(() => {
        /* ignore */
      });
  }, [agentId, client]);

  const startEdit = () => {
    setDraft({ ...personality });
    setDraftMarkdown(profileMarkdown);
    setBioDraft(bio ?? '');
    setSaveError(null);
    setIsEditing(true);
  };
  const cancel = () => {
    setIsEditing(false);
    setSaveError(null);
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      if (draftMarkdown !== profileMarkdown) {
        await client.agents.updateSection(agentId, 'Personality Profile', {
          content: draftMarkdown,
        });
        const freshSections = await client.agents.getSections(agentId);
        const section = freshSections.find((s) => s.heading === 'Personality Profile');
        setProfileMarkdown(section?.content ?? draftMarkdown);
      }
      if (bioDraft !== (bio ?? '')) {
        await client.agents.updateBio(agentId, { bio: bioDraft });
        const fresh = await client.agents.getBio(agentId);
        setBio(fresh.bio);
      }
      setIsEditing(false);
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const p = isEditing ? draft : (personality ?? {});
  const hasMentoringInfo = typeof p?.mentoring === 'boolean';

  return (
    <PortfolioSectionCard
      title="Personality"
      icon="🧠"
      onEdit={startEdit}
      isEditing={isEditing}
      saving={saving}
      onSave={save}
      onCancel={cancel}
    >
      {saveError ? <p className="portfolio-section-error">{saveError}</p> : null}
      {isEditing ? (
        <>
          <div className="personality-narrative-editor">
            <span className="personality-narrative-label">Bio</span>
            <MarkdownEditor value={bioDraft} onChange={setBioDraft} />
          </div>
          <div className="portfolio-form-grid">
            <label>
              <span>Communication Style</span>
              <select
                value={p?.communication_style ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    communication_style:
                      (e.target.value as AgentPersonality['communication_style']) || undefined,
                  }))
                }
              >
                <option value="">— none —</option>
                {(
                  ['collaborative', 'direct', 'supportive', 'analytical', 'strategic'] as const
                ).map((style) => (
                  <option key={style} value={style}>
                    {STYLE_ICONS[style]} {style.charAt(0).toUpperCase() + style.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Expertise Level</span>
              <select
                value={p?.expertise_level ?? ''}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    expertise_level:
                      (e.target.value as AgentPersonality['expertise_level']) || undefined,
                  }))
                }
              >
                <option value="">— none —</option>
                {(['executive', 'senior', 'mid-level', 'junior'] as const).map((level) => (
                  <option key={level} value={level}>
                    {level.charAt(0).toUpperCase() + level.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="portfolio-checkbox-label">
              <input
                type="checkbox"
                checked={p?.mentoring ?? false}
                onChange={(e) => setDraft((d) => ({ ...d, mentoring: e.target.checked }))}
              />
              <span>Available for mentoring</span>
            </label>
          </div>
        </>
      ) : (
        <>
          {bio ? (
            <div className="personality-narrative-view">
              <div className="portfolio-bio personality-narrative-content">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{bio}</ReactMarkdown>
              </div>
            </div>
          ) : null}
          <PersonalityView p={p} hasMentoringInfo={hasMentoringInfo} />
          {profileMarkdown ? (
            <div className="personality-narrative-view">
              <p className="personality-narrative-label">Personality profile</p>
              <div className="portfolio-bio personality-narrative-content">{profileMarkdown}</div>
            </div>
          ) : null}
        </>
      )}
    </PortfolioSectionCard>
  );
}
