import { useQuery } from '@tanstack/react-query';
import { useContextEstimate } from '../../hooks/useContextEstimate';
import { useConfig } from '../../hooks/useConfig';
import { useTeam } from '../../context/TeamContext';
import { contextPanelQueryKeys } from '../../hooks/contextPanelQueryKeys';
import { PortfolioSectionCard } from './portfolioShared';
import type { Agent } from '../../types';

interface Props {
  agent: Agent;
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

export function PortfolioContextWindowSection({ agent }: Readonly<Props>) {
  const { client } = useTeam();
  const latestSessionQuery = useQuery({
    queryKey: contextPanelQueryKeys.sessions(agent.id),
    queryFn: () => client.sessions.list({ agentId: agent.id, limit: 1 }),
    enabled: Boolean(agent.id),
    staleTime: 15_000,
  });
  const latestSessionId = latestSessionQuery.data?.[0]?.id;
  const { data: estimate, isLoading: estimateLoading } = useContextEstimate(
    agent.id,
    latestSessionId
  );
  const { data: config } = useConfig();

  const isLoading = latestSessionQuery.isLoading || estimateLoading;

  if (isLoading) {
    return (
      <PortfolioSectionCard title="Initial Context Window" icon="🧠">
        <div className="ctx-loading">
          <i className="codicon codicon-loading codicon-modifier-spin" /> Estimating…
        </div>
      </PortfolioSectionCard>
    );
  }

  if (!estimate || estimate.totalChars === 0) return null;

  // Resolve context window for this agent's configured provider/model
  const providerKey = agent.llm?.provider ?? config?.defaultModel?.provider;
  const allProviders = config?.providers ?? {};
  const providerCfg = providerKey ? allProviders[providerKey] : undefined;
  const modelKey = agent.llm?.modelKey;
  const rawContextWindow =
    (modelKey && providerCfg?.models?.find((m) => m.name === modelKey)?.contextWindow) ??
    providerCfg?.contextWindow;
  const contextWindow = typeof rawContextWindow === 'number' ? rawContextWindow : 128_000;

  const totalTokens = Math.round(estimate.totalChars / 4);
  const usePct = Math.min(Math.round((totalTokens / contextWindow) * 100), 100);
  const usedFractionOfWindow = Math.min(totalTokens / contextWindow, 1);
  const freeTokens = Math.max(contextWindow - totalTokens, 0);

  const messageChars = estimate.messages.reduce((sum, msg) => sum + msg.chars, 0);
  const toolResultChars = estimate.messages.reduce((sum, msg) => sum + msg.toolChars, 0);
  const messageTokens = Math.round(messageChars / 4);
  const toolResultTokens = Math.round(toolResultChars / 4);
  const toolCallCount = estimate.messages.reduce((sum, msg) => sum + msg.toolCallCount, 0);

  const normalizedSegments = [...estimate.segments];
  const messageSegmentIndex = normalizedSegments.findIndex((seg) => seg.key === 'messages');
  if (messageChars > 0) {
    if (messageSegmentIndex >= 0) {
      normalizedSegments[messageSegmentIndex] = {
        ...normalizedSegments[messageSegmentIndex],
        chars: messageChars,
      };
    } else {
      normalizedSegments.push({ key: 'messages', label: 'Chat Messages', chars: messageChars });
    }
  }

  const toolResultSegmentIndex = normalizedSegments.findIndex((seg) => seg.key === 'tool_results');
  if (toolResultChars > 0) {
    if (toolResultSegmentIndex >= 0) {
      normalizedSegments[toolResultSegmentIndex] = {
        ...normalizedSegments[toolResultSegmentIndex],
        chars: toolResultChars,
      };
    } else {
      normalizedSegments.push({
        key: 'tool_results',
        label: 'Tool Results',
        chars: toolResultChars,
      });
    }
  }

  const segments = normalizedSegments.map((seg, i) => ({
    ...seg,
    tokens: Math.round(seg.chars / 4),
    fractionOfUsed: estimate.totalChars > 0 ? seg.chars / estimate.totalChars : 0,
    fractionOfWindow:
      estimate.totalChars > 0 ? (seg.chars / estimate.totalChars) * usedFractionOfWindow : 0,
    color: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
    swatchClass: `ctx-swatch--c${i % SEGMENT_COLORS.length}`,
  }));

  const donutEntries: DonutEntry[] = [
    ...segments.map((s) => ({
      id: `seg-${s.key}`,
      fraction: s.fractionOfWindow,
      color: s.color,
      label: `${s.label}: ${s.tokens.toLocaleString()} tokens (${Math.round(s.fractionOfWindow * 100)}%)`,
    })),
    {
      id: 'seg-free',
      fraction: 1 - usedFractionOfWindow,
      color: FREE_COLOR,
      label: `Free: ${freeTokens.toLocaleString()} tokens (${Math.max(0, 100 - usePct)}%)`,
    },
  ];

  let usageClass = 'ctx-window-fill--ok';
  if (usePct >= 80) {
    usageClass = 'ctx-window-fill--high';
  } else if (usePct >= 50) {
    usageClass = 'ctx-window-fill--warn';
  }

  return (
    <PortfolioSectionCard title="Initial Context Window" icon="🧠">
      <div className="ctx-content">
        <div className="ctx-chart-wrap">
          <DonutChart entries={donutEntries} />
          <div className="ctx-center-label">
            <span className="ctx-center-tokens">{totalTokens.toLocaleString()}</span>
            <span className="ctx-center-sublabel">start tokens</span>
          </div>
        </div>

        <div className="ctx-legend">
          {segments.map((seg) => (
            <div
              key={seg.key}
              className="ctx-legend-row"
              title={`${seg.label}: ${seg.tokens.toLocaleString()} tokens · ${Math.round(seg.fractionOfWindow * 100)}% of context window`}
            >
              <span className={`ctx-swatch ${seg.swatchClass}`} />
              <span className="ctx-seg-name">{seg.label}</span>
              <span className="ctx-seg-tokens">{seg.tokens.toLocaleString()}</span>
              <span className="ctx-seg-pct">{Math.round(seg.fractionOfWindow * 100)}%</span>
            </div>
          ))}
          <div
            className="ctx-legend-row"
            title={`Free: ${freeTokens.toLocaleString()} tokens · ${Math.max(0, 100 - usePct)}% of context window`}
          >
            <span className="ctx-swatch ctx-swatch--free" />
            <span className="ctx-seg-name">Free</span>
            <span className="ctx-seg-tokens">{freeTokens.toLocaleString()}</span>
            <span className="ctx-seg-pct">{Math.max(0, 100 - usePct)}%</span>
          </div>
        </div>
      </div>

      <div className="ctx-window-bar">
        <div className="ctx-window-bar-header">
          <span>
            {latestSessionId ? 'Session context window usage' : 'Context window usage on start'}
          </span>
          <span>
            {usePct}% of {(contextWindow / 1000).toFixed(0)}k tokens
          </span>
        </div>
        <p className="ctx-window-note">
          {latestSessionId
            ? 'Represents what the current session contributes to the LLM context for this agent.'
            : 'Represents what a call to the LLM uses before any user message is written.'}
        </p>
        <progress className={`ctx-window-progress ${usageClass}`} max={100} value={usePct} />
      </div>

      <div className="ctx-window-bar">
        <div className="ctx-window-bar-header">
          <span>Session message/tool usage</span>
          <span>{(messageTokens + toolResultTokens).toLocaleString()} tokens</span>
        </div>
        <div className="ctx-legend">
          <div
            className="ctx-legend-row"
            title="User + assistant chat message text included in context"
          >
            <span className="ctx-swatch ctx-swatch--c5" />
            <span className="ctx-seg-name">Chat Messages</span>
            <span className="ctx-seg-tokens">{messageTokens.toLocaleString()}</span>
            <span className="ctx-seg-pct">{estimate.messages.length} msg</span>
          </div>
          <div className="ctx-legend-row" title="Serialized tool outputs included in context">
            <span className="ctx-swatch ctx-swatch--c6" />
            <span className="ctx-seg-name">Tool Results</span>
            <span className="ctx-seg-tokens">{toolResultTokens.toLocaleString()}</span>
            <span className="ctx-seg-pct">{toolCallCount} calls</span>
          </div>
        </div>
      </div>
    </PortfolioSectionCard>
  );
}
