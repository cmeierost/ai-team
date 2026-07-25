import type { ICommand } from '@ai-team/core';
import type { WorkflowDefinition } from './workflow-types.js';

/** Service-local marker that distinguishes a workflow command from an ordinary command. */
export const workflowCommand = Symbol('workflow-command');

export interface IWorkflowCommand<TParams = unknown, TResult = unknown>
  extends ICommand<TParams, TResult> {
  readonly [workflowCommand]: true;
  readonly definitionId: string;
  readonly definitionVersion: string;
  /** Avoids colliding with the existing API-document getDefinition() provider. */
  getWorkflowDefinition(): WorkflowDefinition<unknown>;
}

export function isWorkflowCommand(command: ICommand): command is IWorkflowCommand {
  return (command as Partial<IWorkflowCommand>)[workflowCommand] === true;
}
