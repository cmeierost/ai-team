import { describe, expect, it } from 'vitest';

import type { IServiceContainer } from '@ai-team/core';

import { WorkflowRunnerFactory } from './runner.js';
import type { WorkflowDefinition } from './types.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

function createContainerWithCommands(
  commands: Record<string, { execute: (params: unknown) => Promise<unknown> }>
): IServiceContainer {
  const toolManager = {
    get: (name: string) => commands[name],
  };

  const container = {
    resolve: (token: { id: string }) => {
      if (token.id === COMMAND_FACTORY_TOKENS.ToolManager.id) {
        return toolManager;
      }
      throw new Error(`Unexpected token: ${token.id}`);
    },
    tryResolve: () => undefined,
    has: () => false,
    child: function () {
      return this;
    },
    register: function () {
      return this;
    },
    registerSingleton: function () {
      return this;
    },
    registerTransient: function () {
      return this;
    },
    registerScoped: function () {
      return this;
    },
    registerInstance: function () {
      return this;
    },
  } as unknown as IServiceContainer;

  return container;
}

describe('WorkflowRunner json-mode primitives', () => {
  it('executes steps guarded by declarative `when` and applies declarative `result` projection', async () => {
    const calls: string[] = [];
    const container = createContainerWithCommands({
      first: {
        execute: async () => {
          calls.push('first');
          return { answer: 'hire' };
        },
      },
      second: {
        execute: async (params) => {
          calls.push('second');
          return params;
        },
      },
      never: {
        execute: async () => {
          calls.push('never');
          return { ok: false };
        },
      },
    });

    const definition: WorkflowDefinition<Record<string, unknown>> = {
      id: 'json-mode-test',
      description: 'json mode test workflow',
      availableIn: { tool: true },
      parameters: undefined,
      steps: [
        {
          id: 'choice',
          command: 'first',
          args: {},
        },
        {
          id: 'execute_when_hire',
          command: 'second',
          when: '{{choice.answer}} == "hire"',
          args: {
            mapped: {
              $map: {
                from: ['a', 'b'],
                as: 'item',
                value: { value: '{{item}}' },
              },
            },
          },
        },
        {
          id: 'execute_when_skip',
          command: 'never',
          when: '{{choice.answer}} == "skip"',
          args: {},
        },
      ],
      result: {
        decision: '{{choice.answer}}',
        ranSecond: '{{execute_when_hire.mapped}}',
      },
    };

    const factory = new WorkflowRunnerFactory(container);
    const command = factory.asCommand(definition);

    const response = await command.execute(
      {},
      {
        workspaceRoot: '/workspace',
        history: [],
      }
    );

    expect(response.status).toBe('ok');
    expect(response.data).toEqual({
      decision: 'hire',
      ranSecond: [{ value: 'a' }, { value: 'b' }],
    });
    expect(calls).toEqual(['first', 'second']);
  });
});
