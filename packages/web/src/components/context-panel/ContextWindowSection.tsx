import { useState } from 'react';
import { useTeam } from '../../context/TeamContext';
import { useContextEstimate } from '../../hooks/useContextEstimate';
import { useConfig } from '../../hooks/useConfig';
import type { TeamConfig } from '../../hooks/useConfig';
import type { Agent } from '../../types';
import { ContextPanelSectionFrame } from './ContextPanelSectionFrame';
import type { ContextSection } from './contextPanelTypes';

interface ContextWindowSectionProps {
  agentId: string;
  sessionId?: string;
  expandedSection: ContextSection | null;
  onToggleSection: (section: ContextSection) => void;
}

interface DonutEntry {
  id: string;
  fraction: number;
  color: string;
  label: string;
}

const SEGMENT_COLORS = [
  '#4e9ff5',
  '#43c59e',
  '#f0a443',
  '#e06c75',
  '#c678dd',
  '#56b6c2',
  '#e5c07b',
] as const;
const FREE_COLOR = '#525866';

const CX = 40;
const CY = 40;
const RADIUS = 26;
const STROKE_W = 10;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function DonutChart({ entries }: Readonly<{ entries: ReadonlyArray<DonutEntry> }>) {
  let accumulated = 0;
  const arcs = entries.map((entry) => {
    const frac = entry.fraction;
    const dash = frac * CIRCUMFERENCE;
    const gap = CIRCUMFERENCE - dash;
    const offset = CIRCUMFERENCE * (0.25 - accumulated);
    accumulated += frac;
    return (
      <circle
        key={entry.id}
        cx={CX}
        cy={CY}
        r={RADIUS}
        fill="none"
        stroke={entry.color}
        strokeWidth={STROKE_W}
        strokeDasharray={`${dash.toFixed(2)} ${gap.toFixed(2)}`}
        strokeDashoffset={offset.toFixed(2)}
        aria-label={entry.label}
      />
    );
  });
  return (
    <svg viewBox={`0 0 ${CX * 2} ${CY * 2}`} className="ctx-donut" aria-hidden="true">
      {arcs}
    </svg>
  );
}

function resolveContextWindow(agent: Agent | undefined, config: TeamConfig | undefined): number {
  const providers = config?.providers ?? {};
  const modelKeys = config?.modelKeys ?? {};
  const providerKey =
    agent?.llm?.provider ??
    config?.defaultModel?.provider ??
    Object.keys(providers).find((k) => providers[k].defaultModel) ??
    Object.keys(providers)[0];
  const providerCfg = providerKey ? providers[providerKey] : undefined;
  const modelKey = agent?.llm?.modelKey;
  const mappedModel = modelKey ? modelKeys[modelKey]?.model : undefined;
  const rawContextWindow =
    (modelKey &&
      providerCfg?.models?.find((m) => m.name === (mappedModel ?? modelKey))?.contextWindow) ??
    providerCfg?.contextWindow;
  return typeof rawContextWindow === 'number' ? rawContextWindow : 128_000;
}

