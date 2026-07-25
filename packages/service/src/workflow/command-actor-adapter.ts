import { fromPromise, type AnyActorLogic } from 'xstate';
import type { ICommand, PreparedCommandInvocation } from '@ai-team/core';

/** Converts normal command execution into an XState promise actor. */
export class OrdinaryCommandActorAdapter {
  supports(command: ICommand): boolean {
    return Boolean(command.execute);
  }

  toActorLogic(command: ICommand): AnyActorLogic {
    return fromPromise(async ({ input, signal }: { input: PreparedCommandInvocation; signal: AbortSignal }) =>
      command.execute(input.params, {
        ...input.context,
        signal: input.context.signal ?? signal,
        commandInvocation: input.context.commandInvocation ?? {
          callId: input.idempotencyKey,
          toolName: input.commandKey,
        },
      })
    );
  }
}
