/**
 * Prompt component — renders a prompt line with cursor for user input.
 * Integrates with TUI input handling instead of fighting it.
 */

import {
  BracketedPaste,
  Component,
  CURSOR_MARKER,
  LineEditor,
  truncateToWidth,
  visibleWidth,
} from '@ai-team/tui';
import type { CommandDescriptor } from '@ai-team/api-contracts';

type SlashCommand = Pick<
  CommandDescriptor,
  'key' | 'aliases' | 'usage' | 'description'
>;

const CLI_LOCAL_COMMANDS: SlashCommand[] = [
  {
    key: 'exit',
    aliases: ['quit'],
    usage: 'exit',
    description: 'Exit the interactive CLI chat',
  },
  {
    key: 'q',
    usage: 'q',
    description: 'Exit the interactive CLI chat',
  },
];

/**
 * Prompt — displays a prompt text and collects user input via TUI.
 * Resolves a Promise when the user presses Enter.
 */
export class Prompt implements Component {
  _parent: import("@ai-team/tui").Container | null = null;
  private readonly editor: LineEditor;
  private readonly promptText: string;
  private readonly resolve: (value: string) => void;
  private readonly bracketedPaste = new BracketedPaste();
  private done = false;
  private dismissed = false;
  private selectedIndex = 0;
  public focused = false;

  constructor(
    promptText: string,
    resolve: (value: string) => void,
    private readonly commands: SlashCommand[] = []
  ) {
    this.promptText = promptText;
    this.editor = new LineEditor();
    this.resolve = resolve;
    const keys = new Set(this.commands.map((command) => command.key));
    this.commands = [
      ...this.commands,
      ...CLI_LOCAL_COMMANDS.filter((command) => !keys.has(command.key)),
    ];
  }

  get value(): string {
    return this.editor.value;
  }

  get isDone(): boolean {
    return this.done;
  }

  invalidate(): void {
    // No-op
  }

  remove(): void {
    const parent = this._parent;
    if (parent) {
      const idx = parent.children.indexOf(this);
      if (idx !== -1) {
        parent.children.splice(idx, 1);
      }
      this._parent = null;
    }
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width);
    const border = `\x1b[90m${'─'.repeat(safeWidth)}\x1b[0m`;
    const surface = '\x1b[48;5;236m\x1b[97m';

    // Keep an inactive composer row visible while the service is processing.
    if (this.done) {
      return [
        border,
        this.renderSurfaceLine(this.promptText, safeWidth, surface),
        border,
      ];
    }

    const input = this.editor.value;
    const cursorPos = this.editor.cursorPos;
    const prefix = this.promptText;

