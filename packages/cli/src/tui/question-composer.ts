import type {
  IQuestionService,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  QuestionSelectChoice,
} from '@ai-team/core';
import {
  CURSOR_MARKER,
  LineEditor,
  type Component,
  truncateToWidth,
  visibleWidth,
} from '@ai-team/tui';
import type { TUI } from '@ai-team/tui';
import type { ChatLayout } from './chat-layout.js';

type QuestionSpec =
  | ({ kind: 'input' } & QuestionInputRequest)
  | ({ kind: 'password' } & QuestionPasswordRequest)
  | ({ kind: 'confirm' } & QuestionConfirmRequest)
  | ({ kind: 'select' } & QuestionSelectRequest)
  | ({ kind: 'checklist' } & QuestionChecklistRequest);

export class TuiQuestionPresenter implements IQuestionService {
  private readonly pending = new Set<TuiQuestion>();

  constructor(
    private readonly layout: ChatLayout,
    private readonly tui: TUI
  ) {}

  input(request: QuestionInputRequest): Promise<string> {
    return this.ask({ kind: 'input', ...request }) as Promise<string>;
  }

  password(request: QuestionPasswordRequest): Promise<string> {
    return this.ask({ kind: 'password', ...request }) as Promise<string>;
  }

  confirm(request: QuestionConfirmRequest): Promise<boolean> {
    return this.ask({ kind: 'confirm', ...request }) as Promise<boolean>;
  }

  select(request: QuestionSelectRequest): Promise<string> {
    if (request.choices.length === 0) {
      return Promise.reject(new Error('Select question has no valid choices.'));
    }
    return this.ask({ kind: 'select', ...request }) as Promise<string>;
  }

  checklist(request: QuestionChecklistRequest): Promise<string[]> {
    if (request.choices.length === 0) {
      return Promise.reject(new Error('Checklist question has no valid choices.'));
    }
    return this.ask({ kind: 'checklist', ...request }) as Promise<string[]>;
  }

  abort(reason: unknown = new Error('Question aborted')): void {
    for (const question of [...this.pending]) question.abort(reason);
  }

  private ask(spec: QuestionSpec): Promise<unknown> {
    let restore = () => {};
    const question = new TuiQuestion(spec, () => {
      this.pending.delete(question);
      restore();
      this.tui.invalidate();
    });
    this.pending.add(question);
    restore = this.layout.pushComposer(question);
    this.tui.setFocused(this.layout);
    this.tui.invalidate();
    return question.answer;
  }
}

class TuiQuestion implements Component {
  _parent: import('@ai-team/tui').Container | null = null;
  focused = false;
  readonly answer: Promise<unknown>;
  private readonly editor = new LineEditor();
  private readonly selected = new Set<string>();
  private selectedIndex = 0;
  private error?: string;
  private settled = false;
  private enteringOther = false;
  private resolveAnswer!: (value: unknown) => void;
  private rejectAnswer!: (reason: unknown) => void;

  constructor(
    private readonly spec: QuestionSpec,
    private readonly onSettled: () => void
  ) {
    this.answer = new Promise((resolve, reject) => {
      this.resolveAnswer = resolve;
      this.rejectAnswer = reject;
    });
    if (spec.kind === 'select' && spec.default) {
      const index = this.options.findIndex((choice) => choice.value === spec.default);
      if (index >= 0) this.selectedIndex = index;
    }
    if (spec.kind === 'confirm' && spec.default === false) this.selectedIndex = 1;
    if (spec.kind === 'checklist') {
      for (const value of spec.default ?? []) this.selected.add(value);
    }
  }

