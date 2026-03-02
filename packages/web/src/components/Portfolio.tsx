import { useEffect, useState, KeyboardEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTeam } from '../context/TeamContext';
import { Agent, AgentPersonality } from '../types';
import { Avatar } from './Avatar';
import { RelativeTime } from './RelativeTime';
import './Portfolio.css';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip the leading ![avatar](...) line that agent .md files use as an image hack */
function stripAvatarLine(markdown: string | undefined): string {
  if (!markdown) return '';
  return markdown.replace(/^!\[avatar\]\([^)]+\)\s*\n?/m, '').trimStart();
}

const TYPE_LABELS: Record<string, string> = {
  executive: 'Executive',
  leadership: 'Leadership',
  'team-lead': 'Team Lead',
  'individual-contributor': 'Individual Contributor',
  'quality-gate': 'Quality Gate',
  'cross-concern': 'Cross-Concern',
  product: 'Product',
};

const CONTEXT_LABELS: Record<string, string> = {
  task: 'Task',
  module: 'Module',
  feature: 'Feature',
  repository: 'Repository',
  organization: 'Organization',
};

const STYLE_ICONS: Record<string, string> = {
  collaborative: '🤝',
  analytical: '📊',
  direct: '🎯',
  supportive: '🌿',
  strategic: '🚀',
};

const LEVEL_CHIP: Record<string, string> = {
  executive: 'chip-executive',
  senior: 'chip-senior',
  'mid-level': 'chip-mid',
  junior: 'chip-junior',
};

// ─── Tag Input ───────────────────────────────────────────────────────────────

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

function TagInput({ tags, onChange, placeholder = 'Add…' }: TagInputProps) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const val = input.trim();
    if (val && !tags.includes(val)) onChange([...tags, val]);
    setInput('');
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); addTag(); }
    if (e.key === 'Backspace' && !input && tags.length) onChange(tags.slice(0, -1));
  };

  return (
    <div className="tag-input-container">
      {tags.map((t) => (
        <span key={t} className="tag-input-chip">
          {t}
          <button type="button" className="tag-input-remove"
            onClick={() => onChange(tags.filter((x) => x !== t))} aria-label={`Remove ${t}`}>×</button>
        </span>
      ))}
      <input
        className="tag-input"
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKey}
        onBlur={addTag}
        placeholder={placeholder}
      />
    </div>
  );
}

// ─── Markdown Editor (write / preview tabs) ──────────────────────────────────

function MarkdownEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [tab, setTab] = useState<'write' | 'preview'>('write');
  return (
    <div className="md-editor">
      <div className="md-editor-tabs">
        <button type="button" className={`md-tab ${tab === 'write' ? 'md-tab-active' : ''}`} onClick={() => setTab('write')}>Write</button>
        <button type="button" className={`md-tab ${tab === 'preview' ? 'md-tab-active' : ''}`} onClick={() => setTab('preview')}>Preview</button>
      </div>
      {tab === 'write' ? (
        <textarea className="md-editor-textarea" value={value} onChange={(e) => onChange(e.target.value)} placeholder="Write agent bio in Markdown…" spellCheck />
      ) : (
        <div className="md-editor-preview">
          {value ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{value}</ReactMarkdown> : <p className="text-muted">Nothing to preview.</p>}
        </div>
      )}
    </div>
  );
}

// ─── Section Card ─────────────────────────────────────────────────────────────

