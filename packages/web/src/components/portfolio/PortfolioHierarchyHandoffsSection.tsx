import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Agent, AgentHandoff } from '../../types';
import type { AiTeamHttpClient } from '@ai-team/api-client-http';
import { Avatar } from '../Avatar';
import { PortfolioSectionCard } from './portfolioShared';
import { getAgentColor } from '../../utils/color';

interface Props {
  agentId: string;
  manager?: Agent;
  directReports: Agent[];
  reportsTo?: string;
  selectableAgents: Agent[];
  handoffs: AgentHandoff[];
  allAgents: Agent[];
  client: AiTeamHttpClient;
  onSaveReportsTo: (reportsTo?: string) => Promise<void>;
  onSaveHandoffs: (handoffs: AgentHandoff[]) => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function handoffKey(h: AgentHandoff) {
  return `${h.agent}::${h.label}`;
}

function autoLabelFromAgent(agent: Agent | undefined): string {
  if (!agent) return '';
  if (agent.role) {
    return agent.role.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }
  return `Delegate to ${agent.name}`;
}

// ── Inline prompt textarea ────────────────────────────────────────────────────

interface PromptFieldProps {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onCommit: (value: string) => void;
}

function PromptField({ value, placeholder = 'No routing prompt — click to add', disabled, onCommit }: Readonly<PromptFieldProps>) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onCommit(draft);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setDraft(value); setEditing(false); }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commit();
  };

  return (
    <textarea
      ref={ref}
      className={`handoff-prompt-field${editing ? ' handoff-prompt-field--active' : ''}${!value && !editing ? ' handoff-prompt-field--empty' : ''}`}
      value={editing ? draft : value}
      placeholder={placeholder}
      disabled={disabled}
      readOnly={!editing}
      rows={1}
      onFocus={() => { setDraft(value); setEditing(true); }}
      onBlur={commit}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
    />
  );
}

// ── Generate button ───────────────────────────────────────────────────────────

interface GenerateBtnProps {
  loading: boolean;
  disabled: boolean;
  onClick: () => void;
}

