import { useState } from 'react';
import type { SessionActivatedTool } from '../../types';
import { getRenderer } from './tool-renderers/index';

interface ToolCallDetailsPanelProps {
  event: SessionActivatedTool;
}

type Tab = 'rendered' | 'json' | 'llm' | 'request';

const MAX_LINES = 120;

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value;
  return safePrettyJson(value);
}

// ── Collapsible JSON tree ─────────────────────────────────────────────────────

interface JsonNodeProps {
  value: unknown;
  depth: number;
}

function JsonNode({ value, depth }: Readonly<JsonNodeProps>) {
  const [open, setOpen] = useState(depth < 2);

  if (value === null) return <span className="tcd-j-null">null</span>;
  if (typeof value === 'boolean') return <span className="tcd-j-bool">{String(value)}</span>;
  if (typeof value === 'number') return <span className="tcd-j-num">{value}</span>;
  if (typeof value === 'string') {
    const isLong = value.length > 120 || value.includes('\n');
    if (isLong) {
      return (
        <>
          <button type="button" className="tcd-j-toggle" onClick={() => setOpen((o) => !o)}>
            {open ? '▾' : '▸'}
          </button>
          <span className="tcd-j-str tcd-j-str-preview">
            &quot;{open ? '' : value.slice(0, 60).replace(/\n/g, '↵') + '…'}&quot;
          </span>
          {open && <pre className="tcd-j-str-block">{value}</pre>}
        </>
      );
    }
    return <span className="tcd-j-str">&quot;{value}&quot;</span>;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="tcd-j-punct">[]</span>;
    return (
      <>
        <button type="button" className="tcd-j-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="tcd-j-punct">[</span>
        {!open && (
          <>
            <span className="tcd-j-ellipsis"> {value.length} items </span>
            <span className="tcd-j-punct">]</span>
          </>
        )}
        {open && (
          <>
            <div className="tcd-j-indent">
              {value.map((item, i) => (
                <div key={i} className="tcd-j-row">
                  <JsonNode value={item} depth={depth + 1} />
                  {i < value.length - 1 && <span className="tcd-j-comma">,</span>}
                </div>
              ))}
            </div>
            <span className="tcd-j-punct">]</span>
          </>
        )}
      </>
    );
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="tcd-j-punct">{'{}'}</span>;
    return (
      <>
        <button type="button" className="tcd-j-toggle" onClick={() => setOpen((o) => !o)}>
          {open ? '▾' : '▸'}
        </button>
        <span className="tcd-j-punct">{'{'}</span>
        {!open && (
          <>
            <span className="tcd-j-ellipsis">
              {' '}
              {entries.length} {entries.length === 1 ? 'key' : 'keys'}{' '}
            </span>
            <span className="tcd-j-punct">{'}'}</span>
          </>
        )}
        {open && (
          <>
            <div className="tcd-j-indent">
              {entries.map(([k, v], i) => (
                <div key={k} className="tcd-j-row">
                  <span className="tcd-j-key">&quot;{k}&quot;</span>
                  <span className="tcd-j-colon">: </span>
                  <JsonNode value={v} depth={depth + 1} />
                  {i < entries.length - 1 && <span className="tcd-j-comma">,</span>}
                </div>
              ))}
            </div>
            <span className="tcd-j-punct">{'}'}</span>
          </>
        )}
      </>
    );
  }

  return <span className="tcd-j-str">{String(value)}</span>;
}

function JsonTree({ value }: Readonly<{ value: unknown }>) {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value);
    } catch {
      /* leave as string */
    }
  }
  return (
    <div className="tcd-j-tree">
      <JsonNode value={parsed} depth={0} />
    </div>
  );
}

interface PreBlockProps {
  text: string;
  maxLines?: number;
}

function PreBlock({ text, maxLines = MAX_LINES }: Readonly<PreBlockProps>) {
  const [showFull, setShowFull] = useState(false);
  const allLines = text.split('\n');
  const truncated = allLines.length > maxLines && !showFull;
  const visibleLines = truncated ? allLines.slice(0, maxLines) : allLines;

  return (
    <div className="tcd-pre-wrap">
      <table className="tcd-pre-table" aria-label="code output">
        <tbody>
          {visibleLines.map((line, i) => (
            <tr key={i} className="tcd-pre-row">
              <td className="tcd-line-num" aria-hidden="true">
                {i + 1}
              </td>
              <td className="tcd-line-content">{line || '\u00a0'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {truncated && (
        <button type="button" className="tcd-show-more" onClick={() => setShowFull(true)}>
          Show {allLines.length - maxLines} more lines…
        </button>
      )}
    </div>
  );
}

export function ToolCallDetailsPanel({ event }: Readonly<ToolCallDetailsPanelProps>) {
  const toolName = event.toolResult?.toolName ?? event.toolName;
  const result = event.toolResult?.result;
  const resultLlm = event.toolResult?.resultLlm;
  const request = event.toolResult?.request;

  const renderer = getRenderer(toolName);
  const richNode =
    renderer && result !== undefined ? renderer.render(result, resultLlm, event) : null;

  const hasRendered = richNode !== null;
  const hasJson = result !== undefined;
  const hasLlm = resultLlm !== undefined;
  const hasRequest = request !== undefined;
  const isError = event.toolResult?.outcome === 'error';

  const defaultTab: Tab = (() => {
    if (isError) {
      if (hasRequest) return 'request';
      if (hasJson) return 'json';
      return 'llm';
    }
    if (hasRendered) return 'rendered';
    if (hasJson) return 'json';
    if (hasLlm) return 'llm';
    return 'request';
  })();
  const [tab, setTab] = useState<Tab>(defaultTab);

  const tabs: { id: Tab; label: string; visible: boolean }[] = [
    { id: 'rendered', label: 'Rendered', visible: hasRendered },
    { id: 'json', label: isError ? 'Error' : 'JSON', visible: hasJson },
    { id: 'llm', label: 'LLM', visible: hasLlm },
    { id: 'request', label: 'Request', visible: hasRequest },
  ];

  const visibleTabs = tabs.filter((t) => t.visible);

  if (visibleTabs.length === 0) {
    return (
      <div className="tcd-panel">
        <div className="tcd-body tcd-empty">No result data available.</div>
      </div>
    );
  }

  return (
    <div className="tcd-panel">
      {visibleTabs.length > 1 && (
        <div className="tcd-tabs" role="tablist">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`tcd-tab${tab === t.id ? ' tcd-tab--active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      <div className="tcd-body">
        {tab === 'rendered' && richNode && <div className="tcd-rendered">{richNode}</div>}
        {tab === 'json' && hasJson && <JsonTree value={result} />}
        {tab === 'llm' && hasLlm && <PreBlock text={valueToText(resultLlm)} />}
        {tab === 'request' && hasRequest && <JsonTree value={request} />}
      </div>
    </div>
  );
}
