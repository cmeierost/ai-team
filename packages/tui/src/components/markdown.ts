/**
 * Terminal Markdown renderer for streamed assistant responses.
 *
 * Parsing is delegated to marked; this component owns presentation only.
 */

import { marked } from 'marked';
import type { Component } from '../component.js';
import { sliceByColumn, visibleWidth } from '../utils.js';

export interface MarkdownTheme {
  defaultColor?: { r: number; g: number; b: number };
}

interface MarkdownToken {
  type: string;
  text?: string;
  lang?: string;
  href?: string;
  ordered?: boolean;
  start?: number;
  items?: MarkdownToken[];
  tokens?: MarkdownToken[];
}

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const UNDERLINE = '\x1b[4m';
const CYAN = '\x1b[36m';
const ANSI_SEQUENCE = /\x1b\[[0-?]*[ -/]*[@-~]/g;

export class Markdown implements Component {
  _parent: import('../component.js').Container | null = null;
  private invalidated = true;
  private cachedWidth = 0;
  private cachedLines: string[] = [];

  constructor(
    private text: string,
    private readonly theme: MarkdownTheme = {}
  ) {}

  setText(text: string): void {
    this.text = text;
    this.invalidate();
  }

  remove(): void {
    this._parent?.removeChild(this);
  }

  invalidate(): void {
    this.invalidated = true;
  }

  render(width: number): string[] {
    if (!this.invalidated && this.cachedWidth === width) return this.cachedLines;

    const tokens = marked.lexer(this.text) as MarkdownToken[];
    this.cachedLines = this.renderBlocks(tokens, Math.max(1, width));
    this.cachedWidth = width;
    this.invalidated = false;
    return this.cachedLines;
  }

  private renderBlocks(tokens: MarkdownToken[], width: number): string[] {
    const lines: string[] = [];

    for (const token of tokens) {
      switch (token.type) {
        case 'space':
          if (lines.at(-1) !== '') lines.push('');
          break;
        case 'heading':
          lines.push(...this.wrap(`${BOLD}${CYAN}${this.inline(token.tokens, token.text)}${RESET}`, width));
          break;
        case 'paragraph':
        case 'text':
          lines.push(...this.wrap(this.color(this.inline(token.tokens, token.text)), width));
          break;
        case 'code':
          lines.push(...this.renderCode(token, width));
          break;
        case 'blockquote': {
          const quoted = this.renderBlocks(token.tokens ?? [], Math.max(1, width - 2));
          lines.push(...quoted.map((line) => `${DIM}│${RESET} ${line}`));
          break;
        }
        case 'list':
          lines.push(...this.renderList(token, width));
          break;
        case 'hr':
          lines.push(`${DIM}${'─'.repeat(Math.max(1, width))}${RESET}`);
          break;
        default:
          if (token.tokens?.length) {
            lines.push(...this.renderBlocks(token.tokens, width));
          } else if (token.text) {
            lines.push(...this.wrap(this.color(token.text), width));
          }
      }
    }

    while (lines.at(-1) === '') lines.pop();
    return lines.length > 0 ? lines : [''];
  }

  private renderCode(token: MarkdownToken, width: number): string[] {
    const language = token.lang?.trim();
    const title = language ? ` ${language} ` : '';
    const borderWidth = Math.max(1, width - visibleWidth(title) - 2);
    const lines = [`${DIM}╭─${title}${'─'.repeat(borderWidth)}${RESET}`];
    const contentWidth = Math.max(1, width - 2);

    for (const sourceLine of (token.text ?? '').split('\n')) {
      const wrapped = this.wrap(`${CYAN}${sourceLine}${RESET}`, contentWidth);
      lines.push(...wrapped.map((line) => `${DIM}│${RESET} ${line}`));
    }
    lines.push(`${DIM}╰${'─'.repeat(Math.max(1, width - 1))}${RESET}`);
    return lines;
  }

  private renderList(token: MarkdownToken, width: number): string[] {
    const lines: string[] = [];
    const start = token.start ?? 1;
    for (const [index, item] of (token.items ?? []).entries()) {
      const marker = token.ordered ? `${start + index}. ` : '• ';
      const content = this.inline(item.tokens, item.text);
      const wrapped = this.wrap(this.color(content), Math.max(1, width - visibleWidth(marker)));
      wrapped.forEach((line, lineIndex) => {
        lines.push(`${lineIndex === 0 ? marker : ' '.repeat(visibleWidth(marker))}${line}`);
      });
    }
    return lines;
  }

  private inline(tokens?: MarkdownToken[], fallback = ''): string {
    if (!tokens?.length) return fallback;
    return tokens.map((token) => this.inlineToken(token)).join('');
  }

  private inlineToken(token: MarkdownToken): string {
    const content = this.inline(token.tokens, token.text ?? '');
    switch (token.type) {
      case 'strong':
        return `${BOLD}${content}\x1b[22m`;
      case 'em':
        return `${ITALIC}${content}\x1b[23m`;
      case 'del':
        return `\x1b[9m${content}\x1b[29m`;
      case 'codespan':
        return `${CYAN}${content}${RESET}${this.defaultColor()}`;
      case 'link':
        return `${UNDERLINE}${content}\x1b[24m${DIM} (${token.href ?? ''})\x1b[22m`;
      case 'br':
        return '\n';
      default:
        return content;
    }
  }

  private color(text: string): string {
    const color = this.defaultColor();
    return color ? `${color}${text}${RESET}` : text;
  }

  private defaultColor(): string {
    const color = this.theme.defaultColor;
    return color ? `\x1b[38;2;${color.r};${color.g};${color.b}m` : '';
  }

  private wrap(line: string, width: number): string[] {
    const safeWidth = Math.max(1, width);
    const sourceLines = line.split('\n');
    const result: string[] = [];
    for (const source of sourceLines) {
      const sourceWidth = visibleWidth(source);
      if (sourceWidth <= safeWidth) {
        result.push(source);
        continue;
      }

      let offset = 0;
      while (offset < sourceWidth) {
        const remainingWidth = sourceWidth - offset;
        if (remainingWidth <= safeWidth) {
          result.push(`${sliceByColumn(source, offset, remainingWidth)}${RESET}`);
          break;
        }

        const candidate = sliceByColumn(source, offset, safeWidth);
        const visibleCandidate = candidate.replaceAll(ANSI_SEQUENCE, '');
        const whitespaceRuns = Array.from(visibleCandidate.matchAll(/\s+/g)).filter(
          (match) => (match.index ?? 0) > 0
        );
        const lastWhitespace = whitespaceRuns.at(-1);
        const breakWidth = lastWhitespace
          ? visibleWidth(visibleCandidate.slice(0, lastWhitespace.index))
          : safeWidth;

        result.push(`${sliceByColumn(source, offset, breakWidth)}${RESET}`);
        offset += breakWidth;

        if (lastWhitespace) {
          offset += visibleWidth(lastWhitespace[0]);
        }
      }
    }
    return result;
  }
}
