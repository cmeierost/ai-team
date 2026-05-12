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

import type {
  ICommand,
  IServiceContainer,
  ExecutionContext,
} from '@ai-team/core';

import {
  AskUserCommand,
  createOrchestrationCommands,
  type IToolCatalog,
  type IWorkflowCatalog,
  TOOL_LIST_PRE_LLM_PATTERNS,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
  matchesTeamListPreLlmIntent,
} from '../commands/orchestration/index.js';
import type { ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';
import type { IWorkflowDefinitionProvider } from '../commands/workflow/workflow-tools.command.js';
import type { WorkflowDefinitionResolver } from '../workflow/definition-catalog.js';

interface ScoreableCommand<TParams, TResult> extends ICommand<TParams, TResult> {
  scorePreLlmIntent?: (
    message: string,
    ctx: ExecutionContext
  ) =>
    | Promise<ScoredPreLlmIntentCandidate | ScoredPreLlmIntentCandidate[] | undefined>
    | ScoredPreLlmIntentCandidate
    | ScoredPreLlmIntentCandidate[]
    | undefined;
}

function commandToTool<TParams, TResult>(
  command: ScoreableCommand<TParams, TResult>
): ICommand<TParams, TResult> {
  if (!command.parameters) {
    throw new Error(`Orchestration command '${command.key}' is missing parameters schema.`);
  }

  const tool: ICommand<TParams, TResult> = {
    ...(undefined as any), name: command.key,
    key: command.key,
    aliases: command.aliases,
    description: command.summary ?? command.description,
    summary: command.summary,
    usage: command.usage,
    availableIn: { tool: true },
    group: command.group,
    parameters: command.parameters,
    permissionCheck: command.permissionCheck,
    examples: command.examples,
    tags: command.tags,
    execute: (params: TParams, context: ExecutionContext) =>
      command.execute(params, context as unknown as ExecutionContext),
  };

  if (command.formatForLlm) {
    tool.formatForLlm = command.formatForLlm.bind(command);
  }

  if (command.scorePreLlmIntent) {
    (
      tool as ICommand<TParams, TResult> & {
        scorePreLlmIntent?: ScoreableCommand<TParams, TResult>['scorePreLlmIntent'];
      }
    ).scorePreLlmIntent = command.scorePreLlmIntent.bind(command);
  }

  if (
    'getDefinition' in command &&
    typeof (command as unknown as IWorkflowDefinitionProvider).getDefinition === 'function'
  ) {
    (tool as ICommand & { getDefinition?: () => unknown }).getDefinition = (
      command as unknown as IWorkflowDefinitionProvider
    ).getDefinition.bind(command);
  }

  return tool;
}

export {
  TOOL_LIST_PRE_LLM_PATTERNS,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
  matchesTeamListPreLlmIntent,
};

/**
 * Backward-compatible export used by init workflow question bridge tests and callers.
 */
export class AskUserTool extends AskUserCommand {
  readonly name = this.key;
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
  return createOrchestrationCommands(resolver, dependencies).map((command) =>
    commandToTool(command as ScoreableCommand<unknown, unknown>)
  );
}
