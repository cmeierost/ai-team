import type { ICommand } from '@ai-team/core';
import type { IWorkflowCommand } from './workflow-command.js';
import { isWorkflowCommand } from './workflow-command.js';
import { OrdinaryCommandActorAdapter } from './command-actor-adapter.js';
import { WorkflowCommandActorAdapter } from './workflow-command-actor-adapter.js';

/** One service-owned selection seam for ordinary versus actor-backed commands. */
export class CommandActorAdapterResolver {
  readonly ordinary = new OrdinaryCommandActorAdapter();
  readonly workflow = new WorkflowCommandActorAdapter();

  resolveWorkflow(command: ICommand): WorkflowCommandActorAdapter | undefined {
    return isWorkflowCommand(command) ? this.workflow : undefined;
  }

  supportsOrdinary(command: ICommand): boolean {
    return !isWorkflowCommand(command) && this.ordinary.supports(command);
  }

  isWorkflow(command: ICommand): command is IWorkflowCommand {
    return isWorkflowCommand(command);
  }
}
