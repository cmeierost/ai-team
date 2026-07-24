import {
  Markdown,
  sliceByColumn,
  truncateToWidth,
  visibleWidth,
  type Component,
} from '@ai-team/tui';

export class SlashCommandResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private readonly content: Markdown;

  constructor(value: unknown) {
    this.content = new Markdown(formatValue(value));
  }

  render(width: number): string[] {
    return this.content.render(width);
  }

  invalidate(): void {
    this.content.invalidate();
  }

  remove(): void {
    this._parent?.removeChild(this);
  }
}

export class RunCommandResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  private value: string;

  constructor(value = '') {
    this.value = sanitizeCommandOutput(value);
  }

  append(text: string): void {
    this.value += sanitizeCommandOutput(text);
  }

  complete(text: string): void {
    if (!text) return;
    const liveWithoutTrailingWhitespace = this.value.trimEnd();
    if (liveWithoutTrailingWhitespace && text.startsWith(liveWithoutTrailingWhitespace)) {
      this.append(text.slice(liveWithoutTrailingWhitespace.length));
      return;
    }
    const separator = this.value && !this.value.endsWith('\n\n') ? '\n\n' : '';
    this.append(`${separator}${text}`);
  }

  render(width: number): string[] {
    return wrapCommandOutput(this.value, width);
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}

function sanitizeCommandOutput(value: string): string {
  return value
    .replace(
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\)?|P[^\x07]*(?:\x07|\x1b\\)?|.)/g,
      ''
    )
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[^\P{C}\n\t]/gu, '');
}

function wrapCommandOutput(value: string, width: number): string[] {
  const safeWidth = Math.max(1, width);
  const rendered: string[] = [];
  for (const logicalLine of value.split('\n')) {
    if (logicalLine.length === 0) {
      rendered.push('');
      continue;
    }
    let column = 0;
    const lineWidth = visibleWidth(logicalLine);
    while (column < lineWidth) {
      rendered.push(sliceByColumn(logicalLine, column, safeWidth));
      column += safeWidth;
    }
  }
  return rendered.length > 0 ? rendered : [''];
}

export class AskResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;

  constructor(
    private readonly request: unknown,
    private readonly output: unknown,
    private readonly failure?: unknown
  ) {}

  render(width: number): string[] {
    const request = asRecord(this.request);
    const result = unwrapAskResult(this.output);
    const question =
      readString(request?.['message'])
      ?? readString(request?.['question'])
      ?? 'Question';
    const kind = readString(result?.['kind']) ?? readString(request?.['kind']) ?? 'input';

    if (this.failure !== undefined) {
      return new Markdown(`? ${question}\n\nError: ${formatValue(this.failure)}`).render(width);
    }

    const answer = result?.['answer'];
    return new Markdown(
      `? ${question}\n\nAnswer: ${formatAskAnswer(kind, answer, request)}`
    ).render(width);
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}

/** Compact, scrollable rendering of the access-aware fs_tree result. */
export class FileTreeResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;

  constructor(private readonly value: unknown) {}

  render(width: number): string[] {
    const payload = asRecord(this.value);
    const tree = asRecord(payload?.['tree']);
    const path = readString(payload?.['path']) ?? '.';
    if (!tree) {
      return [truncateToWidth(`\x1b[2m${path}: (empty or not accessible)\x1b[0m`, width)];
    }

    const lines: string[] = [];
    const state = { count: 0 };
    renderTreeNode(tree, '', true, 0, lines, state, width);
    const denied = typeof payload?.['denied'] === 'number' ? payload['denied'] : 0;
    if (denied > 0) {
      lines.push(truncateToWidth(
        `\x1b[33m(${denied} ${denied === 1 ? 'item' : 'items'} hidden — access restricted)\x1b[0m`,
        width
      ));
    }
    return lines;
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}

/** Compact tree renderer for ranked, access-aware fs_search results. */
export class FsSearchResult implements Component {
  _parent: import('@ai-team/tui').Container | null = null;

  constructor(private readonly value: unknown) {}

