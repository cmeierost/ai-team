/**
 * Orchestration tools bridge.
 *
 * Orchestration behaviors now live as ICommand implementations grouped by
 * command metadata under packages/service/src/commands/{group}/*.command.ts
 * (assembled via commands/orchestration/index.ts).
 *
 * This module adapts those commands into AgentTool instances so the existing
 * ToolManager-based runtime continues to work unchanged.
 */

import type {
  AgentTool,
  CommandRuntime,
  ICommand,
  ToolContext,
} from '@ai-team/core';

import {
  AskUserCommand,
  createOrchestrationCommands,
  type OrchestrationDeps,
  TOOL_LIST_PRE_LLM_PATTERNS,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
  matchesTeamListPreLlmIntent,
} from '../commands/orchestration/index.js';
import type { OrchestratorContext } from '../orchestrator/pipeline-context.js';
import type { ScoredPreLlmIntentCandidate } from './pre-llm-intents.js';

interface ScoreableCommand<TParams, TResult>
  extends ICommand<TParams, ToolContext, TResult> {
  scorePreLlmIntent?: (
    message: string,
    ctx: OrchestratorContext
  ) =>
    | Promise<ScoredPreLlmIntentCandidate | ScoredPreLlmIntentCandidate[] | undefined>
    | ScoredPreLlmIntentCandidate
    | ScoredPreLlmIntentCandidate[]
    | undefined;
}

function commandToTool<TParams, TResult>(
  command: ScoreableCommand<TParams, TResult>
): AgentTool<ToolContext, TParams, TResult> {
  if (!command.parameters) {
    throw new Error(`Orchestration command '${command.key}' is missing parameters schema.`);
  }

  const tool: AgentTool<ToolContext, TParams, TResult> = {
    name: command.key,
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
    execute: (params: TParams, context: ToolContext, runtime: CommandRuntime) =>
      command.execute(params, context, runtime),
  };

  if (command.formatForLlm) {
    tool.formatForLlm = command.formatForLlm.bind(command);
  }

  if (command.scorePreLlmIntent) {
    (tool as AgentTool<ToolContext, TParams, TResult> & {
      scorePreLlmIntent?: ScoreableCommand<TParams, TResult>['scorePreLlmIntent'];
    }).scorePreLlmIntent = command.scorePreLlmIntent.bind(command);
  }

  return tool;
}

export {
  TOOL_LIST_PRE_LLM_PATTERNS,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
  matchesTeamListPreLlmIntent,
};

export { type OrchestrationDeps };

/**
 * Backward-compatible export used by init workflow question bridge tests and callers.
 */
export class AskUserTool extends AskUserCommand {
  readonly name = this.key;
}

/** Assemble all orchestration tools in one call. */
export function createOrchestrationTools(deps: OrchestrationDeps): AgentTool[] {
  return createOrchestrationCommands(deps).map((command) =>
    commandToTool(command as ScoreableCommand<unknown, unknown>)
  );
}
