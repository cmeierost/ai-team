import type { ICommand, ToolContext } from '@ai-team/core';

import { AskUserCommand } from '../com/ask.command.js';
import { HandoffCommand } from '../com/handoff.command.js';
import { HireOrchestrationCommand } from '../hr/hire-orchestration.command.js';
import { ListToolsOrchestrationCommand } from '../tools/list-tools-orchestration.command.js';
import { TeamListOrchestrationCommand } from '../team/list-team-orchestration.command.js';
import {
  createWorkflowDefinitionCommands,
  ListWorkflowsOrchestrationCommand,
  WorkflowDefinitionOrchestrationCommand,
} from '../workflow/workflow-tools.command.js';
import { WhoShouldCommand } from '../fs/who-should.command.js';
import type { OrchestrationDeps } from './orchestration.types.js';

export type {
  IAgentRegistry,
  ISessionGateway,
  IToolCatalog,
  IWorkflowCatalog,
  OrchestrationDeps,
} from './orchestration.types.js';

export { AskUserCommand } from '../com/ask.command.js';
export { HandoffCommand } from '../com/handoff.command.js';
export { HireOrchestrationCommand } from '../hr/hire-orchestration.command.js';
export {
  ListToolsOrchestrationCommand,
  TOOL_LIST_PRE_LLM_PATTERNS,
  matchesToolListPreLlmIntent,
} from '../tools/list-tools-orchestration.command.js';
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
export { WhoShouldCommand } from '../fs/who-should.command.js';

/** Assemble all orchestration commands in one call. */
export function createOrchestrationCommands(deps: OrchestrationDeps): ICommand<unknown, ToolContext, unknown>[] {
  return [
    new HandoffCommand(deps.agents, deps.sessions),
    new AskUserCommand(),
    new HireOrchestrationCommand(deps.agents),
    new WhoShouldCommand(deps.agents, deps.tools),
    new ListToolsOrchestrationCommand(deps.tools),
    new TeamListOrchestrationCommand(deps.agents),
    ...createWorkflowDefinitionCommands(deps.workflows),
  ];
}
