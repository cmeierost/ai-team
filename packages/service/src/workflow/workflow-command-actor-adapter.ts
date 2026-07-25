import { assign, setup, type AnyActorLogic } from 'xstate';
import type { PreparedCommandInvocation } from '@ai-team/core';
import type { IWorkflowCommand } from './workflow-command.js';

export type WorkflowActorLogicCompiler = (
  definition: ReturnType<IWorkflowCommand['getWorkflowDefinition']>
) => AnyActorLogic;

/** Invokes the branded workflow machine directly instead of flattening execute() into a promise. */
export class WorkflowCommandActorAdapter {
  supports(command: IWorkflowCommand): boolean {
    return Boolean(command.getWorkflowDefinition);
  }

  toActorLogic(command: IWorkflowCommand, compile: WorkflowActorLogicCompiler): AnyActorLogic {
    const definition = command.getWorkflowDefinition();
    const workflow = compile(definition);

    return setup({
      types: {
        context: {} as { prepared: PreparedCommandInvocation; output?: unknown },
        input: {} as PreparedCommandInvocation,
      },
      actors: { workflow },
    }).createMachine({
      id: `${command.definitionId}:command-actor`,
      initial: 'running',
      context: ({ input }) => ({ prepared: input }),
      output: ({ context }) => context.output,
      states: {
        running: {
          invoke: {
            id: 'workflow',
            src: 'workflow',
            input: ({ context }: { context: { prepared: PreparedCommandInvocation } }) => ({
              initialState: definition.prepare
                ? definition.prepare(context.prepared.params)
                : context.prepared.params,
              workflowId: command.definitionId,
              workflowInstanceId: context.prepared.idempotencyKey,
            }),
            onDone: {
              target: 'complete',
              actions: assign({ output: ({ event }) => (event.output as { data: unknown }).data }),
            },
          },
        },
        complete: { type: 'final' },
      },
    });
  }
}
