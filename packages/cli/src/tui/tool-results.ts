import { Markdown, truncateToWidth, type Component } from '@ai-team/tui';

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
