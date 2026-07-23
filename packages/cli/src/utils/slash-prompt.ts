/**
 * Slash-command aware input prompt for the interactive chat REPL.
 *
 * When the user types `/`, a filtered list of matching commands is rendered
 * below the current line. Navigation:
 *   ↑ / ↓   move selection
 *   Tab/→    apply the highlighted command's usage template
 *   Enter    submit (auto-applies if one command matches, or when one is highlighted)
 *   Escape   dismiss the suggestion list
 *
 * Falls back to a plain `readline.question()` when stdin is not a TTY.
 */

import {
  emitKeypressEvents,
  cursorTo,
  moveCursor,
  clearScreenDown,
} from 'node:readline';
import type { Key } from 'node:readline';
import { stdout as output } from 'node:process';
import type { CommandDescriptor } from '@ai-team/api-contracts';
import chalk from 'chalk';

const MAX_VISIBLE = 7;
const MAX_DESCRIPTION_CHARS = 72;
const MAX_USAGE_HINT_CHARS = 36;

type CommandEntry = Pick<
  CommandDescriptor,
  'key' | 'group' | 'aliases' | 'usage' | 'description' | 'path'
>;

function normalizePromptPrefix(promptText: string): string {
  return promptText.endsWith(' ') ? promptText : `${promptText} `;
}

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  if (maxChars <= 1) return text.slice(0, maxChars);
  return `${text.slice(0, maxChars - 1)}…`;
}

function isDynamicSkillCommand(cmd: CommandEntry): boolean {
  return Array.isArray(cmd.path) && cmd.path[0] === 'dynamic' && cmd.path[1] === 'skill';
}

function isDynamicCommand(cmd: CommandEntry): boolean {
  return Array.isArray(cmd.path) && cmd.path[0] === 'dynamic';
}

function commandSortRank(cmd: CommandEntry): number {
  return isDynamicSkillCommand(cmd) ? 1 : 0;
}

function normalizeAppliedSlashUsage(cmd: CommandEntry): string {
  const usage = cmd.usage?.trim();
  if (!usage) {
    return `/${cmd.key}`;
  }

  if (usage.startsWith('/')) {
    return usage;
  }

  if (usage === cmd.key || usage.startsWith(`${cmd.key} `)) {
    return `/${usage}`;
  }

  return `/${cmd.key}`;
}

/** Strip ANSI escape codes to measure visible character width. */
function visibleLength(str: string): number {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').length;
}

/** How many terminal rows does a piece of text occupy when printed (no leading \n). */
function textRows(text: string, columns: number): number {
  const len = visibleLength(text);
  return Math.max(1, Math.ceil(len / columns));
}

function measureInputRows(promptText: string, buf: string): number {
  const columns = Math.max(1, output.columns ?? 80);
  const textLen = Math.max(1, visibleLength(promptText) + buf.length);
  return Math.max(1, Math.ceil(textLen / columns));
}

function resolveCursorPosition(
  promptText: string,
  buf: string
): { rowOffset: number; column: number } {
  const columns = Math.max(1, output.columns ?? 80);
  const absoluteCol = visibleLength(promptText) + buf.length;
  return {
    rowOffset: Math.floor(absoluteCol / columns),
    column: absoluteCol % columns,
  };
}

function getSuggestions(commands: CommandEntry[], buf: string): CommandEntry[] {
  if (!buf.startsWith('/')) return [];
  const fragments = buf
    .slice(1)
    .trimStart()
    .split(/\s+/)
    .filter(Boolean)
    .map((fragment) => fragment.toLowerCase());
  const [groupFragment = '', keyFragment = ''] = fragments;
  return commands
    .filter((cmd) => {
      if (isDynamicCommand(cmd)) {
        return fragments.length <= 1 && cmd.key.toLowerCase().startsWith(groupFragment);
      }
      if (fragments.length > 1) {
        return (
          (cmd.group ?? '').toLowerCase().startsWith(groupFragment) &&
          cmd.key.toLowerCase().startsWith(keyFragment)
        );
      }
      return (
        (cmd.group ?? '').toLowerCase().startsWith(groupFragment) ||
        (cmd.aliases ?? []).some((alias) => alias.toLowerCase().startsWith(groupFragment))
      );
    })
    .sort((left, right) => {
      const leftRank = commandSortRank(left);
      const rightRank = commandSortRank(right);
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.key.localeCompare(right.key);
    });
}