  handleInput(data: string): void {
    if (this.settled) return;
    this.error = undefined;
    if (this.enteringOther) {
      this.handleOtherInput(data);
      return;
    }

    if (this.spec.kind === 'input' || this.spec.kind === 'password') {
      if (data === '\r') {
        const value = this.editor.value;
        if (this.spec.kind === 'input' && this.spec.validate) {
          const result = this.spec.validate(value);
          if (result !== true) {
            this.error = result;
            return;
          }
        }
        this.resolve(value);
        return;
      }
      this.editor.handleInput(data);
      return;
    }

    if (this.spec.kind === 'confirm') {
      if (data === '\x1b[D' || data === '\x1b[A') this.selectedIndex = 0;
      else if (data === '\x1b[C' || data === '\x1b[B') this.selectedIndex = 1;
      else if (/^[yY]$/.test(data)) this.resolve(true);
      else if (/^[nN]$/.test(data)) this.resolve(false);
      else if (data === '\r') {
        const defaultIndex = this.spec.default === undefined ? this.selectedIndex : (this.spec.default ? 0 : 1);
        this.resolve(defaultIndex === 0);
      }
      return;
    }

    const options = this.options;
    if (data === '\x1b[A') {
      this.selectedIndex = (this.selectedIndex - 1 + options.length) % options.length;
      return;
    }
    if (data === '\x1b[B') {
      this.selectedIndex = (this.selectedIndex + 1) % options.length;
      return;
    }
    if (this.spec.kind === 'select' && data === '\r') {
      const option = options[this.selectedIndex];
      if (option?.other) this.enterOther();
      else if (option) this.resolve(option.value);
      return;
    }
    if (this.spec.kind === 'checklist' && (data === ' ' || data === '\r')) {
      if (data === '\r') {
        this.submitChecklist();
        return;
      }
      const option = options[this.selectedIndex];
      if (!option) return;
      if (option.other) {
        this.enterOther();
      } else if (this.selected.has(option.value)) {
        this.selected.delete(option.value);
      } else {
        const max = this.spec.maxSelections;
        if (max !== undefined && this.selected.size >= max) {
          this.error = `Select at most ${max} option(s).`;
        } else {
          this.selected.add(option.value);
        }
      }
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const otherPrompt =
      (this.spec.kind === 'select' || this.spec.kind === 'checklist')
        ? this.spec.otherPrompt
        : undefined;
    const lines = [
      border(safeWidth),
      surface(this.enteringOther ? (otherPrompt ?? 'Other value:') : this.spec.message, safeWidth),
    ];

    if (this.enteringOther || this.spec.kind === 'input' || this.spec.kind === 'password') {
      lines.push(surface(`> ${this.renderEditorValue()}`, safeWidth));
    } else if (this.spec.kind === 'confirm') {
      const yes = this.spec.style === 'allow' ? 'Allow' : 'Yes';
      const no = this.spec.style === 'allow' ? 'Deny' : 'No';
      lines.push(surface(
        `${this.selectedIndex === 0 ? '\x1b[7m' : ''} ${yes} \x1b[27m  `
        + `${this.selectedIndex === 1 ? '\x1b[7m' : ''} ${no} \x1b[27m`,
        safeWidth
      ));
    } else {
      for (const [index, choice] of this.options.entries()) {
        const active = index === this.selectedIndex ? '›' : ' ';
        const checked = this.spec.kind === 'checklist'
          ? (this.selected.has(choice.value) ? '[x]' : '[ ]')
          : '   ';
        const recommended = choice.recommended ? ' ★' : '';
        lines.push(surface(`${active} ${checked} ${choice.name}${recommended}`, safeWidth));
        if (choice.description) lines.push(surface(`      \x1b[2m${choice.description}\x1b[22m`, safeWidth));
      }
    }
    if (this.error) lines.push(surface(`\x1b[31m${this.error}\x1b[0m`, safeWidth));
    lines.push(surface(
      this.spec.kind === 'checklist'
        ? '\x1b[2m↑↓ move · Space toggle · Enter submit\x1b[22m'
        : '\x1b[2mEnter submit\x1b[22m',
      safeWidth
    ));
    lines.push(border(safeWidth));
    return lines;
  }

  abort(reason: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectAnswer(reason);
    this.onSettled();
  }

  invalidate(): void {}

  remove(): void {
    this._parent?.removeChild(this);
  }

  private get options(): Array<QuestionSelectChoice & { other?: boolean }> {
    if (this.spec.kind !== 'select' && this.spec.kind !== 'checklist') return [];
    const recommended = new Set(this.spec.recommended ?? []);
    const choices: Array<QuestionSelectChoice & { other?: boolean }> = this.spec.choices.map((choice) => ({
      ...choice,
      recommended: choice.recommended === true || recommended.has(choice.value),
    }));
    if (this.spec.allowOther) {
      choices.push({
        name: this.spec.otherLabel ?? 'Other',
        value: '__other__',
        other: true,
      });
    }
    return choices;
  }

  private renderEditorValue(): string {
    const value = this.editor.value;
    const cursor = this.editor.cursorPos;
    const before = value.slice(0, cursor);
    const after = value.slice(cursor);
    const password = this.spec.kind === 'password' && !this.enteringOther;
    const renderedBefore = password ? maskValue(before, this.spec.mask) : before;
    const renderedAfter = password ? maskValue(after, this.spec.mask) : after;
    return `${renderedBefore}${this.focused ? CURSOR_MARKER : ''}${renderedAfter}`;
  }

  private handleOtherInput(data: string): void {
    if (data === '\x1b') {
      this.enteringOther = false;
      this.editor.reset();
      return;
    }
    if (data !== '\r') {
      this.editor.handleInput(data);
      return;
    }
    const value = this.editor.value.trim();
    if (!value) {
      this.error = 'Enter a value.';
      return;
    }
    if (this.spec.kind === 'select') {
      this.resolve(value);
      return;
    }
    if (this.spec.kind === 'checklist') {
      const max = this.spec.maxSelections;
      if (max !== undefined && this.selected.size >= max) {
        this.error = `Select at most ${max} option(s).`;
        return;
      }
      this.selected.add(value);
      this.enteringOther = false;
      this.editor.reset();
    }
  }

  private enterOther(): void {
    this.enteringOther = true;
    this.editor.reset();
  }

  private submitChecklist(): void {
    if (this.spec.kind !== 'checklist') return;
    const values = [...this.selected];
    if (this.spec.minSelections !== undefined && values.length < this.spec.minSelections) {
      this.error = `Select at least ${this.spec.minSelections} option(s).`;
      return;
    }
    if (this.spec.maxSelections !== undefined && values.length > this.spec.maxSelections) {
      this.error = `Select at most ${this.spec.maxSelections} option(s).`;
      return;
    }
    this.resolve(values);
  }

  private resolve(value: unknown): void {
    if (this.settled) return;
    this.settled = true;
    this.resolveAnswer(value);
    this.onSettled();
  }
}

function maskValue(value: string, mask = '*'): string {
  return Array.from(value).map(() => mask || '*').join('');
}

function border(width: number): string {
  return `\x1b[90m${'─'.repeat(width)}\x1b[0m`;
}

function surface(content: string, width: number): string {
  const prefix = '\x1b[48;5;236m\x1b[97m';
  const reset = '\x1b[0m';
  const persistent = content.replaceAll(reset, `${reset}${prefix}`);
  const clipped = truncateToWidth(` ${persistent}`, Math.max(1, width - 1));
  const padding = ' '.repeat(Math.max(0, width - visibleWidth(clipped)));
  return `${prefix}${clipped}${padding}${reset}`;
}
