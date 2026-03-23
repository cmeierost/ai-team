import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { SessionActivatedTool } from '../../types';
import { getToolPhaseClass, getToolPhaseLabel } from '../../utils/contextPanel';
import { MarkdownMessage } from '../MarkdownMessage';
import { getRenderer } from './tool-renderers/index';
import './ToolResultOverlay.css';

interface ToolResultOverlayProps {
  event: SessionActivatedTool;
  onClose: () => void;
}

type Tab = 'rich' | 'llm';

const MAX_JSON_LINES = 100;

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncateJson(text: string): { display: string; truncated: boolean } {
  const lines = text.split('\n');
  if (lines.length <= MAX_JSON_LINES) return { display: text, truncated: false };
  return {
    display:
      lines.slice(0, MAX_JSON_LINES).join('\n') +
      `\n\n// … (${lines.length - MAX_JSON_LINES} more lines)`,
    truncated: true,
  };
}

export function ToolResultOverlay({ event, onClose }: Readonly<ToolResultOverlayProps>) {
  const [tab, setTab] = useState<Tab>('rich');
  const [showFullJson, setShowFullJson] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const toolName = event.toolResult?.toolName ?? event.toolName;
  const result = event.toolResult?.result;
  const resultLlm = event.toolResult?.resultLlm;
  const phaseClass = getToolPhaseClass(event.toolPhase);
  const phaseLabel = getToolPhaseLabel(event.toolPhase);
  const hasLlmTab = resultLlm !== undefined;

  const renderer = getRenderer(toolName);
  const richNode = renderer ? renderer.render(result, resultLlm, event) : null;

  const rawJson = safePrettyJson(result);
  const { display: truncatedJson, truncated: jsonIsTruncated } = truncateJson(rawJson);

  const overlay = (
    <div
      className="tro-backdrop"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${toolName} result`}
    >
      <div className="tro-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="tro-header">
          <div className="tro-header-left">
            <span className="tro-tool-name">{toolName}</span>
            <span className={`context-tool-phase ${phaseClass}`}>{phaseLabel}</span>
          </div>
          <button type="button" className="tro-close" onClick={onClose} title="Close">
            <i className="codicon codicon-close" />
          </button>
        </div>

        {hasLlmTab && (
          <div className="tro-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'rich'}
              className={`tro-tab${tab === 'rich' ? ' tro-tab--active' : ''}`}
              onClick={() => setTab('rich')}
            >
              Rich view
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'llm'}
              className={`tro-tab${tab === 'llm' ? ' tro-tab--active' : ''}`}
              onClick={() => setTab('llm')}
            >
              What LLM saw
            </button>
          </div>
        )}

        <div className="tro-body">
          {tab === 'rich' ? (
            richNode ? (
              <div className="tro-rich">{richNode}</div>
            ) : (
              <div className="tro-json-wrap">
                <pre className="code-block tro-json">
                  {showFullJson ? rawJson : truncatedJson}
                </pre>
                {jsonIsTruncated && !showFullJson && (
                  <button
                    type="button"
                    className="tro-show-more"
                    onClick={() => setShowFullJson(true)}
                  >
                    Show full output
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="tro-llm-view">
              {typeof resultLlm === 'string' ? (
                <MarkdownMessage content={resultLlm} />
              ) : (
                <pre className="code-block tro-json">{safePrettyJson(resultLlm)}</pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