  render(width: number): string[] {
    const payload = unwrapResultPayload(this.value);
    const query = readString(payload?.['query']) ?? '';
    const mode = readString(payload?.['mode']) ?? 'names';
    const results = Array.isArray(payload?.['results'])
      ? payload['results'].map(asRecord).filter((item): item is Record<string, unknown> => !!item)
      : [];
    const total = typeof payload?.['totalMatches'] === 'number' ? payload['totalMatches'] : results.length;
    const returned = typeof payload?.['returnedMatches'] === 'number' ? payload['returnedMatches'] : results.length;
    const contentHits = typeof payload?.['contentHitsKnown'] === 'number' ? payload['contentHitsKnown'] : 0;
    const lines: string[] = [];

    lines.push(truncateToWidth(
      `\x1b[1m⌕ ${query}\x1b[0m \x1b[2m(${mode}, ${total} ${total === 1 ? 'match' : 'matches'})\x1b[0m`,
      width
    ));
    if (results.length === 0) {
      lines.push('\x1b[2m  No visible matches.\x1b[0m');
      return lines;
    }

    const root: SearchTreeNode = { children: new Map() };
    for (const result of results) {
      const filePath = readString(result['path']) ?? '?';
      const parts = filePath.split('/').filter(Boolean);
      let node = root;
      for (let index = 0; index < parts.length; index++) {
        const part = parts[index];
        let child = node.children.get(part);
        if (!child) {
          child = { children: new Map(), result: undefined };
          node.children.set(part, child);
        }
        node = child;
        if (index === parts.length - 1) node.result = result;
      }
    }

    const entries = [...root.children.entries()];
    for (let index = 0; index < entries.length; index++) {
      renderSearchNode(entries[index][0], entries[index][1], '', index === entries.length - 1, lines, width);
    }

    const truncated = payload?.['truncated'] === true;
    const summary = `\x1b[2mSummary: ${returned}/${total} files shown · ${contentHits} readable content hits${truncated ? ' · more matches available' : ''}\x1b[0m`;
    lines.push(truncateToWidth(summary, width));
    return lines;
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }
}

interface SearchTreeNode {
  children: Map<string, SearchTreeNode>;
  result?: Record<string, unknown>;
}

function renderSearchNode(
  name: string,
  node: SearchTreeNode,
  prefix: string,
  isLast: boolean,
  lines: string[],
  width: number
): void {
  const hasChildren = node.children.size > 0;
  const connector = prefix ? `${prefix}${isLast ? '└── ' : '├── '}` : '';
  const directory = hasChildren && !node.result;
  const label = directory ? `\x1b[1m${name}/\x1b[0m` : formatSearchFile(name, node.result);
  lines.push(truncateToWidth(`${connector}${label}`, width));

  if (node.result) {
    renderSearchDetails(node.result, `${prefix}${isLast ? '    ' : '│   '}`, lines, width);
  }
  if (!hasChildren) return;

  const childEntries = [...node.children.entries()];
  const childPrefix = prefix ? `${prefix}${isLast ? '    ' : '│   '}` : '';
  for (let index = 0; index < childEntries.length; index++) {
    renderSearchNode(childEntries[index][0], childEntries[index][1], childPrefix, index === childEntries.length - 1, lines, width);
  }
}

function formatSearchFile(name: string, result?: Record<string, unknown>): string {
  const readable = result?.['readable'] === true;
  const writable = result?.['writable'] === true;
  const icon = writable ? '\x1b[32m●\x1b[0m' : readable ? '\x1b[36m●\x1b[0m' : '\x1b[33m○\x1b[0m';
  return `${icon} ${name}`;
}

function renderSearchDetails(
  result: Record<string, unknown>,
  prefix: string,
  lines: string[],
  width: number
): void {
  const details: string[] = [];
  const matchedBy = Array.isArray(result['matchedBy']) ? result['matchedBy'].join(', ') : '';
  const lineNumbers = Array.isArray(result['lines']) ? result['lines'].join(', ') : '';
  const readable = result['readable'] === true;
  const writable = result['writable'] === true;
  details.push(`${matchedBy || 'match'}${lineNumbers ? ` · lines ${lineNumbers}` : ''} · ${writable ? 'read/write' : readable ? 'read-only' : 'name only'}`);

  const readers = formatPeople(result['readers']);
  const writers = formatPeople(result['writers']);
  if (readers) details.push(`readers: ${readers}`);
  if (writers) details.push(`writers: ${writers}`);
  const nextAction = readString(result['nextAction']);
  if (nextAction) details.push(`↳ ${nextAction}`);

  const snippets = Array.isArray(result['snippets']) ? result['snippets'] : [];
  for (const snippet of snippets.slice(0, 3)) {
    const item = asRecord(snippet);
    if (!item) continue;
    const line = typeof item['line'] === 'number' ? item['line'] : '?';
    const content = readString(item['content']) ?? '';
    details.push(`:${line} ${content}`);
  }
  for (const detail of details) {
    lines.push(truncateToWidth(`\x1b[2m${prefix}   ${detail}\x1b[0m`, width));
  }
}

