import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ICommand, SessionSnapshot } from '@ai-team/core';
import { toCommandRegistration, toLlmToolDefinition, toSlashCommand } from './command-adapters.js';

describe('command-adapters runtime resolution', () => {
  it('resolves context parameters and workflow bindings before execution', async () => {
    const cmd: ICommand<
      { sessionId?: string; target?: { id?: string } },
      void,
      unknown
    > = {
      key: 'resolve_test',
      description: 'resolve test',
      availableIn: { cli: true },
      cli: { command: 'resolve-test' },
      parameters: z.object({
        sessionId: z.string().optional(),
        target: z.object({ id: z.string().optional() }).optional(),
      }),
      input: {
        contextParameters: ['sessionId'],
        requiredAtRuntime: ['sessionId', 'target.id'],
      },
      workflowInputBindings: {
        'target.id': { fromLastResult: 'actor.id' },
      },
      execute: async (args) => args,
    };

    const registration = toCommandRegistration(cmd as ICommand<unknown, void, unknown>);
    const result = await registration.handler(
      '/workspace',
      {},
      {
        invocationSurface: 'cli',
        calledByHuman: true,
        sessionId: 'sess-1',
        workflowLastResult: {
          actor: { id: 'agent-1' },
        },
      } as any
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: {
          sessionId: 'sess-1',
          target: { id: 'agent-1' },
        },
      })
    );
  });

  it('fails fast when required runtime values are still missing', async () => {
    const cmd: ICommand<{ sessionId?: string }, void, unknown> = {
      key: 'required_test',
      description: 'required test',
      availableIn: { cli: true },
      cli: { command: 'required-test' },
      parameters: z.object({
        sessionId: z.string().optional(),
      }),
      input: {
        contextParameters: ['sessionId'],
        requiredAtRuntime: ['sessionId'],
      },
      execute: async (args) => args,
    };

    const registration = toCommandRegistration(cmd as ICommand<unknown, void, unknown>);
    await expect(
      registration.handler('/workspace', {}, { invocationSurface: 'cli' } as any)
    ).rejects.toThrow(/Missing required parameter\(s\) after runtime resolution: sessionId/);
  });
});

describe('command-adapters llm metadata', () => {
  it('hides context and explicit hidden parameters from llm tool schema', () => {
    const cmd: ICommand<{ sessionId?: string; query?: string; debug?: boolean }, void, unknown> = {
      key: 'tool_test',
      description: 'tool test',
      availableIn: { tool: true },
      parameters: z.object({
        sessionId: z.string().optional(),
        query: z.string().optional(),
        debug: z.boolean().optional(),
      }),
      input: { contextParameters: ['sessionId'] },
      llm: { hiddenParameters: ['debug'] },
      execute: async () => undefined,
    };

    const def = toLlmToolDefinition(cmd as ICommand<unknown, unknown, unknown>);
    const properties = (def.parameters?.properties ?? {}) as Record<string, unknown>;

    expect(properties.sessionId).toBeUndefined();
    expect(properties.debug).toBeUndefined();
    expect(properties.query).toBeDefined();
  });
});

describe('command-adapters slash context overrides', () => {
  const baseContext: SessionSnapshot = {
    agent: { id: 'agent-1', name: 'Agent One', role: 'role-1' },
    sessionId: 'sess-1',
    history: [],
  };

  it('allows human override for allowlisted context keys', async () => {
    const cmd: ICommand<{ sessionId?: string }, SessionSnapshot, { sessionId: string }> = {
      key: 'who_test',
      description: 'who test',
      availableIn: { chat: true },
      usage: '/who-test [json]',
      parameters: z.object({ sessionId: z.string().optional() }),
      input: { contextOverrideAllowlist: ['sessionId'] },
      execute: async (_args, ctx) => ({ sessionId: ctx.sessionId }),
    };

    const slashCmd = toSlashCommand(cmd as ICommand<unknown, SessionSnapshot, unknown>);
    const result = await slashCmd.execute('{"sessionId":"sess-2"}', baseContext);

    expect((result as any).data).toEqual({ sessionId: 'sess-2' });
  });

  it('ignores overrides for non-allowlisted keys', async () => {
    const cmd: ICommand<{ sessionId?: string }, SessionSnapshot, { sessionId: string }> = {
      key: 'who_test_locked',
      description: 'who test locked',
      availableIn: { chat: true },
      usage: '/who-test-locked [json]',
      parameters: z.object({ sessionId: z.string().optional() }),
      input: { contextOverrideAllowlist: ['workflow.continuationToken'] },
      execute: async (_args, ctx) => ({ sessionId: ctx.sessionId }),
    };

    const slashCmd = toSlashCommand(cmd as ICommand<unknown, SessionSnapshot, unknown>);
    const result = await slashCmd.execute('{"sessionId":"sess-9"}', baseContext);

    expect((result as any).data).toEqual({ sessionId: 'sess-1' });
  });
});
