import { Markdown, type Component } from '@ai-team/tui';

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