function shouldApplySelectionOnEnter(
  buffer: string,
  suggestions: CommandEntry[],
  selectedIdx: number
): boolean {
  if (!buffer.startsWith('/')) return false;
  if (selectedIdx >= 0 && suggestions.length > 0) return true;
  return suggestions.length === 1;
}

/**
 * Full re-render: move to column 0, clear to end of screen, re-print prompt +
 * buffer + suggestions, then put cursor back at the end of the user's input.
 */
function renderAll(
  promptText: string,
  buf: string,
  suggs: CommandEntry[],
  selectedIdx: number,
  previousInputRows: number
): number {
  if (previousInputRows > 1) {
    moveCursor(output, 0, -(previousInputRows - 1));
  }
  cursorTo(output, 0);
  clearScreenDown(output);
  output.write(`${promptText}${buf}`);

  const inputRows = measureInputRows(promptText, buf);

  // Compute a scroll window so the selected item is always visible.
  const clampedIdx = Math.max(0, selectedIdx);
  const windowStart = Math.min(
    Math.max(0, clampedIdx - MAX_VISIBLE + 1),
    Math.max(0, suggs.length - MAX_VISIBLE)
  );
  const visible = suggs.slice(windowStart, windowStart + MAX_VISIBLE);
  const columns = Math.max(1, output.columns ?? 80);
  let rows = 0;

  if (windowStart > 0) {
    const line = chalk.dim(`  ↑ ${windowStart} more above`);
    output.write(`\n${line}`);
    rows += textRows(line, columns);
  }

  for (let i = 0; i < visible.length; i++) {
    const cmd = visible[i];
    const invocation = cmd.usage ?? `/${cmd.key}`;
    const aliasHint =
      (cmd.aliases?.length ?? 0) > 0
        ? ` (aliases: ${(cmd.aliases ?? []).map((alias) => `/${alias}`).join(', ')})`
        : '';
    const description = truncateText(cmd.description, MAX_DESCRIPTION_CHARS);
    const kindHint = isDynamicSkillCommand(cmd) ? ' [skill]' : '';
    const isSelected = windowStart + i === selectedIdx;
    const line = isSelected
      ? chalk.bgBlue.white(` ${invocation.padEnd(26)} `) +
        chalk.dim(`  ${description}${aliasHint}${kindHint}`)
      : chalk.cyan(` ${invocation}`) + chalk.dim(`  ${description}${aliasHint}${kindHint}`);
    output.write(`\n${line}`);
    rows += textRows(line, columns);
  }

  const remaining = suggs.length - (windowStart + visible.length);
  if (remaining > 0) {
    const line = chalk.dim(`  ↓ ${remaining} more below`);
    output.write(`\n${line}`);
    rows += textRows(line, columns);
  }

  // Move cursor back to end of user input
  if (rows > 0) {
    moveCursor(output, 0, -rows);
  }

  const cursor = resolveCursorPosition(promptText, buf);
  if (cursor.rowOffset > 0) {
    moveCursor(output, 0, cursor.rowOffset);
  }
  cursorTo(output, cursor.column);

  return inputRows;
}

/**
 * Show an interactive prompt with real-time slash-command suggestions.
 * Falls back to a plain readline question when stdin is not a TTY.
 */
