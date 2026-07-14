/**
 * Orchestration tools bridge.
 *
 * Orchestration behaviors now live as ICommand implementations grouped by
 * command metadata under packages/service/src/commands/{group}/*.command.ts
 * (assembled via commands/orchestration/index.ts).
 *
 * This module adapts those commands into ICommand instances so the existing
 * ToolManager-based runtime continues to work unchanged.
 */

import type { ICommand, IServiceContainer } from '@ai-team/core';

import {
  AskUserCommand,
  createOrchestrationCommands,
  type IToolCatalog,
  type IWorkflowCatalog,
} from './index.js';
import type { WorkflowDefinitionResolver } from '../../workflow/definition-catalog.js';

export {
  TOOL_LIST_PRE_LLM_PATTERNS,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
  matchesTeamListPreLlmIntent,
} from './index.js';

/**
 * Backward-compatible export used by init workflow question bridge tests and callers.
 */
export class AskUserTool extends AskUserCommand {
  readonly name = this.metadata.key;
}

/** Assemble all orchestration tools in one call. */
export function createOrchestrationTools(
  resolver: IServiceContainer,
  dependencies: {
    tools: IToolCatalog;
    workflows: IWorkflowCatalog;
    workflowResolvers: Record<string, WorkflowDefinitionResolver>;
  }
): ICommand[] {
  return createOrchestrationCommands(resolver, dependencies).map((command) => {
    (command as { name?: string }).name = command.metadata.key;
    return command;
  });
}
