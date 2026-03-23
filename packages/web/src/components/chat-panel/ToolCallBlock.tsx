import { useState } from 'react';
import type { SessionActivatedTool } from '../../types';
import { getToolPhaseClass, getToolPhaseLabel } from '../../utils/contextPanel';
import { ToolResultOverlay } from './ToolResultOverlay';

interface ToolCallBlockProps {
  event: SessionActivatedTool;
}

export function ToolCallBlock({ event }: Readonly<ToolCallBlockProps>) {
  const [overlayOpen, setOverlayOpen] = useState(false);
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
    return (
      <div className="tool-call-block tool-call-block--failed">
        <span className="tool-call-icon" aria-hidden="true">⚠</span>
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
        {msg && <span className="tool-call-inline-msg">{msg}</span>}
      </div>
    );
  }

  if (phase === 'denied') {
    const denial = event.toolDenial ?? event.toolResult?.denial;
    const msg = denial?.message ?? event.message ?? 'Access denied';
    const blocked = denial?.blockedPaths?.length ?? 0;
    return (
      <div className="tool-call-block tool-call-block--failed">
        <span className="tool-call-icon" aria-hidden="true">🚫</span>
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
        <span className="tool-call-inline-msg">
          {msg}
          {blocked > 0 ? ` (${blocked} blocked)` : ''}
        </span>
      </div>
    );
  }

  // result phase — clickable if there's a result to show
  const canOpen = event.toolResult?.result !== undefined;
  return (
    <>
      <button
        type="button"
        className={`tool-call-block tool-call-block--completed${canOpen ? ' tool-call-block--clickable' : ''}`}
        onClick={canOpen ? () => setOverlayOpen(true) : undefined}
        title={canOpen ? `View ${toolName} result` : toolName}
        disabled={!canOpen}
      >
        <span className="tool-call-icon" aria-hidden="true">🔧</span>
        <span className="tool-call-name">{toolName}</span>
        <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
        {canOpen && <span className="tool-call-open-hint">view ↗</span>}
      </button>
      {overlayOpen && (
        <ToolResultOverlay event={event} onClose={() => setOverlayOpen(false)} />
      )}
    </>
  );
}
