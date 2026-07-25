import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ICommand, IServiceContainer } from '@ai-team/core';
import { CommandInvocationPreparer } from './command-invocation-preparer.js';

function createResolver(): IServiceContainer {
  return {
    resolve: () => {
      throw new Error('not used');
    },
    tryResolve: () => undefined,
    has: () => false,
    child() {
      return this;
    },
    register() {
      return this;
    },
    registerSingleton() {
      return this;
    },
    registerTransient() {
      return this;
    },
    registerScoped() {
      return this;
    },
    registerInstance() {
      return this;
    },
  } as unknown as IServiceContainer;
}

describe('CommandInvocationPreparer', () => {
  it('applies context and workflow bindings before producing a stable workflow idempotency key', async () => {
    const command: ICommand<{ sessionId: string; source: string }, unknown> = {
      metadata: {
        key: 'prepared-command',
        description: 'prepared command',
        availableIn: {},
        parameters: z.object({ sessionId: z.string(), source: z.string() }),
        input: { contextParameters: ['sessionId'] },
        workflowInputBindings: { source: { fromLastResult: 'artifact.id' } },
      },
      execute: async () => ({ status: 'ok' }),
    };

    const prepared = await new CommandInvocationPreparer(createResolver()).prepare(
      command as ICommand<unknown, unknown>,
      command.metadata,
      {},
      {
        history: [],
        sessionId: 'session-1',
        workflowInstanceId: 'run-1',
        stepId: 'publish',
        workflowLastResult: { artifact: { id: 'business-md' } },
      }
    );

    expect(prepared).toMatchObject({
      commandKey: 'prepared-command',
      params: { sessionId: 'session-1', source: 'business-md' },
      idempotencyKey: 'run-1:publish:prepared-command',
    });
  });
});
