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

const SEGMENT_COLORS = ['#4e9ff5', '#43c59e', '#f0a443', '#e06c75', '#c678dd', '#56b6c2'] as const;
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
  const { agents } = useTeam();
  const { data: estimate, isLoading } = useContextEstimate(agentId, sessionId);
  const { data: config } = useConfig();

  const agent = agents.find((a) => a.id === agentId);
  const contextWindow = resolveContextWindow(agent, config);

  const totalTokens = estimate ? Math.round(estimate.totalChars / 4) : 0;
  const usePct = Math.min(Math.round((totalTokens / contextWindow) * 100), 100);
  const usedFractionOfWindow = Math.min(totalTokens / contextWindow, 1);
  const freeTokens = Math.max(contextWindow - totalTokens, 0);

  let usageClass = 'ctx-window-fill--ok';
  if (usePct >= 80) {
    usageClass = 'ctx-window-fill--high';
  } else if (usePct >= 50) {
    usageClass = 'ctx-window-fill--warn';
  }

  const segments = (estimate?.segments ?? []).map((seg, i) => ({
    ...seg,
    tokens: Math.round(seg.chars / 4),
    fractionOfWindow:
      estimate && estimate.totalChars > 0
        ? (seg.chars / estimate.totalChars) * usedFractionOfWindow
        : 0,
    color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    swatchClass: `ctx-swatch--c${i % SEGMENT_COLORS.length}` as const,
  }));

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
              <div
                key={seg.key}
                className="ctx-legend-row"
                title={`${seg.label}: ${seg.tokens.toLocaleString()} tokens`}
              >
                <span className={`ctx-swatch ${seg.swatchClass}`} />
                <span className="ctx-seg-name">{seg.label}</span>
                <span className="ctx-seg-tokens">{seg.tokens.toLocaleString()}</span>
                <span className="ctx-seg-pct">{Math.round(seg.fractionOfWindow * 100)}%</span>
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

        {/* Workspace instruction files */}
        {estimate.instructionFiles && estimate.instructionFiles.length > 0 && (
          <div className="ctx-detail-section">
            <div className="ctx-detail-header">
              <i className="codicon codicon-file-code" /> Workspace Instructions
            </div>
            {estimate.instructionFiles.map((f) => (
              <div key={f.path} className="ctx-detail-row" title={f.path}>
                <span className="ctx-detail-name">{f.label}</span>
                <span className="ctx-detail-tokens">
                  {Math.round(f.chars / 4).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Session skills loaded */}
        {estimate.sessionSkills && estimate.sessionSkills.length > 0 && (
          <div className="ctx-detail-section">
            <div className="ctx-detail-header">
              <i className="codicon codicon-symbol-misc" /> Session Skills
            </div>
            {estimate.sessionSkills.map((s) => (
              <div
                key={s.skillPath}
                className={`ctx-detail-row${s.paused ? ' ctx-detail-row--muted' : ''}`}
                title={s.skillPath}
              >
                <span className="ctx-detail-name">
                  {s.name}
                  {s.paused && <span className="ctx-detail-badge">paused</span>}
                </span>
                <span className="ctx-detail-tokens">
                  {Math.round(s.chars / 4).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Session messages going to LLM */}
        {estimate.messages && estimate.messages.length > 0 && (
          <div className="ctx-detail-section">
            <div className="ctx-detail-header">
              <i className="codicon codicon-comment-discussion" /> Messages → LLM (
              {estimate.messages.length})
            </div>
            {estimate.messages.map((msg, i) => (
              <div key={`msg-${i}-${msg.role}`} className="ctx-msg-row" title={msg.preview}>
                <span className={`ctx-msg-role ctx-msg-role--${msg.role}`}>
                  {msg.role === 'user' ? 'U' : 'A'}
                </span>
                <span className="ctx-msg-preview">
                  {msg.preview}
                  {msg.preview.length >= 120 ? '…' : ''}
                </span>
                <span className="ctx-detail-tokens">
                  {Math.round(msg.chars / 4).toLocaleString()}
                </span>
                {msg.toolCallCount > 0 && (
                  <span
                    className="ctx-msg-tools"
                    title={`${msg.toolCallCount} tool call(s), ${Math.round(msg.toolChars / 4)} tokens`}
                  >
                    🔧{msg.toolCallCount}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
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
      count={ctxLabel}
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