function formatPeople(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value
    .map(asRecord)
    .filter((item): item is Record<string, unknown> => !!item)
    .map((item) => readString(item['label']) ?? readString(item['contextId']) ?? '?')
    .join(', ');
}

function unwrapResultPayload(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  const data = asRecord(record?.['data']);
  return data ?? record;
}

const TREE_MAX_DEPTH = 4;
const TREE_MAX_ITEMS = 60;

function renderTreeNode(
  node: Record<string, unknown>,
  prefix: string,
  isLast: boolean,
  depth: number,
  lines: string[],
  state: { count: number },
  width: number
): void {
  if (state.count++ >= TREE_MAX_ITEMS) return;
  const name = readString(node['name']) ?? readString(node['path']) ?? '?';
  const directory = node['isDirectory'] === true || Array.isArray(node['children']);
  const label = `${directory ? '\x1b[1m' : ''}${name}${directory ? '/' : ''}${directory ? '\x1b[0m' : ''}`;
  const rights = formatRights(node['rights']);
  const connector = depth === 0 ? '' : `${prefix}${isLast ? '└── ' : '├── '}`;
  const connectorStyle = depth === 0 ? '' : '\x1b[90m';
  const connectorEnd = depth === 0 ? '' : '\x1b[0m';
  lines.push(truncateToWidth(`${connectorStyle}${connector}${connectorEnd}${label}${rights}`, width));

  if (!directory || depth + 1 >= TREE_MAX_DEPTH) return;
  const children = Array.isArray(node['children'])
    ? node['children'].map(asRecord).filter((child): child is Record<string, unknown> => !!child)
    : [];
  children.sort((a, b) => {
    const aDir = a['isDirectory'] === true || Array.isArray(a['children']);
    const bDir = b['isDirectory'] === true || Array.isArray(b['children']);
    if (aDir !== bDir) return aDir ? -1 : 1;
    return (readString(a['name']) ?? '').localeCompare(readString(b['name']) ?? '');
  });
  const childPrefix = depth === 0 ? '' : `${prefix}${isLast ? '    ' : '│   '}`;
  for (let index = 0; index < children.length; index++) {
    if (state.count >= TREE_MAX_ITEMS) {
      lines.push(truncateToWidth(`${childPrefix}\x1b[2m… more\x1b[0m`, width));
      break;
    }
    renderTreeNode(children[index], childPrefix, index === children.length - 1, depth + 1, lines, state, width);
  }
}

function formatRights(value: unknown): string {
  const rights = asRecord(value);
  if (!rights) return '';
  const flags = `${rights['r'] === true ? 'r' : '-'}${rights['w'] === true ? 'w' : '-'}${rights['l'] === true ? 'l' : '-'}`;
  return ` \x1b[2m[${flags}]\x1b[0m`;
}

function unwrapAskResult(value: unknown): Record<string, unknown> | undefined {
  const record = asRecord(value);
  if (record?.['type'] === 'com_ask_result') return record;
  const data = asRecord(record?.['data']);
  return data?.['type'] === 'com_ask_result' ? data : record;
}

function formatAskAnswer(
  kind: string,
  answer: unknown,
  request: Record<string, unknown> | undefined
): string {
  if (kind === 'password') return '••••••••';
  const choices = Array.isArray(request?.['choices']) ? request?.['choices'] : [];
  const labels = new Map<string, string>();
  for (const choice of choices) {
    const record = asRecord(choice);
    const value = readString(record?.['value']);
    const name = readString(record?.['name']) ?? readString(record?.['label']);
    if (value && name) labels.set(value, name);
  }

  if (Array.isArray(answer)) {
    return answer.map((item) => labels.get(String(item)) ?? String(item)).join(', ');
  }
  if (typeof answer === 'string') return labels.get(answer) ?? answer;
  if (typeof answer === 'boolean') return answer ? 'Yes' : 'No';
  return formatValue(answer);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.message;
  if (value === undefined || value === null) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
