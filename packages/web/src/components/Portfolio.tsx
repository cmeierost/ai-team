import { useEffect, useState, KeyboardEvent } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useTeam } from '../context/TeamContext';
import { Agent, AgentPersonality, AgentSkill, AgentCapabilities } from '../types';
import { Avatar } from './Avatar';
import { RelativeTime } from './RelativeTime';
import { FileTree } from './FileTree';
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

// ─── Skill Editor ────────────────────────────────────────────────────────────

interface SkillEditorProps {
  skills: AgentSkill[];
  onChange: (skills: AgentSkill[]) => void;
}

function SkillEditor({ skills, onChange }: SkillEditorProps) {
  const addSkill = () => {
    const id = `skill-${Date.now()}`;
    onChange([...skills, { id, name: '' }]);
  };
  const removeSkill = (idx: number) => onChange(skills.filter((_, i) => i !== idx));
  const patchSkill = (idx: number, patch: Partial<AgentSkill>) =>
    onChange(skills.map((s, i) => (i === idx ? { ...s, ...patch } : s)));

  return (
    <div className="skill-editor">
      {skills.map((sk, idx) => (
        <div key={sk.id} className="skill-editor-item">
          <div className="skill-editor-row">
            <input className="skill-editor-name" placeholder="Skill name"
              value={sk.name} onChange={(e) => patchSkill(idx, { name: e.target.value })} />
            <button type="button" className="skill-editor-remove"
              onClick={() => removeSkill(idx)} aria-label="Remove skill">×</button>
          </div>
          <textarea className="skill-editor-desc" placeholder="Description (optional)"
            value={sk.description ?? ''} rows={2}
            onChange={(e) => patchSkill(idx, { description: e.target.value || undefined })} />
          <div className="skill-editor-label">Tags</div>
          <TagInput tags={sk.tags ?? []} onChange={(t) => patchSkill(idx, { tags: t })} placeholder="Add tag…" />
        </div>
      ))}
      <button type="button" className="skill-editor-add" onClick={addSkill}>+ Add skill</button>
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
  const [toolEntries, setToolEntries] = useState<Array<{ name: string; description: string; allowedForAgent?: boolean }>>([]);
  const [toolsLoading, setToolsLoading] = useState(false);
  const [toolActionPending, setToolActionPending] = useState<string | null>(null);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [skillEntries, setSkillEntries] = useState<Array<{ name: string; description: string; assignedToAgent?: boolean }>>([]);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skillActionPending, setSkillActionPending] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

  const loadTools = async (targetAgentId: string) => {
    setToolsLoading(true);
    setToolsError(null);
    try {
      const response = await client.listTools({ agent: targetAgentId });
      setToolEntries(
        response.entries
          .map((entry) => ({
            name: entry.name,
            description: entry.description,
            allowedForAgent: entry.allowedForAgent,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e: any) {
      setToolsError(e?.message || 'Failed to load tools');
      setToolEntries([]);
    } finally {
      setToolsLoading(false);
    }
  };

  const loadSkills = async (targetAgentId: string) => {
    setSkillsLoading(true);
    setSkillsError(null);
    try {
      const response = await client.searchSkills({ agent: targetAgentId });
      setSkillEntries(
        response.entries
          .map((entry) => ({
            name: entry.name,
            description: entry.description,
            assignedToAgent: entry.assignedToAgent,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      );
    } catch (e: any) {
      setSkillsError(e?.message || 'Failed to load skills');
      setSkillEntries([]);
    } finally {
      setSkillsLoading(false);
    }
  };

  useEffect(() => {
    if (!loading && !agent && agentId) navigate('/not-found', { replace: true });
  }, [agent, agentId, loading, navigate]);

  useEffect(() => {
    setIsEditing(false);
    setDraft({});
    setSaveError(null);
  }, [agentId]);

  useEffect(() => {
    if (!agentId) return;
    void loadTools(agentId);
    void loadSkills(agentId);
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
        lastInteraction: _li, conversationCount: _cc, status: _st, tools: _tools, ...editableFields } = draft as any;
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
  const patchCapabilities = (fields: Partial<AgentCapabilities>) =>
    setDraft((d) => ({ ...d, capabilities: { ...d.capabilities, ...fields } }));

  const handleToggleTool = async (toolName: string, currentlyAllowed: boolean) => {
    if (!agentId || toolActionPending) return;
    setToolActionPending(toolName);
    setToolsError(null);
    try {
      if (currentlyAllowed) {
        await client.disallowTool({ agent: agentId, tool: toolName });
      } else {
        await client.allowTool({ agent: agentId, tool: toolName });
      }
      await Promise.all([refresh(), loadTools(agentId)]);
    } catch (e: any) {
      setToolsError(e?.message || `Failed to ${currentlyAllowed ? 'disallow' : 'allow'} tool`);
    } finally {
      setToolActionPending(null);
    }
  };

  const handleToggleSkill = async (skillName: string, currentlyAssigned: boolean) => {
    if (!agentId || skillActionPending) return;
    setSkillActionPending(skillName);
    setSkillsError(null);
    try {
      if (currentlyAssigned) {
        await client.removeSkill({ agent: agentId, skill: skillName });
      } else {
        await client.addSkill({ agent: agentId, skill: skillName });
      }
      await Promise.all([refresh(), loadSkills(agentId)]);
    } catch (e: any) {
      setSkillsError(e?.message || `Failed to ${currentlyAssigned ? 'remove' : 'add'} skill`);
    } finally {
      setSkillActionPending(null);
    }
  };

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

        {/* ── Goal & Backstory ── */}
        {(v.goal || v.backstory || isEditing) && (
          <SectionCard title="Goal & Backstory" icon="🎯">
            {isEditing ? (
              <div className="portfolio-form-stack">
                <label><span>Goal</span>
                  <textarea className="portfolio-textarea" rows={2}
                    placeholder="What this agent is trying to achieve…"
                    value={draft.goal ?? agent.goal ?? ''}
                    onChange={(e) => patchDraft({ goal: e.target.value || undefined })} />
                </label>
                <label><span>Backstory</span>
                  <textarea className="portfolio-textarea" rows={3}
                    placeholder="Background, context, and persona…"
                    value={draft.backstory ?? agent.backstory ?? ''}
                    onChange={(e) => patchDraft({ backstory: e.target.value || undefined })} />
                </label>
              </div>
            ) : (
              <div className="goal-backstory-grid">
                {v.goal && (
                  <div className="goal-backstory-item">
                    <div className="goal-backstory-label">Goal</div>
                    <p className="goal-backstory-text">{v.goal}</p>
                  </div>
                )}
                {v.backstory && (
                  <div className="goal-backstory-item">
                    <div className="goal-backstory-label">Backstory</div>
                    <p className="goal-backstory-text">{v.backstory}</p>
                  </div>
                )}
              </div>
            )}
          </SectionCard>
        )}

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

        {/* ── Agent Skills (structured A2A) ── */}
        {((v.skills?.length ?? 0) > 0 || isEditing) && (
          <SectionCard title="Agent Skills" icon="🧩">
            {isEditing ? (
              <SkillEditor
                skills={draft.skills ?? agent.skills ?? []}
                onChange={(skills) => patchDraft({ skills })}
              />
            ) : (
              <div className="agent-skills-list">
                {(v.skills ?? []).map((sk) => (
                  <div key={sk.id} className="agent-skill-card">
                    <div className="agent-skill-header">
                      <span className="agent-skill-name">{sk.name}</span>
                      {sk.tags?.map((t) => <span key={t} className="skill-tag skill-tag-sm">{t}</span>)}
                    </div>
                    {sk.description && <p className="agent-skill-desc">{sk.description}</p>}
                    {sk.examples && sk.examples.length > 0 && (
                      <ul className="agent-skill-examples">
                        {sk.examples.map((ex, i) => <li key={i}>{ex}</li>)}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Skill Assignments (catalog) ── */}
        <SectionCard title="Skill Assignments" icon="🎓">
          {skillsError && (
            <div className="tool-permissions-error">
              <i className="codicon codicon-error" /> {skillsError}
            </div>
          )}

          {skillsLoading ? (
            <p className="text-muted">Loading skills…</p>
          ) : skillEntries.length === 0 ? (
            <p className="text-muted">No skills found.</p>
          ) : (
            <div className="tool-permissions-list">
              {skillEntries.map((entry) => {
                const assigned = entry.assignedToAgent === true;
                const pending = skillActionPending === entry.name;
                return (
                  <div key={entry.name} className="tool-permission-item">
                    <div className="tool-permission-main">
                      <div className="tool-permission-name-row">
                        <span className="tool-tag">{entry.name}</span>
                        <span className={`tool-permission-state ${assigned ? 'allowed' : 'disallowed'}`}>
                          {assigned ? 'Assigned' : 'Unassigned'}
                        </span>
                      </div>
                      {entry.description ? (
                        <p className="tool-permission-description">{entry.description}</p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className={`tool-permission-toggle ${assigned ? 'is-disallow' : 'is-allow'}`}
                      onClick={() => handleToggleSkill(entry.name, assigned)}
                      disabled={pending || !!skillActionPending}
                    >
                      {pending ? 'Updating…' : assigned ? 'Remove' : 'Assign'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Agent Capabilities (A2A) ── */}
        {(v.capabilities || isEditing) && (
          <SectionCard title="Agent Capabilities" icon="⚙️">
            {isEditing ? (
              <div className="portfolio-form-grid">
                <label className="portfolio-checkbox-label">
                  <input type="checkbox"
                    checked={draft.capabilities?.streaming ?? agent.capabilities?.streaming ?? false}
                    onChange={(e) => patchCapabilities({ streaming: e.target.checked })} />
                  <span>Streaming</span>
                </label>
                <label className="portfolio-checkbox-label">
                  <input type="checkbox"
                    checked={draft.capabilities?.multimodal ?? agent.capabilities?.multimodal ?? false}
                    onChange={(e) => patchCapabilities({ multimodal: e.target.checked })} />
                  <span>Multimodal</span>
                </label>
                <label className="portfolio-checkbox-label">
                  <input type="checkbox"
                    checked={draft.capabilities?.codeExecution ?? agent.capabilities?.codeExecution ?? false}
                    onChange={(e) => patchCapabilities({ codeExecution: e.target.checked })} />
                  <span>Code Execution</span>
                </label>
                <label className="portfolio-checkbox-label">
                  <input type="checkbox"
                    checked={draft.capabilities?.reasoning ?? agent.capabilities?.reasoning ?? false}
                    onChange={(e) => patchCapabilities({ reasoning: e.target.checked })} />
                  <span>Reasoning</span>
                </label>
              </div>
            ) : (
              <div className="capabilities-grid">
                <div className="capability-item">
                  <span className={`capability-icon ${v.capabilities?.streaming ? 'capability-enabled' : ''}`}>
                    {v.capabilities?.streaming ? '✓' : '—'}
                  </span>
                  <span>Streaming</span>
                </div>
                <div className="capability-item">
                  <span className={`capability-icon ${v.capabilities?.multimodal ? 'capability-enabled' : ''}`}>
                    {v.capabilities?.multimodal ? '✓' : '—'}
                  </span>
                  <span>Multimodal</span>
                </div>
                <div className="capability-item">
                  <span className={`capability-icon ${v.capabilities?.codeExecution ? 'capability-enabled' : ''}`}>
                    {v.capabilities?.codeExecution ? '✓' : '—'}
                  </span>
                  <span>Code Execution</span>
                </div>
                <div className="capability-item">
                  <span className={`capability-icon ${v.capabilities?.reasoning ? 'capability-enabled' : ''}`}>
                    {v.capabilities?.reasoning ? '✓' : '—'}
                  </span>
                  <span>Reasoning</span>
                </div>
              </div>
            )}
          </SectionCard>
        )}

        {/* ── Tools / Command Permissions ── */}
        <SectionCard title="Tools & Command Permissions" icon="🔧">
          {toolsError && (
            <div className="tool-permissions-error">
              <i className="codicon codicon-error" /> {toolsError}
            </div>
          )}

          {toolsLoading ? (
            <p className="text-muted">Loading tool catalog…</p>
          ) : toolEntries.length === 0 ? (
            <p className="text-muted">No tools found.</p>
          ) : (
            <div className="tool-permissions-list">
              {toolEntries.map((tool) => {
                const allowed = tool.allowedForAgent === true;
                const pending = toolActionPending === tool.name;
                return (
                  <div key={tool.name} className="tool-permission-item">
                    <div className="tool-permission-main">
                      <div className="tool-permission-name-row">
                        <span className="tool-tag">{tool.name}</span>
                        <span className={`tool-permission-state ${allowed ? 'allowed' : 'disallowed'}`}>
                          {allowed ? 'Allowed' : 'Disallowed'}
                        </span>
                      </div>
                      <p className="tool-permission-description">{tool.description}</p>
                    </div>
                    <button
                      type="button"
                      className={`tool-permission-toggle ${allowed ? 'is-disallow' : 'is-allow'}`}
                      onClick={() => handleToggleTool(tool.name, allowed)}
                      disabled={pending || !!toolActionPending}
                    >
                      {pending ? 'Updating…' : allowed ? 'Disallow' : 'Allow'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* ── Capabilities ── */}
        {(v.capabilities || isEditing) && (
          <SectionCard title="Capabilities" icon="⚙️">
            {isEditing ? (
              <div className="portfolio-capabilities-grid">
                {(['streaming', 'multimodal', 'codeExecution', 'reasoning'] as const).map((cap) => (
                  <label key={cap} className="portfolio-checkbox-label">
                    <input type="checkbox"
                      checked={!!(draft.capabilities?.[cap] ?? agent.capabilities?.[cap])}
                      onChange={(e) => patchCapabilities({ [cap]: e.target.checked || undefined })} />
                    <span>{cap.charAt(0).toUpperCase() + cap.replace(/([A-Z])/g, ' $1').slice(1)}</span>
                  </label>
                ))}
              </div>
            ) : (
              <div className="capabilities-grid">
                {v.capabilities?.streaming && <span className="capability-chip">Streaming</span>}
                {v.capabilities?.multimodal && <span className="capability-chip">Multimodal</span>}
                {v.capabilities?.codeExecution && <span className="capability-chip">Code Execution</span>}
                {v.capabilities?.reasoning && <span className="capability-chip">Reasoning</span>}
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

        {/* ── File Access ── */}
        <SectionCard title="File Access" icon="📂">
          <FileTree agentId={agent.id} editMode={isEditing} />
        </SectionCard>

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