    const marker = this.focused ? CURSOR_MARKER : '';
    const inputLines = this.wrapInput(
      input,
      cursorPos,
      marker,
      prefix,
      Math.max(1, safeWidth - 2)
    );
    const lines = [
      border,
      ...inputLines.map((line) => this.renderSurfaceLine(line, safeWidth, surface)),
    ];
    const suggestions = this.suggestions();
    suggestions.slice(0, 6).forEach((command, index) => {
      const selected = index === this.selectedIndex;
      const invocation = `/${command.key}`;
      const usage = command.usage && command.usage !== command.key
        ? `  ${command.usage}`
        : '';
      const content = `${invocation}${usage}  ${command.description}`;
      const suggestion = selected
        ? `\x1b[7m ${content} \x1b[27m`
        : ` \x1b[36m${invocation}\x1b[97m\x1b[2m${usage}  ${command.description}\x1b[22m`;
      lines.push(this.renderSurfaceLine(suggestion, safeWidth, surface));
    });
    lines.push(border);
    return lines;
  }

  private renderSurfaceLine(content: string, width: number, surface: string): string {
    const reset = '\x1b[0m';
    const persistent = content.replaceAll(reset, `${reset}${surface}`);
    const paddedContent = truncateToWidth(` ${persistent}`, Math.max(1, width - 1));
    const padding = ' '.repeat(Math.max(0, width - visibleWidth(paddedContent)));
    return `${surface}${paddedContent}${padding}${reset}`;
  }

  handleInput(data: string): void {
    const pasteResult = this.bracketedPaste.process(data);
    if (pasteResult.pasted !== undefined) {
      // ConPTY/PowerShell may deliver pasted line breaks as CR, CRLF, or LF.
      // Normalize them before inserting so the first line is not interpreted
      // as a terminal return and every pasted line remains visible/editable.
      this.editor.insertText(pasteResult.pasted.replace(/\r\n?/g, '\n'));
    }
    if (pasteResult.remaining === undefined) {
      return;
    }
    data = pasteResult.remaining;

    if (this.isModifiedEnter(data)) {
      this.editor.insertText('\n');
      this.dismissed = true;
      return;
    }

    const suggestions = this.suggestions();
    if (suggestions.length > 0 && (data === '\x1b[A' || data === '\x1b[B')) {
      const direction = data === '\x1b[A' ? -1 : 1;
      this.selectedIndex =
        (this.selectedIndex + direction + suggestions.length) % suggestions.length;
      return;
    }
    if (suggestions.length > 0 && (data === '\t' || data === '\x1b[C')) {
      this.applySuggestion(suggestions[this.selectedIndex] ?? suggestions[0]);
      return;
    }
    if (data === '\x1b') {
      this.dismissed = true;
      return;
    }

    // Handle Enter key
    if (data === '\r') {
      if (suggestions.length > 0) {
        this.applySuggestion(suggestions[this.selectedIndex] ?? suggestions[0]);
      }
      const value = this.editor.value.trim();
      this.done = true;
      this.resolve(value);
      return;
    }

    // Handle Ctrl+C
    if (data === '\x03') {
      this.done = true;
      this.resolve('');
      return;
    }

    this.editor.handleInput(data);
    this.dismissed = false;
    this.selectedIndex = 0;
    // Force re-render so typed character appears
    this.invalidate();
  }

  private suggestions(): SlashCommand[] {
    if (
      this.dismissed
      || !this.editor.value.startsWith('/')
      || this.editor.value.includes('\n')
    ) return [];
    const fragment = this.editor.value.slice(1).toLowerCase();
    return this.commands
      .filter((command) =>
        [command.key, ...(command.aliases ?? [])]
          .map((candidate) => candidate.toLowerCase())
          .some((candidate) => candidate.startsWith(fragment))
      )
      .sort((left, right) => left.key.localeCompare(right.key));
  }

  private applySuggestion(command: SlashCommand | undefined): void {
    if (!command) return;
    const usage = command.usage?.trim();
    const value = !usage
      ? `/${command.key}`
      : usage.startsWith('/')
        ? usage
        : usage === command.key || usage.startsWith(`${command.key} `)
          ? `/${usage}`
          : `/${command.key}`;
    this.editor.reset(value);
    this.dismissed = true;
  }

  private isModifiedEnter(data: string): boolean {
    return (
      data === '\n'
      || data === '\x1b\r'
      || data === '\x1b\n'
      // Kitty keyboard protocol and terminals that encode modified Enter as
      // a CSI key code (both `u` and legacy `~` forms).
      || /^\x1b\[13;(?:2|3|5)u$/.test(data)
      || /^\x1b\[13;(?:2|3|5)~$/.test(data)
    );
  }

  private wrapInput(
    input: string,
    cursorPos: number,
    marker: string,
    prefix: string,
    width: number
  ): string[] {
    const continuation = '  ';
    const lines: string[] = [];
    let line = prefix;
    let lineWidth = visibleWidth(prefix);
    let offset = 0;

    const appendMarker = () => {
      line += marker;
    };

    for (const char of input) {
      if (char === '\n') {
        if (offset === cursorPos) appendMarker();
        lines.push(line);
        line = continuation;
        lineWidth = visibleWidth(continuation);
        offset += char.length;
        continue;
      }

      const charWidth = visibleWidth(char);
      if (lineWidth + charWidth > width && lineWidth > visibleWidth(continuation)) {
        lines.push(line);
        line = continuation;
        lineWidth = visibleWidth(continuation);
      }
      if (offset === cursorPos) appendMarker();
      line += char;
      lineWidth += charWidth;
      offset += char.length;
    }
    if (offset === cursorPos) appendMarker();
    lines.push(line);
    return lines;
  }
}