export async function askWithSlashSuggestions(
  promptText: string,
  commands: CommandEntry[],
  signal?: AbortSignal
): Promise<string> {
  const promptPrefix = normalizePromptPrefix(promptText);

  if (!process.stdin.isTTY) {
    // Avoid readline.question() which adds "?" prefix and "✔" suffix.
    output.write(promptPrefix);
    return new Promise<string>((resolve) => {
      process.stdin.once('data', (data) => {
        resolve(String(data).trim());
      });
      if (signal) {
        signal.addEventListener('abort', () => resolve(''), { once: true });
      }
    });
  }

  return new Promise<string>((resolve, reject) => {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let buffer = '';
    let selectedIdx = -1;
    let dismissed = false;
    let currentInputRows = 1;

    const rerender = () => {
      const suggs = dismissed ? [] : getSuggestions(commands, buffer);
      selectedIdx = suggs.length === 0 ? -1 : Math.min(selectedIdx, suggs.length - 1);
      currentInputRows = renderAll(promptPrefix, buffer, suggs, selectedIdx, currentInputRows);
    };

    const applySelection = (): boolean => {
      const suggs = getSuggestions(commands, buffer);
      if (suggs.length === 0) return false;
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      const cmd = suggs[idx];
      if (!cmd) return false;
      buffer = normalizeAppliedSlashUsage(cmd);
      selectedIdx = -1;
      dismissed = false;
      rerender();
      return true;
    };

    const finish = (value: string) => {
      // Clear the interactive prompt line and any suggestion UI so we don't
      // re-show submitted input in a way that can look like a duplicated turn.
      if (currentInputRows > 1) {
        moveCursor(output, 0, -(currentInputRows - 1));
      }
      cursorTo(output, 0);
      clearScreenDown(output);
      output.write('\n');
      cleanup();
      resolve(value.trim());
    };

    const abort = () => {
      if (currentInputRows > 1) {
        moveCursor(output, 0, -(currentInputRows - 1));
      }
      cursorTo(output, 0);
      clearScreenDown(output);
      output.write('\n');
      cleanup();
      reject(Object.assign(new Error('AbortError'), { name: 'AbortError' }));
    };

    const cleanup = () => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off('keypress', onKey);
    };

    const onKey = (_str: string | undefined, key: Key) => {
      if (!key) return;

      if (signal?.aborted) {
        abort();
        return;
      }

      // Ctrl+C / Ctrl+D
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        abort();
        return;
      }

      // Enter
      if (key.name === 'return' || key.name === 'enter') {
        const suggestions = getSuggestions(commands, buffer);
        if (shouldApplySelectionOnEnter(buffer, suggestions, selectedIdx)) {
          applySelection();
        }
        finish(buffer);
        return;
      }

      // Tab/Right Arrow — apply top/selected suggestion
      if (key.name === 'tab' || key.name === 'right') {
        applySelection();
        return;
      }

      // Arrow up
      if (key.name === 'up') {
        const suggs = getSuggestions(commands, buffer);
        if (suggs.length > 0) {
          dismissed = false;
          selectedIdx = selectedIdx <= 0 ? suggs.length - 1 : selectedIdx - 1;
          currentInputRows = renderAll(promptPrefix, buffer, suggs, selectedIdx, currentInputRows);
        }
        return;
      }

      // Arrow down
      if (key.name === 'down') {
        const suggs = getSuggestions(commands, buffer);
        if (suggs.length > 0) {
          dismissed = false;
          selectedIdx = selectedIdx >= suggs.length - 1 ? 0 : selectedIdx + 1;
          currentInputRows = renderAll(promptPrefix, buffer, suggs, selectedIdx, currentInputRows);
        }
        return;
      }

      // Escape — dismiss suggestions
      if (key.name === 'escape') {
        dismissed = true;
        selectedIdx = -1;
        rerender();
        return;
      }

      // Backspace
      if (key.name === 'backspace' || key.name === 'delete') {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          dismissed = false;
          selectedIdx = -1;
          rerender();
        }
        return;
      }

      // Ctrl+U — clear line
      if (key.ctrl && key.name === 'u') {
        buffer = '';
        dismissed = false;
        selectedIdx = -1;
        rerender();
        return;
      }

      // Regular printable character
      if (_str && !key.ctrl && !key.meta) {
        buffer += _str;
        dismissed = false;
        selectedIdx = -1;
        rerender();
      }
    };

    if (signal) {
      signal.addEventListener('abort', abort, { once: true });
    }

    process.stdin.on('keypress', onKey);
    output.write(promptPrefix);
  });
}

export const SLASH_PROMPT_TESTING = {
  getSuggestions,
  shouldApplySelectionOnEnter,
  normalizeAppliedSlashUsage,
  normalizePromptPrefix,
  renderAll,
};
