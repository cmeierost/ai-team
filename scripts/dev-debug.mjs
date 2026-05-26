/**
 * Starts the API server and web dev server (vite) as two independent processes
 * — mirrors the approach used by `ait ui` in
 * packages/service/src/commands/start/ui.ts.
 *
 * Waits for the API server to be listening on port 3002 before starting Vite
 * so the browser doesn't open to a "no connection" banner.
 *
 * Usage:
 *   pnpm dev           →  node scripts/dev-debug.mjs
 *   pnpm dev:debug     →  node scripts/dev-debug.mjs --inspect
 */

const inspect = process.argv.includes('--inspect');
const label = inspect ? '[dev:debug]' : '[dev]';

import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const API_PORT = 3002;
const API_HOST = '127.0.0.1';
const POLL_INTERVAL_MS = 300;
const POLL_TIMEOUT_MS = 60_000;

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWindows = process.platform === 'win32';
const pnpm = isWindows ? 'pnpm.cmd' : 'pnpm';

/** Strip pseudo-variables that Windows can inject (e.g. "=C:") which break spawn. */
function buildSafeEnv(overrides = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith('=') || k.includes('=')) continue;
    safe[k] = v;
  }
  return Object.assign(safe, overrides);
}

function spawnPnpm(args, envOverrides = {}) {
  return spawn(pnpm, args, {
    cwd: root,
    stdio: 'inherit',
    env: buildSafeEnv(envOverrides),
    shell: isWindows,
  });
}

/** Probe port once. Resolves true if listening, false otherwise. */
function probePort(port, host) {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host });
    let done = false;
    const finish = (ok) => {
      if (!done) {
        done = true;
        socket.destroy();
        resolve(ok);
      }
    };
    socket.setTimeout(300);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** Poll until the API port is accepting connections or the timeout is reached. */
async function waitForApi() {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  process.stdout.write(`${label} Waiting for API server`);
  while (Date.now() < deadline) {
    if (await probePort(API_PORT, API_HOST)) {
      process.stdout.write(' ready.\n');
      return true;
    }
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  process.stdout.write(' timed out.\n');
  return false;
}

// --- Start API server first ---
const api = spawnPnpm(['--filter', '@ai-team/api-server', inspect ? 'dev:debug' : 'dev']);

let settled = false;
let web = null;
let exitCount = 0;

function shutdown() {
  if (settled) return;
  settled = true;
  if (api && !api.killed) api.kill('SIGTERM');
  if (web && !web.killed) web.kill('SIGTERM');
}

function onExit(name, code, signal) {
  exitCount++;
  const interrupted = signal === 'SIGINT' || signal === 'SIGTERM' || code === 130;
  if (!settled && !interrupted && code !== 0) {
    console.error(`\n${label} ${name} exited with code ${code} — shutting down.`);
    shutdown();
  }
  // Both have exited (or only api if web never started)
  const expected = web ? 2 : 1;
  if (exitCount >= expected) process.exit(0);
}

api.once('error', (e) => {
  console.error(`${label} API error: ${e.message}`);
  shutdown();
});
api.once('exit', (c, s) => onExit('API server', c, s));

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Wait for API, then start Vite ---
const ready = await waitForApi();
if (!settled) {
  if (!ready) {
    console.error(`${label} API did not start in time — still starting Vite anyway.`);
  }
  web = spawnPnpm(['--filter', '@ai-team/web', 'dev']);
  web.once('error', (e) => {
    console.error(`${label} Web error: ${e.message}`);
    shutdown();
  });
  web.once('exit', (c, s) => onExit('Web server', c, s));
}
