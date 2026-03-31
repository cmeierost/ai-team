/**
 * Slash-command aware input prompt for the interactive chat REPL.
 *
 * When the user types `/`, a filtered list of matching commands is rendered
 * below the current line. Navigation:
 *   ↑ / ↓   move selection
 *   Tab      apply the highlighted command's usage template
 *   Enter    submit (applies highlighted entry first if one is selected)
 *   Escape   dismiss the suggestion list
 *
 * Falls back to a plain `readline.question()` when stdin is not a TTY.
 */

import {
  createInterface,
  emitKeypressEvents,
  cursorTo,
  moveCursor,
  clearScreenDown,
} from 'node:readline';
import type { Key } from 'node:readline';
import { stdin as input, stdout as output } from 'node:process';
import { IN_CHAT_COMMAND_REGISTRY } from '@ai-team/service';
import chalk from 'chalk';

const MAX_VISIBLE = 7;

type CommandEntry = (typeof IN_CHAT_COMMAND_REGISTRY)[number];

function getSuggestions(buf: string): CommandEntry[] {
  if (!buf.startsWith('/')) return [];
  const fragment = buf.slice(1).toLowerCase();
  return IN_CHAT_COMMAND_REGISTRY.filter(cmd => {
    const keys = [cmd.key, ...(cmd.aliases ?? [])];
    return keys.some(k => k.startsWith(fragment));
  });
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
): number {
  cursorTo(output, 0);
  clearScreenDown(output);
  output.write(`${promptText} ${buf}`);

  const visible = suggs.slice(0, MAX_VISIBLE);
  let rows = 0;

  for (let i = 0; i < visible.length; i++) {
    const cmd = visible[i];
    const usage = cmd.usage ?? `/${cmd.key}`;
    const isSelected = i === selectedIdx;
    const line = isSelected
      ? chalk.bgBlue.white(` ${usage.padEnd(26)} `) + chalk.dim(`  ${cmd.description}`)
      : chalk.cyan(` ${usage}`) + chalk.dim(`  ${cmd.description}`);
    output.write(`\n${line}`);
    rows++;
  }

  if (suggs.length > MAX_VISIBLE) {
    output.write(`\n${chalk.dim(`  … ${suggs.length - MAX_VISIBLE} more`)}`);
    rows++;
  }

  // Move cursor back to end of user input
  if (rows > 0) {
    moveCursor(output, 0, -rows);
  }
  cursorTo(output, promptText.length + 1 + buf.length);

  return rows;
}

/**
 * Show an interactive prompt with real-time slash-command suggestions.
 * Falls back to a plain readline question when stdin is not a TTY.
 */
export async function askWithSlashSuggestions(
  promptText: string,
  signal?: AbortSignal,
): Promise<string> {
  if (!process.stdin.isTTY) {
    const rl = createInterface({ input, output });
    try {
      return (await (rl as any).question(`${promptText} `, { signal })).trim();
    } finally {
      rl.close();
    }
  }

  return new Promise<string>((resolve, reject) => {
    emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.resume();

    let buffer = '';
    let selectedIdx = -1;
    let dismissed = false;

    const rerender = () => {
      const suggs = dismissed ? [] : getSuggestions(buffer);
      selectedIdx = suggs.length === 0 ? -1 : Math.min(selectedIdx, suggs.length - 1);
      renderAll(promptText, buffer, suggs, selectedIdx);
    };

    const applySelection = (): boolean => {
      const suggs = getSuggestions(buffer);
      if (suggs.length === 0) return false;
      const idx = selectedIdx >= 0 ? selectedIdx : 0;
      const cmd = suggs[idx];
      if (!cmd) return false;
      buffer = cmd.usage ?? `/${cmd.key}`;
      selectedIdx = -1;
      dismissed = false;
      rerender();
      return true;
    };

    const finish = (value: string) => {
      cursorTo(output, 0);
      clearScreenDown(output);
      output.write(`${promptText} ${value}\n`);
      cleanup();
      resolve(value.trim());
    };

    const abort = () => {
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

      if (signal?.aborted) { abort(); return; }

      // Ctrl+C / Ctrl+D
      if (key.ctrl && (key.name === 'c' || key.name === 'd')) {
        abort();
        return;
      }

      // Enter
      if (key.name === 'return' || key.name === 'enter') {
        if (selectedIdx >= 0) applySelection();
        finish(buffer);
        return;
      }

      // Tab — apply top/selected suggestion
      if (key.name === 'tab') {
        applySelection();
        return;
      }

      // Arrow up
      if (key.name === 'up') {
        const suggs = getSuggestions(buffer);
        if (suggs.length > 0) {
          dismissed = false;
          selectedIdx = selectedIdx <= 0 ? suggs.length - 1 : selectedIdx - 1;
          renderAll(promptText, buffer, suggs, selectedIdx);
        }
        return;
      }

      // Arrow down
      if (key.name === 'down') {
        const suggs = getSuggestions(buffer);
        if (suggs.length > 0) {
          dismissed = false;
          selectedIdx = selectedIdx >= suggs.length - 1 ? 0 : selectedIdx + 1;
          renderAll(promptText, buffer, suggs, selectedIdx);
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
    output.write(`${promptText} `);
  });
}
