import { useState, type MouseEvent } from 'react';
import type { SessionActivatedTool } from '../../types';
import { getToolPhaseClass, getToolPhaseLabel } from '../../utils/contextPanel';
import { getRenderer } from './tool-renderers/index';
import { ToolCallDetailsPanel } from './ToolCallDetailsPanel';

interface ToolCallBlockProps {
  event: SessionActivatedTool;
  messageIndex: number;
  canMutate: boolean;
  onToggleHidden?: (messageIndex: number, hidden: boolean, toolCallId?: number) => void;
  onSummarize?: (
    messageIndex: number,
    options?: { toolCallId?: number; focusInstruction?: string; maxWords?: number }
  ) => void;
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

function serializeForSize(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function toBytes(text: string | null): number | null {
  if (text === null) return null;
  return new TextEncoder().encode(text).length;
}

function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return `${kb.toFixed(kb >= 10 ? 1 : 2)} KB`;
}

function resultSizeLabel(event: SessionActivatedTool): string | null {
  const rawResultBytes = toBytes(serializeForSize(event.toolResult?.result));
  const compactedResultBytes = toBytes(serializeForSize(event.toolResult?.resultLlm));

  if (rawResultBytes === null && compactedResultBytes === null) {
    return null;
  }

  if (rawResultBytes !== null && compactedResultBytes !== null) {
    if (rawResultBytes === compactedResultBytes) {
      return `${formatKb(rawResultBytes)} raw = ${formatKb(compactedResultBytes)} compacted`;
    }
    return `${formatKb(rawResultBytes)} raw → ${formatKb(compactedResultBytes)} compacted`;
  }

  if (rawResultBytes !== null) {
    return `${formatKb(rawResultBytes)} raw`;
  }

  return `${formatKb(compactedResultBytes!)} compacted`;
}

export function ToolCallBlock({
  event,
  messageIndex,
  canMutate,
  onToggleHidden,
  onSummarize,
}: Readonly<ToolCallBlockProps>) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [summarizeControlsOpen, setSummarizeControlsOpen] = useState(false);
  const [compactPercent, setCompactPercent] = useState(35);
  const [summaryHint, setSummaryHint] = useState('');
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
  const sizeLabel = resultSizeLabel(event);
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

  const toolCallId = event.toolResult?.id;
  const rawResultText = serializeForSize(event.toolResult?.result);
  const hasRawResult = rawResultText !== null && rawResultText.length > 0;
  const isHiddenFromLlm = event.toolResult?.resultLlm === '';
  const canMutateToolResult = canMutate && typeof toolCallId === 'number' && hasRawResult;
  const rawWordCount = rawResultText
    ? rawResultText.replaceAll(/\s+/g, ' ').trim().split(' ').filter(Boolean).length
    : 0;

  const handleToggleHidden = (clickEvent: MouseEvent<HTMLElement>) => {
    clickEvent.stopPropagation();
    if (!canMutateToolResult || !onToggleHidden) {
      return;
    }
    onToggleHidden(messageIndex, !isHiddenFromLlm, toolCallId);
  };

  const handleSummarize = (clickEvent: MouseEvent<HTMLElement>) => {
    clickEvent.stopPropagation();
    if (!canMutateToolResult || !onSummarize) {
      return;
    }
    const clampedPercent = Math.max(10, Math.min(90, Math.floor(compactPercent)));
    const byPercent = Math.max(1, Math.round((rawWordCount * clampedPercent) / 100));
    const boundedByRaw = rawWordCount > 1 ? Math.min(byPercent, rawWordCount - 1) : byPercent;
    const maxWords = Math.max(1, Math.min(500, boundedByRaw));
    const trimmedHint = summaryHint.trim();
    onSummarize(messageIndex, {
      toolCallId,
      maxWords,
      ...(trimmedHint ? { focusInstruction: trimmedHint } : {}),
    });
    setSummarizeControlsOpen(false);
  };

  const handleToggleSummarizeControls = (clickEvent: MouseEvent<HTMLElement>) => {
    clickEvent.stopPropagation();
    if (!canMutateToolResult || !onSummarize) {
      return;
    }
    setSummarizeControlsOpen((previous) => !previous);
  };

  return (
    <div className={`tool-call-entry${detailsOpen ? ' tool-call-entry--open' : ''}`}>
      <div className="tool-call-row">
        <button
          type="button"
          className={`tool-call-block tool-call-block--completed${detailsOpen ? ' tool-call-block--details-open' : ''}${canOpen ? ' tool-call-block--clickable' : ''}${isHiddenFromLlm ? ' tool-call-block--hidden' : ''}`}
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
          {sizeLabel && <span className="tool-call-inline-msg">{sizeLabel}</span>}
          {isHiddenFromLlm && <span className="tool-call-inline-msg">hidden from LLM</span>}
          {hasRichRenderer && !detailsOpen && (
            <span className="tool-call-renderer-badge" aria-label="rendered view available" />
          )}
          {canOpen && (
            <span className="tool-call-details-toggle" aria-hidden="true">
              {detailsOpen ? 'details ▴' : 'details ▾'}
            </span>
          )}
        </button>
        <div className="tool-call-quick-actions">
          <i
            className={`codicon codicon-eye message-visibility-icon${isHiddenFromLlm ? ' message-visibility-toggle--hidden message-visibility-icon--hidden' : ''} tool-call-quick-action${!canMutateToolResult ? ' tool-call-quick-action--disabled' : ''}`}
            onClick={canMutateToolResult ? handleToggleHidden : undefined}
            title={isHiddenFromLlm ? 'Show to LLM' : 'Hide from LLM'}
            aria-label={isHiddenFromLlm ? 'Show to LLM' : 'Hide from LLM'}
            role="button"
            tabIndex={canMutateToolResult ? 0 : -1}
          />
          <i
            className={`codicon codicon-list-selection tool-call-quick-action${!canMutateToolResult || !onSummarize ? ' tool-call-quick-action--disabled' : ''}`}
            onClick={canMutateToolResult && onSummarize ? handleToggleSummarizeControls : undefined}
            title="Summarize for LLM"
            aria-label="Summarize for LLM"
            role="button"
            tabIndex={canMutateToolResult && onSummarize ? 0 : -1}
          />
        </div>
      </div>
      {summarizeControlsOpen && canMutateToolResult && onSummarize && (
        <div className="tool-call-summarize-controls" onClick={(event) => event.stopPropagation()}>
          <label className="tool-call-summarize-label" htmlFor={`tool-compact-${toolCallId}`}>
            Compactness: {compactPercent}%
          </label>
          <input
            id={`tool-compact-${toolCallId}`}
            className="tool-call-summarize-slider"
            type="range"
            min={10}
            max={90}
            step={5}
            value={compactPercent}
            onChange={(event) => setCompactPercent(Number(event.target.value))}
          />
          <input
            className="tool-call-summarize-hint"
            type="text"
            value={summaryHint}
            onChange={(event) => setSummaryHint(event.target.value)}
            placeholder="Optional hint (e.g. what changed most)"
          />
          <button type="button" className="tool-call-summarize-apply" onClick={handleSummarize}>
            Summarize
          </button>
        </div>
      )}
      {detailsOpen && !isHiddenFromLlm && <ToolCallDetailsPanel event={event} />}
    </div>
  );
}