export function ContextWindowSection({
  agentId,
  sessionId,
  expandedSection,
  onToggleSection,
}: Readonly<ContextWindowSectionProps>) {
  const [instructionsExpanded, setInstructionsExpanded] = useState(false);
  const [skillsExpanded, setSkillsExpanded] = useState(false);
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const { agents, client } = useTeam();
  const { data: estimate, isLoading } = useContextEstimate(agentId, sessionId);
  const { data: config } = useConfig();

  const agent = agents.find((a) => a.id === agentId);
  const contextWindow = resolveContextWindow(agent, config);

  const totalTokens = estimate ? Math.round(estimate.totalChars / 4) : 0;
  const usePct = Math.min(Math.round((totalTokens / contextWindow) * 100), 100);
  const usedFractionOfWindow = Math.min(totalTokens / contextWindow, 1);
  const freeTokens = Math.max(contextWindow - totalTokens, 0);

  let usageClass = 'ctx-window-fill--ok';
  let pctClass = 'ctx-pct--ok';
  if (usePct >= 90) {
    usageClass = 'ctx-window-fill--high';
    pctClass = 'ctx-pct--high';
  } else if (usePct >= 50) {
    usageClass = 'ctx-window-fill--warn';
    pctClass = 'ctx-pct--warn';
  }

  const segments = (estimate?.segments ?? [])
    .filter((seg) => seg.chars > 0)
    .map((seg, i) => ({
      ...seg,
      tokens: Math.round(seg.chars / 4),
      fractionOfWindow:
        estimate && estimate.totalChars > 0
          ? (seg.chars / estimate.totalChars) * usedFractionOfWindow
          : 0,
      color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
      swatchClass: `ctx-swatch--c${i % SEGMENT_COLORS.length}` as const,
    }));

  const messageCount = estimate?.messages.length ?? 0;
  const toolResultCount =
    estimate?.messages.filter((message) => message.toolCallCount > 0).length ?? 0;
  const toolResultTokens =
    Math.round(
      (estimate?.messages.reduce((sum, message) => sum + message.toolChars, 0) ?? 0) / 4
    ) ?? 0;
  const toolResultSavedTokens =
    Math.round(
      (estimate?.messages.reduce((sum, message) => sum + (message.toolSavedChars ?? 0), 0) ?? 0) / 4
    ) ?? 0;
  const compactedToolResultCount =
    estimate?.messages.reduce((sum, message) => sum + (message.compactedToolCallCount ?? 0), 0) ??
    0;
  const toolResultDeltaSign = toolResultSavedTokens > 0 ? '-' : '+';
  const hasToolCompactionDelta = compactedToolResultCount > 0 && toolResultSavedTokens !== 0;
  const toolResultsSummaryLabel = hasToolCompactionDelta
    ? `${toolResultCount} results · ${toolResultTokens.toLocaleString()} tok · ${compactedToolResultCount} cmp ${toolResultDeltaSign}${Math.abs(toolResultSavedTokens).toLocaleString()} tok`
    : `${toolResultCount} results · ${toolResultTokens.toLocaleString()} tok`;

  const getSegmentSummaryLabel = (seg: { key: string; fractionOfWindow: number }) => {
    if (seg.key === 'messages') {
      return `${messageCount} msg`;
    }

    if (seg.key === 'tool_results') {
      return toolResultsSummaryLabel;
    }

    return `${Math.round(seg.fractionOfWindow * 100)}%`;
  };

  const donutEntries: DonutEntry[] = [
    ...segments.map((s) => ({
      id: `seg-${s.key}`,
      fraction: s.fractionOfWindow,
      color: s.color,
      label: `${s.label}: ${s.tokens.toLocaleString()} tokens`,
    })),
    {
      id: 'seg-free',
      fraction: 1 - usedFractionOfWindow,
      color: FREE_COLOR,
      label: `Free: ${freeTokens.toLocaleString()} tokens`,
    },
  ];

  const ctxLabel = `${(contextWindow / 1000).toFixed(0)}k`;
  const usedLabel = totalTokens > 0 ? `${(totalTokens / 1000).toFixed(1)}k` : null;

  function renderContent() {
    if (!estimate || estimate.totalChars === 0) {
      return <div className="context-empty">No context estimate available yet.</div>;
    }
    return (
      <div className="ctx-panel-pad">
        <div className="ctx-content ctx-content--compact">
          <div className="ctx-chart-wrap ctx-chart-wrap--sm">
            <DonutChart entries={donutEntries} />
            <div className="ctx-center-label">
              <span className="ctx-center-tokens">{totalTokens.toLocaleString()}</span>
              <span className="ctx-center-sublabel">tokens</span>
            </div>
          </div>
          <div className="ctx-legend ctx-legend--compact">
            {segments.map((seg) => (
              <div key={seg.key}>
                <div
                  className="ctx-legend-row"
                  title={`${seg.label}: ${seg.tokens.toLocaleString()} tokens`}
                >
                  <span className={`ctx-swatch ${seg.swatchClass}`} />
                  <span className="ctx-seg-name">{seg.label}</span>
                  <span className="ctx-seg-tokens">{seg.tokens.toLocaleString()}</span>
                  <span className="ctx-seg-pct">{getSegmentSummaryLabel(seg)}</span>
                </div>

                {/* Instruction files sub-rows */}
                {seg.key === 'instructions' &&
                  estimate?.instructionFiles &&
                  estimate.instructionFiles.filter((f) => f.chars > 0).length > 0 && (
                    <div className="ctx-collapsible">
                      <div
                        className="ctx-collapsible-toggle"
                        onClick={() => setInstructionsExpanded(!instructionsExpanded)}
                      >
                        <span
                          className={`ctx-toggle-icon${instructionsExpanded ? ' ctx-toggle-icon--expanded' : ''}`}
                        >
                          ▶
                        </span>
                        <span>
                          Workspace instructions (
                          {estimate.instructionFiles.filter((f) => f.chars > 0).length})
                        </span>
                      </div>
                      {instructionsExpanded && (
                        <div className="ctx-sub-rows">
                          {estimate.instructionFiles
                            .filter((f) => f.chars > 0)
                            .map((f) => (
                              <div
                                key={f.path}
                                className="ctx-sub-row ctx-sub-row--clickable"
                                onClick={() => {
                                  client.ide.openFile({ filePath: f.path }).catch(() => {
                                    // IDE bridge may not be connected
                                  });
                                }}
                                title={f.path}
                                role="button"
                                tabIndex={0}
                              >
                                <span className="ctx-sub-name">{f.label}</span>
                                <span className="ctx-sub-tokens">
                                  {Math.round(f.chars / 4).toLocaleString()}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Session skills sub-rows */}
                {seg.key === 'session_skills' &&
                  estimate?.sessionSkills &&
                  estimate.sessionSkills.filter((s) => s.chars > 0).length > 0 && (
                    <div className="ctx-collapsible">
                      <div
                        className="ctx-collapsible-toggle"
                        onClick={() => setSkillsExpanded(!skillsExpanded)}
                      >
                        <span
                          className={`ctx-toggle-icon${skillsExpanded ? ' ctx-toggle-icon--expanded' : ''}`}
                        >
                          ▶
                        </span>
                        <span>
                          Session skills ({estimate.sessionSkills.filter((s) => s.chars > 0).length}
                          )
                        </span>
                      </div>
                      {skillsExpanded && (
                        <div className="ctx-sub-rows">
                          {estimate.sessionSkills
                            .filter((s) => s.chars > 0)
                            .map((s) => (
                              <div
                                key={s.skillPath}
                                className={`ctx-sub-row${s.paused ? ' ctx-sub-row--muted' : ''}`}
                                title={s.skillPath}
                              >
                                <span className="ctx-sub-name">
                                  {s.name}
                                  {s.paused && <span className="ctx-detail-badge">paused</span>}
                                </span>
                                <span className="ctx-sub-tokens">
                                  {Math.round(s.chars / 4).toLocaleString()}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}

                {/* Notes sub-rows */}
                {seg.key === 'notes' && estimate?.notes && estimate.notes.length > 0 && (
                  <div className="ctx-sub-rows">
                    {estimate.notes.map((note) => (
                      <div key={note.id} className="ctx-sub-row" title={note.preview}>
                        <span className="ctx-msg-role ctx-msg-role--assistant">N</span>
                        <span className="ctx-sub-name ctx-sub-preview">
                          {note.title}
                          {note.source === 'compacted' ? (
                            <span className="ctx-detail-badge">compacted</span>
                          ) : null}
                        </span>
                        <span className="ctx-sub-tokens">
                          {Math.round(note.chars / 4).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Plans sub-rows */}
                {seg.key === 'plans' && estimate?.plans && estimate.plans.length > 0 && (
                  <div className="ctx-sub-rows">
                    {estimate.plans.map((plan) => (
                      <div key={plan.id} className="ctx-sub-row" title={plan.title}>
                        <span className="ctx-msg-role ctx-msg-role--assistant">P</span>
                        <span className="ctx-sub-name ctx-sub-preview">{plan.title}</span>
                        <span className="ctx-sub-tokens">
                          {Math.round(plan.chars / 4).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tasks sub-rows */}
                {seg.key === 'tasks' && estimate?.tasks && estimate.tasks.length > 0 && (
                  <div className="ctx-sub-rows">
                    {estimate.tasks.map((task) => (
                      <div key={task.id} className="ctx-sub-row" title={task.title}>
                        <span className="ctx-msg-role ctx-msg-role--assistant">T</span>
                        <span className="ctx-sub-name ctx-sub-preview">
                          {task.title}
                          {task.status ? <span className="ctx-detail-badge">{task.status}</span> : null}
                        </span>
                        <span className="ctx-sub-tokens">
                          {Math.round(task.chars / 4).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Todos sub-rows */}
                {seg.key === 'todos' && estimate?.todos && estimate.todos.length > 0 && (
                  <div className="ctx-sub-rows">
                    {estimate.todos.map((todo) => (
                      <div key={todo.id} className="ctx-sub-row" title={todo.content}>
                        <span className="ctx-msg-role ctx-msg-role--assistant">✓</span>
                        <span className="ctx-sub-name ctx-sub-preview">
                          {todo.content}
                          {todo.done ? (
                            <span className="ctx-detail-badge">done</span>
                          ) : (
                            <span className="ctx-detail-badge">open</span>
                          )}
                        </span>
                        <span className="ctx-sub-tokens">
                          {Math.round(todo.chars / 4).toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tool definitions sub-rows */}
                {seg.key === 'tools' &&
                  estimate?.tools &&
                  estimate.tools.filter((tool) => tool.chars > 0).length > 0 && (
                    <div className="ctx-collapsible">
                      <div
                        className="ctx-collapsible-toggle"
                        onClick={() => setToolsExpanded(!toolsExpanded)}
                      >
                        <span
                          className={`ctx-toggle-icon${toolsExpanded ? ' ctx-toggle-icon--expanded' : ''}`}
                        >
                          ▶
                        </span>
                        <span>
                          Tool definitions ({estimate.tools.filter((tool) => tool.chars > 0).length}
                          )
                        </span>
                      </div>
                      {toolsExpanded && (
                        <div className="ctx-sub-rows">
                          {estimate.tools
                            .filter((tool) => tool.chars > 0)
                            .map((tool) => (
                              <div
                                key={tool.name}
                                className="ctx-sub-row"
                                title={tool.description || tool.name}
                              >
                                <span className="ctx-sub-name">{tool.name}</span>
                                <span className="ctx-sub-tokens">
                                  {Math.round(tool.chars / 4).toLocaleString()}
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  )}
              </div>
            ))}
            <div className="ctx-legend-row" title={`Free: ${freeTokens.toLocaleString()} tokens`}>
              <span className="ctx-swatch ctx-swatch--free" />
              <span className="ctx-seg-name">Free</span>
              <span className="ctx-seg-tokens">{freeTokens.toLocaleString()}</span>
              <span className="ctx-seg-pct">{Math.max(0, 100 - usePct)}%</span>
            </div>
          </div>
        </div>
        <div className="ctx-window-bar">
          <div className="ctx-window-bar-header">
            <span>{sessionId ? 'Session context usage' : 'Initial context usage'}</span>
            <span>
              {usePct}% of {(contextWindow / 1000).toFixed(0)}k
            </span>
          </div>
          <progress className={`ctx-window-progress ${usageClass}`} max={100} value={usePct} />
        </div>
      </div>
    );
  }

  return (
    <ContextPanelSectionFrame
      section="context-window"
      expandedSection={expandedSection}
      onToggleSection={onToggleSection}
      title={
        <span>
          <i className="codicon codicon-dashboard" /> Context Window
        </span>
      }
      count={
        usedLabel ? (
          <span className="ctx-window-count">
            {usedLabel} / {ctxLabel} <span className={pctClass}>({usePct}%)</span>
          </span>
        ) : (
          ctxLabel
        )
      }
    >
      {isLoading ? (
        <div className="ctx-loading ctx-panel-pad">
          <i className="codicon codicon-loading codicon-modifier-spin" /> Estimating…
        </div>
      ) : (
        renderContent()
      )}
    </ContextPanelSectionFrame>
  );
}
