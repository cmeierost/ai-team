#!/usr/bin/env node
/**
 * Tail and pretty-print .ai-team/logs/backend.log in real-time.
 * Skips all existing content — only shows new entries as they arrive.
 *
 * Usage:
 *   node scripts/tail-log.mjs          # runtime events only (no duplicates)
 *   node scripts/tail-log.mjs --all    # all sources (runtime + stream layer)
 *   node scripts/tail-log.mjs --llm    # also tail individual LLM log files
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const logFile = path.resolve(__dirname, '../.ai-team/logs/backend.log');
const showAll = process.argv.includes('--all');
const POLL_MS = 150;

// ─── ANSI colours ────────────────────────────────────────────────────────────
const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  white: '\x1b[97m',
};

// ─── Phase → colour map ───────────────────────────────────────────────────────
const phaseColour = (phase) => {
  switch (phase) {
    case 'error':
      return C.red;
    case 'thinking':
      return C.blue;
    case 'done':
    case 'complete':
    case 'success':
      return C.green;
    case 'working':
      return C.cyan;
    case 'warning':
      return C.yellow;
    case 'start':
    case 'init':
      return C.magenta;
    default:
      return C.white;
  }
};

// ─── Format one NDJSON line ───────────────────────────────────────────────────
function formatLine(raw) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const entry = parsed.entry ?? {};
  const source = entry.source ?? '?';

  // Filter out stream layer duplicates unless --all
  if (!showAll && source === 'stream') return null;

  const ts = new Date(parsed.timestamp);
  const time = ts.toTimeString().slice(0, 8);

  const command = entry.command ? `:${entry.command}` : '';
  const tag = `${source}${command}`;

  const event = entry.event ?? {};
  const kind = event.kind ?? '';
  const phase = event.phase ?? kind;
  const message = event.message ?? event.text ?? '';

  const pc = phaseColour(phase);
  const col = (s) => (s ? `${pc}${s}${C.reset}` : '');

  const parts = [
    `${C.gray}${time}${C.reset}`,
    `${C.dim}[${tag}]${C.reset}`,
    col(phase),
    message ? `${C.white}${message}${C.reset}` : '',
  ].filter(Boolean);

  return parts.join(' ');
}

// ─── File tail ────────────────────────────────────────────────────────────────
function startTail(filePath, label) {
  let position = 0;
  try {
    position = fs.statSync(filePath).size;
  } catch {
    // file doesn't exist yet — start at 0 when it appears
  }

  console.log(`${C.gray}↳ watching ${label} (skipping existing ${position} bytes)${C.reset}`);

  let buffer = '';

  const poll = () => {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }

    if (stat.size <= position) return;

    const stream = fs.createReadStream(filePath, { start: position, end: stat.size - 1 });
    position = stat.size;

    stream.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const formatted = formatLine(line);
        if (formatted) console.log(formatted);
      }
    });
  };

  setInterval(poll, POLL_MS);
}

// ─── Entry point ─────────────────────────────────────────────────────────────
console.clear();
console.log(
  `${C.bold}${C.cyan}ai-team log tail${C.reset} ${C.dim}— ${showAll ? 'all sources' : 'runtime only (use --all to include stream layer)'}${C.reset}`
);
console.log(`${C.dim}${'─'.repeat(60)}${C.reset}`);

if (!fs.existsSync(logFile)) {
  console.log(`${C.yellow}Log file not found yet: ${logFile}${C.reset}`);
  console.log(`${C.dim}Will start tailing once the app writes to it.${C.reset}\n`);
}

startTail(logFile, 'backend.log');