function SectionCard({ title, icon, children }: { title: string; icon?: string; children: React.ReactNode }) {
  return (
    <section className="portfolio-card">
      <h3 className="portfolio-card-title">
        {icon && <span className="portfolio-card-icon">{icon}</span>}
        {title}
      </h3>
      {children}
    </section>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export function Portfolio() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const { agents, loading, error, client, refresh } = useTeam();

  const agent = agents.find((a) => a.id === agentId);
  const directReports = agents.filter((a) => a.reportsTo === agentId);
  const manager = agents.find((a) => a.id === agent?.reportsTo);

  // ── Edit state ──
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState<Partial<Agent>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !agent && agentId) navigate('/not-found', { replace: true });
  }, [agent, agentId, loading, navigate]);

  useEffect(() => {
    setIsEditing(false);
    setDraft({});
    setSaveError(null);
  }, [agentId]);

  if (loading) return <div className="portfolio-loading"><i className="codicon codicon-loading codicon-modifier-spin" /> Loading portfolio…</div>;
  if (error) return <div className="portfolio-error">Error: {error.message}</div>;
  if (!agentId || !agent) return null;

  const bio = stripAvatarLine(agent.markdown);

  // ── Edit helpers ──
  const startEdit = () => { setDraft({ ...agent }); setSaveError(null); setIsEditing(true); };
  const cancelEdit = () => { setDraft({}); setSaveError(null); setIsEditing(false); };

  const saveEdit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const { markdown: draftMarkdown, id: _id, filePath: _fp, skillPath: _sp, createdAt: _ca,
        lastInteraction: _li, conversationCount: _cc, status: _st, ...editableFields } = draft as any;
      await client.updateAgentFrontmatter(agent.id, editableFields);
      if (draftMarkdown !== undefined && draftMarkdown !== agent.markdown) {
        await client.updateAgentMarkdown(agent.id, draftMarkdown);
      }
      await refresh();
      setIsEditing(false);
      setDraft({});
    } catch (e: any) {
      setSaveError(e?.message || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const patchDraft = (fields: Partial<Agent>) => setDraft((d) => ({ ...d, ...fields }));
  const patchPersonality = (fields: Partial<AgentPersonality>) =>
    setDraft((d) => ({ ...d, personality: { ...d.personality, ...fields } }));

  // In edit mode, draft overrides agent for display
  const v: Agent = isEditing ? { ...agent, ...draft } : agent;

  return (
    <div className={`portfolio ${isEditing ? 'portfolio-edit-mode' : ''}`}>

      {/* ── Header ── */}
      <div className="portfolio-header">
        <Avatar agent={v} size="large" />
        <div className="portfolio-header-info">
          {isEditing ? (
            <>
              <input placeholder="Name" className="portfolio-name-input" value={draft.name ?? agent.name}
                onChange={(e) => patchDraft({ name: e.target.value })} />
              <input placeholder="Role" className="portfolio-role-input" value={draft.role ?? agent.role}
                onChange={(e) => patchDraft({ role: e.target.value })} />
            </>
          ) : (
            <>
              <h2>{v.name}</h2>
              <span className="portfolio-header-role">{v.role}</span>
            </>
          )}
          <div className="portfolio-meta-chips">
            {v.type && <span className="portfolio-chip chip-type">{TYPE_LABELS[v.type] ?? v.type}</span>}
            {v.contextLevel && <span className="portfolio-chip chip-context">{CONTEXT_LABELS[v.contextLevel] ?? v.contextLevel}</span>}
            <span className={`status-badge status-${v.status ?? 'available'}`}>{(v.status ?? 'available').replace('-', ' ')}</span>
          </div>
        </div>
        <div className="portfolio-header-actions">
          {isEditing ? (
            <>
              <button className="btn-save" onClick={saveEdit} disabled={saving}>
                <i className="codicon codicon-check" /> {saving ? 'Saving…' : 'Save'}
              </button>
              <button className="btn-header-action" onClick={cancelEdit} disabled={saving}>
                <i className="codicon codicon-close" /> Cancel
              </button>
            </>
          ) : (
            <>
              <button onClick={() => navigate(`/chat/${agent.id}`)} className="btn-header-action">
                <i className="codicon codicon-comment-discussion" /> Chat
              </button>
              <button onClick={startEdit} className="btn-header-action">
                <i className="codicon codicon-edit" /> Edit
              </button>
              <button onClick={() => navigate('/employees')} className="btn-header-action">
                <i className="codicon codicon-arrow-left" /> Back
              </button>
            </>
          )}
        </div>
      </div>

      {saveError && (
        <div className="portfolio-save-error">
          <i className="codicon codicon-error" /> {saveError}
        </div>
      )}

      <div className="portfolio-content">

        {/* ── Identity (edit only) ── */}
        {isEditing && (
          <SectionCard title="Identity" icon="🪪">
            <div className="portfolio-form-grid">
              <label><span>Type</span>
                <select value={draft.type ?? agent.type ?? ''}
                  onChange={(e) => patchDraft({ type: (e.target.value as Agent['type']) || undefined })}>
                  <option value="">— none —</option>
                  {Object.entries(TYPE_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                </select>
              </label>
              <label><span>Context Level</span>
                <select value={draft.contextLevel ?? agent.contextLevel ?? ''}
                  onChange={(e) => patchDraft({ contextLevel: (e.target.value as Agent['contextLevel']) || undefined })}>
                  <option value="">— none —</option>
                  {Object.entries(CONTEXT_LABELS).map(([k, lbl]) => <option key={k} value={k}>{lbl}</option>)}
                </select>
              </label>
              <label><span>Pronouns</span>
                <input value={draft.pronouns ?? agent.pronouns ?? ''}
                  onChange={(e) => patchDraft({ pronouns: e.target.value || undefined })} placeholder="they/them" />
              </label>
              <label><span>Timezone</span>
                <input value={draft.timezone ?? agent.timezone ?? ''}
                  onChange={(e) => patchDraft({ timezone: e.target.value || undefined })} placeholder="Europe/Berlin" />
              </label>
            </div>
          </SectionCard>
        )}

        {/* ── About / Bio ── */}
        <SectionCard title="About" icon="📝">
          {isEditing ? (
            <MarkdownEditor
              value={draft.markdown !== undefined ? stripAvatarLine(draft.markdown) : bio}
              onChange={(val) => patchDraft({ markdown: val })}
            />
          ) : bio ? (
            <div className="portfolio-bio">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{bio}</ReactMarkdown>
            </div>
          ) : (
            <p className="text-muted">No bio written yet.</p>
          )}
        </SectionCard>

        {/* ── Personality ── */}
        {(v.personality || isEditing) && (
          <SectionCard title="Personality" icon="🧠">
            {isEditing ? (
              <div className="portfolio-form-grid">
                <label><span>Communication Style</span>
                  <select value={draft.personality?.communication_style ?? agent.personality?.communication_style ?? ''}
                    onChange={(e) => patchPersonality({ communication_style: (e.target.value as AgentPersonality['communication_style']) || undefined })}>
                    <option value="">— none —</option>
                    {(['collaborative', 'direct', 'supportive', 'analytical', 'strategic'] as const).map((s) => (
                      <option key={s} value={s}>{STYLE_ICONS[s]} {s.charAt(0).toUpperCase() + s.slice(1)}</option>
                    ))}
                  </select>
                </label>
                <label><span>Expertise Level</span>
                  <select value={draft.personality?.expertise_level ?? agent.personality?.expertise_level ?? ''}
                    onChange={(e) => patchPersonality({ expertise_level: (e.target.value as AgentPersonality['expertise_level']) || undefined })}>
                    <option value="">— none —</option>
                    {(['executive', 'senior', 'mid-level', 'junior'] as const).map((l) => (
                      <option key={l} value={l}>{l.charAt(0).toUpperCase() + l.slice(1)}</option>
                    ))}
                  </select>
                </label>
                <label className="portfolio-checkbox-label">
                  <input type="checkbox"
                    checked={draft.personality?.mentoring ?? agent.personality?.mentoring ?? false}
                    onChange={(e) => patchPersonality({ mentoring: e.target.checked })} />
                  <span>Available for mentoring</span>
                </label>
              </div>
            ) : (
              <div className="personality-grid">
                {v.personality?.communication_style && (
                  <div className="personality-item">
                    <span className="personality-icon">{STYLE_ICONS[v.personality.communication_style]}</span>
                    <div>
                      <div className="personality-label">Communication style</div>
                      <div className="personality-value">{v.personality.communication_style}</div>
                    </div>
                  </div>
                )}
                {v.personality?.expertise_level && (
                  <div className="personality-item">
                    <span className={`portfolio-chip ${LEVEL_CHIP[v.personality.expertise_level] ?? ''}`}>
                      {v.personality.expertise_level}
                    </span>
                    <div>
                      <div className="personality-label">Expertise level</div>
                      <div className="personality-value">{v.personality.expertise_level}</div>
                    </div>
                  </div>
                )}
                {v.personality?.mentoring !== undefined && (
                  <div className="personality-item">
                    <span className="personality-icon">{v.personality.mentoring ? '✅' : '—'}</span>
                    <div>
                      <div className="personality-label">Mentoring</div>
                      <div className="personality-value">{v.personality.mentoring ? 'Available' : 'Not available'}</div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Hierarchy ── */}
        <SectionCard title="Hierarchy" icon="🏢">
          {isEditing ? (
            <label className="portfolio-form-label-full"><span>Reports To</span>
              <select value={draft.reportsTo ?? agent.reportsTo ?? ''}
                onChange={(e) => patchDraft({ reportsTo: e.target.value || undefined })}>
                <option value="">— none (top level) —</option>
                {agents.filter((a) => a.id !== agent.id)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
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
              {directReports.length > 0 && (
                <div className="hierarchy-row">
                  <span className="hierarchy-label">Direct reports</span>
                  <div className="direct-reports-list">
                    {directReports.map((r) => (
                      <Link key={r.id} to={`/portfolio/${r.id}`} className="hierarchy-agent-link">
                        <Avatar agent={r} size="small" />
                        <span>{r.name}</span>
                        <span className="hierarchy-role">{r.role}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </SectionCard>

        {/* ── Skills & Features ── */}
        {((v.specializations?.length ?? 0) > 0 || (v.features?.length ?? 0) > 0 || isEditing) && (
          <SectionCard title="Skills & Features" icon="⚡">
            {isEditing ? (
              <div className="portfolio-form-stack">
                <label><span>Specializations</span>
                  <TagInput tags={draft.specializations ?? agent.specializations ?? []}
                    onChange={(tags) => patchDraft({ specializations: tags })} placeholder="Add specialization…" />
                </label>
                <label><span>Features</span>
                  <TagInput tags={draft.features ?? agent.features ?? []}
                    onChange={(tags) => patchDraft({ features: tags })} placeholder="Add feature…" />
                </label>
              </div>
            ) : (
              <div className="skill-tags-group">
                {v.specializations?.map((s) => <span key={s} className="skill-tag">{s}</span>)}
                {v.features?.map((f) => <span key={f} className="skill-tag skill-tag-feature">{f}</span>)}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Tools ── */}
        {((v.tools?.length ?? 0) > 0 || isEditing) && (
          <SectionCard title="Tools" icon="🔧">
            {isEditing ? (
              <TagInput tags={draft.tools ?? agent.tools ?? []}
                onChange={(tags) => patchDraft({ tools: tags })} placeholder="Add tool…" />
            ) : (
              <div className="tool-tags">
                {v.tools?.map((t) => <span key={t} className="tool-tag">{t}</span>)}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── LLM Config (view only) ── */}
        {!isEditing && v.llm && (v.llm.provider || v.llm.model || v.llm.modelKey) && (
          <SectionCard title="LLM Configuration" icon="🤖">
            <div className="llm-row">
              {v.llm.provider && <span className="llm-item"><span className="llm-label">Provider</span>{v.llm.provider}</span>}
              {(v.llm.model || v.llm.modelKey) && <span className="llm-item"><span className="llm-label">Model</span>{v.llm.model ?? v.llm.modelKey}</span>}
            </div>
          </SectionCard>
        )}

        {/* ── Activity (view only) ── */}
        {!isEditing && (v.conversationCount !== undefined || v.lastInteraction || v.createdAt) && (
          <SectionCard title="Activity" icon="📊">
            <div className="activity-row">
              {v.conversationCount !== undefined && (
                <div className="activity-item">
                  <span className="activity-value">{v.conversationCount}</span>
                  <span className="activity-label">Conversations</span>
                </div>
              )}
              {v.lastInteraction && (
                <div className="activity-item">
                  <RelativeTime timestamp={v.lastInteraction} className="activity-value" />
                  <span className="activity-label">Last interaction</span>
                </div>
              )}
              {v.createdAt && (
                <div className="activity-item">
                  <RelativeTime timestamp={v.createdAt} className="activity-value" />
                  <span className="activity-label">Created</span>
                </div>
              )}
            </div>
          </SectionCard>
        )}

      </div>
    </div>
  );
}
