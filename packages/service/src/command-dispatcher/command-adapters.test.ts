import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ICommand } from '@ai-team/core';
import { toCommandRegistration, toLlmToolDefinition } from './command-adapters.js';

describe('command-adapters runtime resolution', () => {
  it('resolves context parameters and workflow bindings before execution', async () => {
    const cmd: ICommand<
      { sessionId?: string; target?: { id?: string }; workflowLabel?: string },
      unknown
    > = {
      metadata: {
        key: 'resolve_test',
        description: 'resolve test',
        availableIn: { cli: true },
        parameters: z.object({
          sessionId: z.string().optional(),
          target: z.object({ id: z.string().optional() }).optional(),
          workflowLabel: z.string().optional(),
        }),
        input: {
          contextParameters: ['sessionId'],
          requiredAtRuntime: ['sessionId', 'target.id', 'workflowLabel'],
        },
        workflowInputBindings: {
          'target.id': { fromLastResult: 'actor.id' },
          workflowLabel: { fromWorkflowData: 'data.label' },
        },
      },
      execute: async (args) => args,
    };

    const registration = toCommandRegistration(cmd as ICommand<unknown, unknown>);
    const result = await registration.handler('/workspace', {}, {
      invocationSurface: 'cli',
      calledByHuman: true,
      sessionId: 'sess-1',
      workflowLastResult: {
        actor: { id: 'agent-1' },
      },
      workflowState: {
        data: { label: 'implementation' },
      },
    } as any);

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: {
          sessionId: 'sess-1',
          target: { id: 'agent-1' },
          workflowLabel: 'implementation',
        },
      })
    );
  });

  it('fails fast when required runtime values are still missing', async () => {
    const cmd: ICommand<{ sessionId?: string }, unknown> = {
      metadata: {
        key: 'required_test',
        description: 'required test',
        availableIn: { cli: true },
        parameters: z.object({
          sessionId: z.string().optional(),
        }),
        input: {
          contextParameters: ['sessionId'],
          requiredAtRuntime: ['sessionId'],
        },
      },
      execute: async (args) => args,
    };

    const registration = toCommandRegistration(cmd as ICommand<unknown, unknown>);
    await expect(
      registration.handler('/workspace', {}, { invocationSurface: 'cli' } as any)
    ).rejects.toThrow(/Missing required parameter\(s\) after runtime resolution: sessionId/);
  });
});

describe('command-adapters llm metadata', () => {
  it('hides context and explicit hidden parameters from llm tool schema', () => {
    const cmd: ICommand<{ sessionId?: string; query?: string; debug?: boolean }, unknown> = {
      metadata: {
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
      },
      execute: async () => undefined,
    };

    const def = toLlmToolDefinition(cmd as ICommand<unknown, unknown>);
    const properties = (def.parameters?.properties ?? {}) as Record<string, unknown>;

    expect(properties.sessionId).toBeUndefined();
    expect(properties.debug).toBeUndefined();
    expect(properties.query).toBeDefined();
  });
});