function GenerateBtn({ loading, disabled, onClick }: Readonly<GenerateBtnProps>) {
  return (
    <button
      className="btn-generate-handoff"
      onClick={onClick}
      disabled={disabled}
      title="Generate routing prompt with AI"
    >
      {loading
        ? <i className="codicon codicon-loading codicon-modifier-spin" />
        : <i className="codicon codicon-sparkle" />}
    </button>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export function PortfolioHierarchyHandoffsSection({
  agentId,
  manager,
  directReports,
  reportsTo,
  selectableAgents,
  handoffs,
  allAgents,
  client,
  onSaveReportsTo,
  onSaveHandoffs,
}: Readonly<Props>) {
  const agentById = (id: string) => allAgents.find((a) => a.id === id);

  // ── Reports-to edit state ──────────────────────────────────────────────────
  const [isEditing, setIsEditing] = useState(false);
  const [draftReportsTo, setDraftReportsTo] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const startEditReportsTo = () => { setDraftReportsTo(reportsTo); setSaveError(null); setIsEditing(true); };
  const cancelReportsTo = () => { setIsEditing(false); setSaveError(null); };
  const saveReportsTo = async () => {
    setSaving(true); setSaveError(null);
    try { await onSaveReportsTo(draftReportsTo); setIsEditing(false); }
    catch (e: any) { setSaveError(e?.message || 'Save failed'); }
    finally { setSaving(false); }
  };

  // ── Prompt generation state ────────────────────────────────────────────────
  const [generating, setGenerating] = useState<string | null>(null);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const handleGenerate = async (targetAgentId: string, existingLabel?: string) => {
    setGenerating(targetAgentId);
    setGenerateError(null);
    try {
      const { prompt } = await client.generateHandoffPrompt(agentId, targetAgentId);
      const existing = handoffs.find((h) => h.agent === targetAgentId && h.label === existingLabel);
      let updated: AgentHandoff[];
      if (existing) {
        updated = handoffs.map((h) =>
          h.agent === targetAgentId && h.label === existingLabel ? { ...h, prompt } : h,
        );
      } else {
        const targetAgent = agentById(targetAgentId);
        updated = [
          ...handoffs,
          { agent: targetAgentId, label: `Delegate to ${targetAgent?.name ?? targetAgentId}`, prompt },
        ];
      }
      await onSaveHandoffs(updated);
    } catch (e: any) {
      setGenerateError(e?.message || 'Failed to generate prompt');
    } finally {
      setGenerating(null);
    }
  };

  // ── Inline prompt save ─────────────────────────────────────────────────────
  const handlePromptEdit = async (targetAgentId: string, label: string, newPrompt: string) => {
    const existing = handoffs.find((h) => h.agent === targetAgentId && h.label === label);
    let updated: AgentHandoff[];
    if (existing) {
      updated = handoffs.map((h) =>
        h.agent === targetAgentId && h.label === label ? { ...h, prompt: newPrompt || undefined } : h,
      );
    } else {
      updated = [...handoffs, { agent: targetAgentId, label, prompt: newPrompt || undefined }];
    }
    await onSaveHandoffs(updated);
  };

  // ── Add custom handoff ─────────────────────────────────────────────────────
  const [isAdding, setIsAdding] = useState(false);
  const [newAgentId, setNewAgentId] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addSaving, setAddSaving] = useState(false);

  const submitAdd = async () => {
    if (!newAgentId) { setAddError('Choose an agent.'); return; }
    const effectiveLabel = newLabel.trim() || autoLabelFromAgent(agentById(newAgentId));
    setAddSaving(true); setAddError(null);
    try {
      await onSaveHandoffs([...handoffs, { agent: newAgentId, label: effectiveLabel }]);
      setIsAdding(false); setNewAgentId(''); setNewLabel('');
    } catch (e: any) {
      setAddError(e?.message || 'Save failed');
    } finally {
      setAddSaving(false);
    }
  };

  // ── Partition handoffs ─────────────────────────────────────────────────────
  const directReportIds = new Set(directReports.map((r) => r.id));
  const directReportRows = directReports.map((report) => ({
    report,
    handoff: handoffs.find((h) => h.agent === report.id),
  }));
  const managerHandoff = reportsTo ? handoffs.find((h) => h.agent === reportsTo) : undefined;
  const otherHandoffs = handoffs.filter((h) => !directReportIds.has(h.agent) && h.agent !== reportsTo);

  // Agents that don't already have a handoff in "Other handoffs"
  const otherHandoffAgentIds = new Set(otherHandoffs.map((h) => h.agent));
  const addableAgents = selectableAgents.filter(
    (a) => a.id !== agentId && !directReportIds.has(a.id) && a.id !== reportsTo && !otherHandoffAgentIds.has(a.id),
  );

  return (
    <PortfolioSectionCard
      title="Hierarchy & Handoffs"
      icon="🏢"
      onEdit={startEditReportsTo}
      isEditing={isEditing}
      saving={saving}
      onSave={saveReportsTo}
      onCancel={cancelReportsTo}
    >
      {saveError && <p className="portfolio-section-error">{saveError}</p>}
      {generateError && <p className="portfolio-section-error">{generateError}</p>}

      {isEditing ? (
        <label className="portfolio-form-label-full">
          <span>Reports To</span>
          <select value={draftReportsTo ?? ''} onChange={(e) => setDraftReportsTo(e.target.value || undefined)}>
            <option value="">— none (top level) —</option>
            {selectableAgents
              .filter((a) => a.id !== agentId)
              .sort((l, r) => l.name.localeCompare(r.name))
              .map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
          </select>
        </label>
      ) : (
        <div className="hierarchy-handoffs-section">

          {/* ── Manager row ── */}
          <div className="hierarchy-row">
            <span className="hierarchy-label">Reports to</span>
            <div className="handoff-entry-col">
              {manager ? (
                <Link to={`/portfolio/${manager.id}`} className="hierarchy-agent-link">
                  <Avatar agent={manager} size="small" />
                  <span>{manager.name}</span>
                  <span className="hierarchy-role">{manager.role}</span>
                </Link>
              ) : (
                <span className="text-muted">top level</span>
              )}
              {manager && (
                <div className="handoff-prompt-row">
                  <PromptField
                    value={managerHandoff?.prompt ?? ''}
                    disabled={generating !== null}
                    onCommit={(v) => handlePromptEdit(manager.id, managerHandoff?.label ?? `[auto] Report to ${manager.name}`, v)}
                  />
                  <GenerateBtn
                    loading={generating === manager.id}
                    disabled={generating !== null}
                    onClick={() => handleGenerate(manager.id, managerHandoff?.label)}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Direct reports ── */}
          {directReportRows.length > 0 && (
            <div className="hierarchy-row hierarchy-row-reports">
              <span className="hierarchy-label">Direct reports</span>
              <div className="direct-reports-handoff-list">
                {directReportRows.map(({ report, handoff }) => (
                  <div key={report.id} className="handoff-report-row" style={{ borderLeft: `2px solid ${getAgentColor(report)}` }}>
                    <Link to={`/portfolio/${report.id}`} className="hierarchy-agent-link">
                      <Avatar agent={report} size="small" />
                      <span>{report.name}</span>
                      <span className="hierarchy-role">{report.role}</span>
                    </Link>
                    <div className="handoff-prompt-row">
                      <PromptField
                        value={handoff?.prompt ?? ''}
                        disabled={generating !== null}
                        onCommit={(v) => handlePromptEdit(report.id, handoff?.label ?? `Delegate to ${report.name}`, v)}
                      />
                      <GenerateBtn
                        loading={generating === report.id}
                        disabled={generating !== null}
                        onClick={() => handleGenerate(report.id, handoff?.label)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Cross-hierarchy handoffs ── */}
          {(otherHandoffs.length > 0 || isAdding) && (
            <div className="hierarchy-row hierarchy-row-other-handoffs">
              <span className="hierarchy-label">Custom delegations</span>
              <div className="direct-reports-handoff-list">
                {otherHandoffs.map((entry) => {
                  const agent = agentById(entry.agent);
                  const agentColor = agent ? getAgentColor(agent) : 'var(--color-text-muted)';
                  return (
                    <div
                      key={handoffKey(entry)}
                      className="handoff-report-row handoff-report-row--custom"
                      style={{ borderLeftColor: agentColor }}
                    >
                      <div className="handoff-custom-header">
                        <Link to={`/portfolio/${entry.agent}`} className="hierarchy-agent-link">
                          <Avatar agent={agent ?? null} size="small" />
                          <span>{agent?.name ?? entry.agent}</span>
                          <span className="hierarchy-role">{agent?.role}</span>
                        </Link>
                        <span
                          className="handoff-custom-badge"
                          title="Custom delegation — not a direct report"
                          style={{ color: agentColor, background: `color-mix(in srgb, ${agentColor} 12%, transparent)`, borderColor: `color-mix(in srgb, ${agentColor} 35%, transparent)` }}
                        >↗ delegation</span>
                      </div>
                      <span className="collab-view-comment">{entry.label}</span>
                      <div className="handoff-prompt-row">
                        <PromptField
                          value={entry.prompt ?? ''}
                          disabled={generating !== null}
                          onCommit={(v) => handlePromptEdit(entry.agent, entry.label, v)}
                        />
                        <GenerateBtn
                          loading={generating === entry.agent}
                          disabled={generating !== null}
                          onClick={() => handleGenerate(entry.agent, entry.label)}
                        />
                      </div>
                    </div>
                  );
                })}

                {/* ── Add form ── */}
                {isAdding ? (
                  <div className="handoff-add-form">
                    {addError && <p className="portfolio-section-error">{addError}</p>}
                    <select
                      title="Choose agent to delegate to"
                      value={newAgentId}
                      onChange={(e) => {
                        const id = e.target.value;
                        setNewAgentId(id);
                        setNewLabel(autoLabelFromAgent(agentById(id)));
                      }}
                    >
                      <option value="">— select agent —</option>
                      {addableAgents
                        .sort((a, b) => a.name.localeCompare(b.name))
                        .map((a) => <option key={a.id} value={a.id}>{a.name} · {a.role}</option>)}
                    </select>
                    <input
                      type="text"
                      placeholder={newAgentId ? autoLabelFromAgent(agentById(newAgentId)) : 'Label (auto-generated from role)'}
                      value={newLabel}
                      onChange={(e) => setNewLabel(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') void submitAdd(); if (e.key === 'Escape') setIsAdding(false); }}
                    />
                    <div className="handoff-add-form-actions">
                      <button className="btn-save" onClick={submitAdd} disabled={addSaving}>Add</button>
                      <button className="btn-cancel" onClick={() => { setIsAdding(false); setAddError(null); }}>Cancel</button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          )}

          {/* ── Add custom delegation button ── */}
          {!isAdding && (
            <button className="btn-add-handoff" onClick={() => setIsAdding(true)}>
              <i className="codicon codicon-add" /> Add custom delegation
            </button>
          )}

          {directReportRows.length === 0 && otherHandoffs.length === 0 && !manager && !isAdding && (
            <p className="text-muted">No hierarchy or handoffs configured.</p>
          )}
        </div>
      )}
    </PortfolioSectionCard>
  );
}
