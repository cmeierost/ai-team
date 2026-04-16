import { MarkdownMessage } from '../MarkdownMessage';
import './ToolStructuredValueView.css';

type ToolStructuredValueViewProps = {
  value: unknown;
  variant: 'inline' | 'overlay';
};

function safePrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return fallbackText(value);
  }
}

function fallbackText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (value instanceof Error) return value.stack ?? value.message;
  return Object.prototype.toString.call(value);
}

function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function looksLikeJsonString(text: string): boolean {
  const trimmed = text.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    return false;
  }

  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

function looksLikeMarkdown(text: string): boolean {
  const markdownSignals = [
    /(^|\n)#{1,6}\s/,
    /(^|\n)\s*[-*+]\s/,
    /(^|\n)\s*\d+\.\s/,
    /\[[^\]]+\]\([^)]+\)/,
    /(^|\n)>\s/,
    /```/,
  ];

  return markdownSignals.some((pattern) => pattern.test(text));
}

function looksLikeCode(text: string): boolean {
  const codeSignals = [
    /(^|\n)\s*(const|let|var|function|class|interface|type|import|export|return)\b/m,
    /=>/,
    /[{};]/,
    /<\/?[A-Za-z][^>]*>/,
    /(^|\n)\s*def\s+\w+/m,
    /(^|\n)\s*SELECT\b/i,
  ];

  const matches = codeSignals.filter((pattern) => pattern.test(text)).length;
  const lineCount = text.split('\n').length;
  return lineCount > 1 && matches >= 2;
}

function detectKind(value: unknown): 'markdown' | 'json' | 'code' {
  if (typeof value !== 'string') {
    return 'json';
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return 'markdown';
  }

  if (looksLikeJsonString(trimmed)) {
    return 'json';
  }

  if (looksLikeMarkdown(trimmed)) {
    return 'markdown';
  }

  if (looksLikeCode(trimmed)) {
    return 'code';
  }

  return 'markdown';
}

export function ToolStructuredValueView({
  value,
  variant,
}: Readonly<ToolStructuredValueViewProps>) {
  const kind = detectKind(value);
  const className = `tool-value-view tool-value-view--${variant} tool-value-view--${kind}`;

  if (kind === 'json') {
    const jsonValue = typeof value === 'string' ? tryParseJson(value) : value;
    return (
      <div className={className}>
        <pre className="tool-value-pre">{safePrettyJson(jsonValue)}</pre>
      </div>
    );
  }

  if (kind === 'code') {
    const codeText = typeof value === 'string' ? value : safePrettyJson(value);
    return (
      <div className={className}>
        <pre className="tool-value-pre">
          <code>{codeText}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className={className}>
      <MarkdownMessage content={typeof value === 'string' ? value : safePrettyJson(value)} />
    </div>
  );
}
