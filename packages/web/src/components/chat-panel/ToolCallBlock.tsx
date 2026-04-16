import { useState } from 'react';
import type { SessionActivatedTool } from '../../types';
import { getToolPhaseClass, getToolPhaseLabel } from '../../utils/contextPanel';
import { getRenderer } from './tool-renderers/index';
import { ToolCallDetailsPanel } from './ToolCallDetailsPanel';

interface ToolCallBlockProps {
  event: SessionActivatedTool;
}

function requestPreview(request: unknown): string | null {
  if (request === undefined) return null;
  if (typeof request === 'string') return request;
  try {
    const serialized = JSON.stringify(request);
    if (!serialized) return null;
    return serialized.length > 140 ? `${serialized.slice(0, 137)}…` : serialized;
  } catch {
    return '[unserializable request]';
  }
}

export function ToolCallBlock({ event }: Readonly<ToolCallBlockProps>) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const toolName = event.toolResult?.toolName ?? event.toolName;
  const phase = event.toolPhase;
  const phaseClass = getToolPhaseClass(phase);
  const phaseLabel = getToolPhaseLabel(phase);
  const request = event.toolResult?.request;

  if (phase === 'request' || phase === 'start') {
    const hasRequest = request !== undefined;
    const preview = requestPreview(request);
    const previewLabel = preview ? `params: ${preview}` : null;
    const toggleDetailsOpen = () => {
      if (!hasRequest) return;
      setDetailsOpen((open) => !open);
    };

    return (
      <div className={`tool-call-entry${detailsOpen ? ' tool-call-entry--open' : ''}`}>
        <button
          type="button"
          className={`tool-call-block tool-call-block--running${detailsOpen ? ' tool-call-block--details-open' : ''}${hasRequest ? ' tool-call-block--clickable' : ''}`}
          data-tool-phase={phase}
          onClick={toggleDetailsOpen}
          disabled={!hasRequest}
          aria-expanded={hasRequest ? detailsOpen : undefined}
        >
          <span className="tool-call-dot" aria-hidden="true" />
          <span className="tool-call-name">{toolName}</span>
          <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
          {previewLabel && <span className="tool-call-inline-msg">{previewLabel}</span>}
          {hasRequest && (
            <span className="tool-call-details-toggle" aria-hidden="true">
              {detailsOpen ? 'details ▴' : 'details ▾'}
            </span>
          )}
        </button>
        {detailsOpen && <ToolCallDetailsPanel event={event} />}
      </div>
    );
  }

  if (phase === 'error') {
    const msg =
      event.message ??
      (typeof event.toolResult?.result === 'string' ? event.toolResult.result : undefined) ??
      'Tool execution failed';
    const userFacingMessage = /^error:\s*/i.test(msg) ? msg : `Error: ${msg}`;
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
          data-tool-phase={phase}
          onClick={toggleDetailsOpen}
          disabled={!canOpen}
          aria-expanded={canOpen ? detailsOpen : undefined}
        >
          <span className="tool-call-icon" aria-hidden="true">
            ⚠
          </span>
          <span className="tool-call-name">{toolName}</span>
          <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
          {msg && (
            <span className="tool-call-inline-msg tool-call-inline-msg--error" title={msg}>
              {userFacingMessage}
            </span>
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
        data-tool-phase={phase ?? 'result'}
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
