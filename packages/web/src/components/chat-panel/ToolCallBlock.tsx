import { useState } from 'react';
import type { SessionActivatedTool } from '../../types';
import { getToolPhaseClass, getToolPhaseLabel } from '../../utils/contextPanel';
import { getRenderer } from './tool-renderers/index';
import { ToolCallDetailsPanel } from './ToolCallDetailsPanel';

interface ToolCallBlockProps {
  event: SessionActivatedTool;
}

export function ToolCallBlock({ event }: Readonly<ToolCallBlockProps>) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const toolName = event.toolResult?.toolName ?? event.toolName;
  const phase = event.toolPhase;
  const phaseClass = getToolPhaseClass(phase);
  const phaseLabel = getToolPhaseLabel(phase);

  if (phase === 'request' || phase === 'start') {
    return (
      <div className="tool-call-block tool-call-block--running">
        <span className="tool-call-dot" aria-hidden="true" />
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
      </div>
    );
  }

  if (phase === 'error') {
    const msg =
      event.message ??
      (typeof event.toolResult?.result === 'string' ? event.toolResult.result : undefined) ??
      'Tool execution failed';
    const canOpen =
      event.toolResult?.result !== undefined || event.toolResult?.request !== undefined;
    const toggleDetailsOpen = () => {
      if (!canOpen) return;
      setDetailsOpen((open) => !open);
    };
    return (
      <div className={`tool-call-entry${detailsOpen ? ' tool-call-entry--open' : ''}`}>
        <button
          type="button"
          className={`tool-call-block tool-call-block--failed${detailsOpen ? ' tool-call-block--details-open' : ''}${canOpen ? ' tool-call-block--clickable' : ''}`}
          onClick={toggleDetailsOpen}
          disabled={!canOpen}
          aria-expanded={canOpen ? detailsOpen : undefined}
        >
          <span className="tool-call-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="tool-call-name">{toolName}</span>
          <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
          {msg && <span className="tool-call-inline-msg">{msg}</span>}
          {canOpen && (
            <span className="tool-call-details-toggle" aria-hidden="true">
              {detailsOpen ? 'details ▴' : 'details ▾'}
            </span>
          )}
        </button>
        {detailsOpen && <ToolCallDetailsPanel event={event} />}
      </div>
    );
  }

  if (phase === 'denied') {
    const denial = event.toolDenial ?? event.toolResult?.denial;
    const msg = denial?.message ?? event.message ?? 'Access denied';
    const blocked = denial?.blockedPaths?.length ?? 0;
    return (
      <div className="tool-call-block tool-call-block--failed">
        <span className="tool-call-icon" aria-hidden="true">
          🚫
        </span>
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
        <span className="tool-call-inline-msg">
          {msg}
          {blocked > 0 ? ` (${blocked} blocked)` : ''}
        </span>
      </div>
    );
  }

  // result phase
  const result = event.toolResult?.result;
  const renderer = getRenderer(toolName);
  const hasRichRenderer = renderer !== undefined && result !== undefined;
  const canOpen =
    result !== undefined ||
    event.toolResult?.resultLlm !== undefined ||
    event.toolResult?.request !== undefined;
  const toggleDetailsOpen = () => {
    if (!canOpen) {
      return;
    }
    setDetailsOpen((open) => !open);
  };

  return (
    <div className={`tool-call-entry${detailsOpen ? ' tool-call-entry--open' : ''}`}>
      <button
        type="button"
        className={`tool-call-block tool-call-block--completed${detailsOpen ? ' tool-call-block--details-open' : ''}${canOpen ? ' tool-call-block--clickable' : ''}`}
        onClick={toggleDetailsOpen}
        disabled={!canOpen}
        aria-expanded={detailsOpen}
      >
        <span className="tool-call-icon" aria-hidden="true">
          🔧
        </span>
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
        {hasRichRenderer && !detailsOpen && (
          <span className="tool-call-renderer-badge" aria-label="rendered view available" />
        )}
        {canOpen && (
          <span className="tool-call-details-toggle" aria-hidden="true">
            {detailsOpen ? 'details ▴' : 'details ▾'}
          </span>
        )}
      </button>
      {detailsOpen && <ToolCallDetailsPanel event={event} />}
    </div>
  );
}
