import type {
  ICommand,
  IContainerToken,
  IServiceContainer,
} from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';

import { AskUserCommand } from '../com/ask.command.js';
import { HandoffCommand } from '../com/handoff.command.js';
import { HireOrchestrationCommand } from '../hr/hire-orchestration.command.js';
import { ListToolsOrchestrationCommand } from '../tools/list-tools-orchestration.command.js';
import { TeamListOrchestrationCommand } from '../team/list-team-orchestration.command.js';
import {
  createWorkflowDefinitionCommands,
} from '../workflow/workflow-tools.command.js';
import { WhoShouldCommand } from '../fs/who-should.command.js';
import type { IToolCatalog, IWorkflowCatalog } from './orchestration.types.js';
import type { WorkflowDefinitionResolver } from '../../workflow/definition-catalog.js';

export type {
  IAgentRegistry,
  ISessionGateway,
  IToolCatalog,
  IWorkflowCatalog,
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

function createToken<T>(id: string): IContainerToken<T> {
  return {
    id,
    toString: () => `Token(${id})`,
  } as IContainerToken<T>;
}

const ORCHESTRATION_TOKENS = {
  deps: {
    tools: createToken<IToolCatalog>('OrchestrationDeps:tools'),
    workflows: createToken<IWorkflowCatalog>('OrchestrationDeps:workflows'),
  },
  commands: {
    handoff: createToken<HandoffCommand>('OrchestrationCommand:handoff'),
    askUser: createToken<AskUserCommand>('OrchestrationCommand:askUser'),
    hire: createToken<HireOrchestrationCommand>('OrchestrationCommand:hire'),
    whoShould: createToken<WhoShouldCommand>('OrchestrationCommand:whoShould'),
    listTools: createToken<ListToolsOrchestrationCommand>('OrchestrationCommand:listTools'),
    teamList: createToken<TeamListOrchestrationCommand>('OrchestrationCommand:teamList'),
  },
} as const;

/** Assemble orchestration commands using DI container resolution only. */
export function createOrchestrationCommands(
  resolver: IServiceContainer,
  dependencies: {
    tools: IToolCatalog;
    workflows: IWorkflowCatalog;
    workflowResolvers: Record<string, WorkflowDefinitionResolver>;
  }
): ICommand<unknown, unknown>[] {
  const child = resolver.child();

  child.registerInstance(ORCHESTRATION_TOKENS.deps.tools, dependencies.tools);
  child.registerInstance(ORCHESTRATION_TOKENS.deps.workflows, dependencies.workflows);

  child.registerTransient(
    ORCHESTRATION_TOKENS.commands.handoff,
    (c) =>
      new HandoffCommand(
        c.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        c.resolve(COMMAND_FACTORY_TOKENS.SessionManager)
      )
  );
  child.registerTransient(ORCHESTRATION_TOKENS.commands.askUser, () => new AskUserCommand());
  child.registerTransient(
    ORCHESTRATION_TOKENS.commands.hire,
    (c) => new HireOrchestrationCommand(
      c.resolve(COMMAND_FACTORY_TOKENS.AgentManager)
    )
  );
  child.registerTransient(
    ORCHESTRATION_TOKENS.commands.whoShould,
    (c) =>
      new WhoShouldCommand(
        c.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        c.resolve(ORCHESTRATION_TOKENS.deps.tools)
      )
  );
  child.registerTransient(
    ORCHESTRATION_TOKENS.commands.listTools,
    (c) => new ListToolsOrchestrationCommand(
      c.resolve(ORCHESTRATION_TOKENS.deps.tools)
    )
  );
  child.registerTransient(
    ORCHESTRATION_TOKENS.commands.teamList,
    (c) => new TeamListOrchestrationCommand(c.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  return [
    child.resolve(ORCHESTRATION_TOKENS.commands.handoff) as unknown as ICommand<unknown, unknown>,
    child.resolve(ORCHESTRATION_TOKENS.commands.askUser) as unknown as ICommand<unknown, unknown>,
    child.resolve(ORCHESTRATION_TOKENS.commands.hire),
    child.resolve(ORCHESTRATION_TOKENS.commands.whoShould),
    child.resolve(ORCHESTRATION_TOKENS.commands.listTools),
    child.resolve(ORCHESTRATION_TOKENS.commands.teamList),
    ...createWorkflowDefinitionCommands(
      child.resolve(ORCHESTRATION_TOKENS.deps.workflows),
      dependencies.workflowResolvers
    ),
  ];
}
