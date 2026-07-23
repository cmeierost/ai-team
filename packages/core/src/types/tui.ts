/**
 * Cross-package contracts for terminal UI implementations.
 *
 * Core owns these interfaces only. Rendering and process-specific behavior
 * remain in adapter packages such as @ai-team/tui and @ai-team/cli.
 */
export interface ITuiComponent {
  render(width: number): string[];
  handleInput?(data: string): void;
  invalidate(): void;
  remove(): void;
  _parent?: ITuiContainer | null;
}

export interface IFocusableTuiComponent extends ITuiComponent {
  focused: boolean;
}

export interface ITuiContainer extends ITuiComponent {
  children: ITuiComponent[];
  addChild(component: ITuiComponent): void;
  removeChild(component: ITuiComponent): void;
  clear(): void;
}

export interface ITerminal {
  readonly columns: number;
  readonly rows: number;
  write(data: string): void;
  hideCursor(): void;
  showCursor(): void;
  start(onInput: (data: string) => void, onResize: () => void): void;
  stop(): void;
}
