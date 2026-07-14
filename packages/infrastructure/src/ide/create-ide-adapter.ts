import * as fs from 'node:fs';
import * as path from 'node:path';
import WebSocket from 'ws';
import type { IdeAdapter, IdeCallerMessage, IdePluginMessage, IdeServerFile } from '@ai-team/core';
import { LocalWsIdeAdapter } from './local-ws-ide-adapter.js';
import { NoopIdeAdapter } from './noop-ide-adapter.js';

const IDE_SERVER_FILE = '.ide-server.json';
const CONNECT_TIMEOUT_MS = 1500;

function normalizePathForComparison(p: string): string {
  let normalized = p.replace(/\//g, '\\');
  if (normalized.endsWith('\\')) {
    normalized = normalized.slice(0, -1);
  }
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

export async function createIdeAdapter(
  workspaceRoot: string,
  kind: 'cli' | 'web' = 'cli'
): Promise<IdeAdapter> {
  const serverFilePath = path.join(workspaceRoot, '.ai-team', IDE_SERVER_FILE);

  let serverInfo: IdeServerFile;
  try {
    const raw = fs.readFileSync(serverFilePath, 'utf8');
    serverInfo = JSON.parse(raw) as IdeServerFile;
  } catch {
    return new NoopIdeAdapter();
  }

  try {
    process.kill(serverInfo.pid, 0);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EPERM') {
      return new NoopIdeAdapter();
    }
  }

  if (
    normalizePathForComparison(serverInfo.workspaceRoot) !==
    normalizePathForComparison(workspaceRoot)
  ) {
    return new NoopIdeAdapter();
  }

  return new Promise<IdeAdapter>((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${serverInfo.port}`);
    const timeout = setTimeout(() => {
      ws.terminate();
      resolve(new NoopIdeAdapter());
    }, CONNECT_TIMEOUT_MS);

    ws.once('error', () => {
      clearTimeout(timeout);
      resolve(new NoopIdeAdapter());
    });

    ws.once('open', () => {
      const registerMsg: IdeCallerMessage = { type: 'register', workspaceRoot, kind };
      ws.send(JSON.stringify(registerMsg));

      ws.once('message', (data: Buffer) => {
        clearTimeout(timeout);
        try {
          const reply: IdePluginMessage = JSON.parse(data.toString());
          if (reply.type === 'registered') {
            resolve(new LocalWsIdeAdapter(ws));
          } else {
            ws.close();
            resolve(new NoopIdeAdapter());
          }
        } catch {
          ws.close();
          resolve(new NoopIdeAdapter());
        }
      });
    });
  });
}
