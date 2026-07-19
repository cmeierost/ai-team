import type { ICommand, IServiceContainer } from '@ai-team/core';
import { CORE_SERVICE_TOKENS } from '../../types.js';

import { AskUserCommand } from '../com/ask.command.js';
import { HandoffCommand } from '../com/handoff.command.js';
import { HireOrchestrationCommand } from '../hr/hire-orchestration.command.js';
import { ListToolsOrchestrationCommand } from '../tools/tool-catalog.command.js';
import { TeamListOrchestrationCommand } from '../team/list-team-orchestration.command.js';
import { createWorkflowDefinitionCommands } from '../workflow/workflow-tools.command.js';
import { WhoShouldCommand } from '../fs/who-should.command.js';
import type { IToolCatalog, IWorkflowCatalog } from './orchestration.types.js';
import type { WorkflowDefinitionResolver } from '../../workflow/definition-catalog.js';

export type {
  IAgentRegistry,
  ISessionGateway,
  IToolCatalog,
  IWorkflowCatalog,
} from './orchestration.types.js';

export { AskUserCommand, HandoffCommand, HireOrchestrationCommand };
export {
  ListToolsOrchestrationCommand,
  TOOL_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
} from '../tools/tool-catalog.command.js';
export {
  TeamListOrchestrationCommand,
  TEAM_LIST_PRE_LLM_PATTERNS,
  matchesTeamListPreLlmIntent,
} from '../team/list-team-orchestration.command.js';
export {
  createWorkflowDefinitionCommands,
  ListWorkflowsOrchestrationCommand,
  WorkflowDefinitionOrchestrationCommand,
} from '../workflow/workflow-tools.command.js';
export { WhoShouldCommand };

/** Assemble orchestration commands using DI container resolution only. */
export function createOrchestrationCommands(
  resolver: IServiceContainer,
  dependencies: {
    tools: IToolCatalog;
    workflows: IWorkflowCatalog;
    workflowResolvers: Record<string, WorkflowDefinitionResolver>;
  }
): ICommand<unknown, unknown>[] {
  return [
    new HandoffCommand(
      resolver.resolve(CORE_SERVICE_TOKENS.AgentManager),
      resolver.resolve(CORE_SERVICE_TOKENS.SessionManager),
      resolver.resolve(CORE_SERVICE_TOKENS.ThreadManager),
      resolver.resolve(CORE_SERVICE_TOKENS.LlmService),
      resolver.resolve(CORE_SERVICE_TOKENS.EmitService),
      resolver.resolve(CORE_SERVICE_TOKENS.ChatRuntime)
    ),
    new HireOrchestrationCommand(
      resolver.resolve(CORE_SERVICE_TOKENS.AgentManager),
      resolver.resolve(CORE_SERVICE_TOKENS.MarkdownSectionService)
    ),
    new WhoShouldCommand(resolver.resolve(CORE_SERVICE_TOKENS.AgentManager), dependencies.tools),
    new ListToolsOrchestrationCommand(dependencies.tools),
    new TeamListOrchestrationCommand(resolver.resolve(CORE_SERVICE_TOKENS.AgentManager)),
    ...createWorkflowDefinitionCommands(dependencies.workflows, dependencies.workflowResolvers),
  ];
}
