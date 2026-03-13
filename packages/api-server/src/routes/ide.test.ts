import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type express from 'express';

const ideMocks = vi.hoisted(() => {
  const adapter = {
    openFile: vi.fn(async () => undefined),
    notifyCodeEditProposal: vi.fn(async () => undefined),
    isConnected: vi.fn(() => true),
    onAck: vi.fn(() => undefined),
    dispose: vi.fn(() => undefined),
  };
  return {
    adapter,
    createIdeAdapter: vi.fn(async () => adapter),
  };
});

vi.mock('@ai-team/ide-interface', () => ({
  createIdeAdapter: ideMocks.createIdeAdapter,
  NoopIdeAdapter: class {
    openFile = ideMocks.adapter.openFile;
    notifyCodeEditProposal = ideMocks.adapter.notifyCodeEditProposal;
    isConnected = ideMocks.adapter.isConnected;
    onAck = ideMocks.adapter.onAck;
    dispose = ideMocks.adapter.dispose;
  },
}));

vi.mock('@ai-team/service', () => ({
  ProposalStore: class {
    save() {
      return undefined;
    }
    delete() {
      return undefined;
    }
    loadAll() {
      return [];
    }
  },
}));

import { createIdeRouter } from './ide.js';

type ReqLike = {
  body?: Record<string, unknown>;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

type ResLike = {
  statusCode: number;
  payload: unknown;
  status: (code: number) => ResLike;
  json: (payload: unknown) => void;
};

function createRes(): ResLike {
  return {
    statusCode: 200,
    payload: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.payload = payload;
    },
  };
}

async function invokeRoute(
  router: express.Router,
  method: 'get' | 'post',
  path: string,
  req: ReqLike,
): Promise<ResLike> {
  const layer = (router as unknown as { stack: Array<{ route?: { path?: string; methods?: Record<string, boolean>; stack?: Array<{ handle: (...args: unknown[]) => unknown }> } }> }).stack
    .find((entry) => entry.route?.path === path && entry.route?.methods?.[method]);

  if (!layer?.route?.stack?.[0]?.handle) {
    throw new Error(`Route not found: ${method.toUpperCase()} ${path}`);
  }

  const res = createRes();
  await layer.route.stack[0].handle(req, res);
  return res;
}

describe('createIdeRouter lifecycle endpoints', () => {
  let workspaceRoot: string;

  beforeEach(() => {
    vi.clearAllMocks();
    workspaceRoot = mkdtempSync(join(tmpdir(), 'ai-team-ide-router-'));
    mkdirSync(join(workspaceRoot, '.ai-team'), { recursive: true });
  });

  it('opens, updates, commits, checks status, and resets an edit session', async () => {
    const router = createIdeRouter(workspaceRoot);

    const openRes = await invokeRoute(router, 'post', '/v1/edit/open-diff', {
      body: {
        operationId: 'op-1',
        filePath: 'src/demo.ts',
        originalContent: 'const a = 1;\n',
        description: 'test change',
        agentName: 'agent-a',
      },
    });

    expect(openRes.statusCode).toBe(200);
    const openPayload = openRes.payload as Record<string, unknown>;
    expect(openPayload.ok).toBe(true);
    expect(typeof openPayload.sessionId).toBe('string');

    const sessionId = openPayload.sessionId as string;

    const updateRes = await invokeRoute(router, 'post', '/v1/edit/update', {
      body: {
        sessionId,
        content: 'const a = 2;\n',
        isFinal: true,
      },
    });
    expect(updateRes.statusCode).toBe(200);
    expect((updateRes.payload as Record<string, unknown>).state).toBe('ready');

    const commitRes = await invokeRoute(router, 'post', '/v1/edit/commit', {
      body: { sessionId },
    });
    expect(commitRes.statusCode).toBe(200);
    expect((commitRes.payload as Record<string, unknown>).terminalState).toBe('committed');

    const statusRes = await invokeRoute(router, 'get', '/v1/edit/status', {
      query: { sessionId },
    });
    expect(statusRes.statusCode).toBe(200);
    expect((statusRes.payload as Record<string, unknown>).state).toBe('committed');

    const resetRes = await invokeRoute(router, 'post', '/v1/edit/reset', {
      body: { sessionId },
    });
    expect(resetRes.statusCode).toBe(200);
    expect((resetRes.payload as Record<string, unknown>).state).toBe('closed');
  });

  it('returns 400 for update without sessionId', async () => {
    const router = createIdeRouter(workspaceRoot);

    const res = await invokeRoute(router, 'post', '/v1/edit/update', {
      body: { content: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect((res.payload as Record<string, unknown>).error).toBe('sessionId is required');
  });

  it('closes session when VS Code sends keep (accept) ack', async () => {
    const router = createIdeRouter(workspaceRoot);

    const openRes = await invokeRoute(router, 'post', '/v1/edit/open-diff', {
      body: {
        operationId: 'op-ack-accept',
        filePath: 'src/ack-accept.ts',
        originalContent: 'const value = 1;\n',
        description: 'ack accept test',
        agentName: 'agent-a',
      },
    });
    const sessionId = (openRes.payload as Record<string, unknown>).sessionId as string;

    await invokeRoute(router, 'post', '/v1/edit/update', {
      body: {
        sessionId,
        content: 'const value = 2;\n',
        isFinal: true,
      },
    });

    const ackHandler = ideMocks.adapter.onAck.mock.calls[0]?.[0] as
      | ((proposalId: string, action: 'accept' | 'reject') => void)
      | undefined;
    expect(ackHandler).toBeDefined();
    ackHandler?.(sessionId, 'accept');
    await new Promise((resolve) => setTimeout(resolve, 0));

    const statusRes = await invokeRoute(router, 'get', '/v1/edit/status', {
      query: { sessionId },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.payload).toMatchObject({
      sessionId,
      state: 'closed',
      terminalState: 'committed',
      closedBy: 'ack-accept',
    });
  });

  it('reverts and closes session when VS Code sends undo (reject) ack', async () => {
    const router = createIdeRouter(workspaceRoot);

    const openRes = await invokeRoute(router, 'post', '/v1/edit/open-diff', {
      body: {
        operationId: 'op-ack-reject',
        filePath: 'src/ack-reject.ts',
        originalContent: 'const value = 1;\n',
        description: 'ack reject test',
        agentName: 'agent-a',
      },
    });
    const sessionId = (openRes.payload as Record<string, unknown>).sessionId as string;

    await invokeRoute(router, 'post', '/v1/edit/update', {
      body: {
        sessionId,
        content: 'const value = 3;\n',
        isFinal: true,
      },
    });

    const notifyCallsBeforeAck = ideMocks.adapter.notifyCodeEditProposal.mock.calls.length;
    const ackHandler = ideMocks.adapter.onAck.mock.calls[0]?.[0] as
      | ((proposalId: string, action: 'accept' | 'reject') => void)
      | undefined;
    expect(ackHandler).toBeDefined();
    ackHandler?.(sessionId, 'reject');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(ideMocks.adapter.notifyCodeEditProposal.mock.calls.length).toBeGreaterThan(notifyCallsBeforeAck);

    const statusRes = await invokeRoute(router, 'get', '/v1/edit/status', {
      query: { sessionId },
    });
    expect(statusRes.statusCode).toBe(200);
    expect(statusRes.payload).toMatchObject({
      sessionId,
      state: 'closed',
      terminalState: 'reverted',
      closedBy: 'ack-reject',
    });
  });
});
