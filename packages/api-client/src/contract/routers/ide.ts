import type { ApiDescription } from '@ts-http/core';

export type EditSessionState = 'open' | 'streaming' | 'ready' | 'committed' | 'reverted' | 'closed';

export interface IdeEditSession {
  sessionId: string;
  operationId: string;
  traceId?: string;
  filePath: string;
  originalContent: string;
  currentContent: string;
  state: EditSessionState;
  agentName: string;
  description: string;
  createdAt: string;
  lastUpdatedAt: string;
}

export interface IIdeService {
  openFile(body: {
    filePath: string;
    line?: number;
  }): Promise<{ ok: boolean; ideConnected: boolean }>;
  getStatus(): Promise<{ ideConnected: boolean }>;
  openDiff(body: {
    operationId: string;
    traceId?: string;
    filePath: string;
    newContent?: string;
    agentName: string;
    description: string;
  }): Promise<{ sessionId: string; state: string }>;
  updateEdit(body: {
    sessionId: string;
    newContent: string;
  }): Promise<{ sessionId: string; state: string }>;
  commitEdit(body: {
    sessionId: string;
  }): Promise<{ sessionId: string; finalContent: string; terminalState: string }>;
  keepEdit(body: { sessionId: string }): Promise<{
    sessionId: string;
    state: string;
    finalContent: string;
    terminalState: string;
  }>;
  revertEdit(body: {
    sessionId: string;
  }): Promise<{ sessionId: string; state: string; terminalState: string }>;
  undoEdit(body: { sessionId: string }): Promise<{ sessionId: string; state: string }>;
  resetEdit(body: { sessionId: string }): Promise<{ sessionId: string; state: string }>;
  getEditStatus(query?: {
    sessionId?: string;
    operationId?: string;
  }): Promise<IdeEditSession | { active: IdeEditSession[] }>;
}

export const ideDesc: ApiDescription<IIdeService> = {
  subRoute: '/api/ide',
  mapping: {
    openFile: { method: 'POST', path: 'open-file' },
    getStatus: { method: 'GET', path: 'status' },
    openDiff: { method: 'POST', path: 'v1/edit/open-diff' },
    updateEdit: { method: 'POST', path: 'v1/edit/update' },
    commitEdit: { method: 'POST', path: 'v1/edit/commit' },
    keepEdit: { method: 'POST', path: 'v1/edit/keep' },
    revertEdit: { method: 'POST', path: 'v1/edit/revert' },
    undoEdit: { method: 'POST', path: 'v1/edit/undo' },
    resetEdit: { method: 'POST', path: 'v1/edit/reset' },
    getEditStatus: { method: 'GET', path: 'v1/edit/status' },
  },
};
