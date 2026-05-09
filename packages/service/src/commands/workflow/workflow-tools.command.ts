import { z } from 'zod';
import type {
  CommandRuntime,
  ICommand,
  ToolContext,
} from '@ai-team/core';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import type { ScoredPreLlmIntentCandidate } from '../../tools/pre-llm-intents.js';
import type { IWorkflowCatalog } from '../orchestration/orchestration.types.js';

export interface WorkflowListResult {
  type: 'workflow_list_result';
  workflows: string[];
  timestamp: string;
}

type ListParams = z.infer<typeof ListWorkflowsOrchestrationCommand.schema>;

export class ListWorkflowsOrchestrationCommand
  implements ICommand<ListParams, ToolContext, WorkflowListResult>
{
  static readonly schema = z.object({});

  readonly key = 'list';
  readonly description =
    'List all registered workflows that can be discovered and queried as tools.';
  readonly availableIn = { chat: true, cli: true, tool: true };
  readonly cli = { command: 'list', parentKey: 'workflow' };
  readonly group = 'workflow';
  readonly parameters = ListWorkflowsOrchestrationCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['workflow', 'orchestration'];

  constructor(private readonly workflows: IWorkflowCatalog) {}

  readonly scorePreLlmIntent = (
    message: string,
    _ctx: OrchestratorContext
  ): ScoredPreLlmIntentCandidate | undefined => {
    const text = message.trim();
    if (!text) return undefined;

    if (/\b(list|show|what)\b.*\b(workflow|workflows)\b/i.test(text)) {
      return {
        kind: 'tool',
        toolName: 'workflow_list',
        args: {},
        score: 100,
        reason: 'Explicit workflow listing request.',
      };
    }

    return undefined;
  };

  async execute(_params: ListParams, _context: ToolContext, _runtime: CommandRuntime): Promise<WorkflowListResult> {
    const workflows = this.workflows.listWorkflowIds();
    return {
      type: 'workflow_list_result',
      workflows,
      timestamp: new Date().toISOString(),
    };
  }
}

type DefinitionParams = z.infer<typeof WorkflowDefinitionOrchestrationCommand.schema>;

export class WorkflowDefinitionOrchestrationCommand
  implements ICommand<DefinitionParams, ToolContext, WorkflowDefinitionApiResponse>
{
  static readonly schema = z.object({});

  readonly description: string;
  readonly availableIn = { chat: true, cli: true, tool: true };
  readonly group = 'workflow';
  readonly parameters = WorkflowDefinitionOrchestrationCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['workflow', 'orchestration'];
  readonly key: string;
  readonly cli: { command: string; parentKey?: string };

  constructor(
    private readonly workflowId: string,
    private readonly workflows: IWorkflowCatalog
  ) {
    this.key = workflowId;
    this.description = `Return the workflow definition for '${workflowId}' in JSON and YAML.`;
    this.cli = { command: workflowId, parentKey: 'workflow' };
  }

  async execute(
    _params: DefinitionParams,
    _context: ToolContext,
    _runtime: CommandRuntime
  ): Promise<WorkflowDefinitionApiResponse> {
    return this.workflows.getWorkflowDefinition(this.workflowId);
  }
}

export function createWorkflowDefinitionCommands(
  workflows: IWorkflowCatalog
): ICommand<unknown, ToolContext, unknown>[] {
  const ids = workflows.listWorkflowIds();
  const commands: ICommand<unknown, ToolContext, unknown>[] = [
    new ListWorkflowsOrchestrationCommand(workflows),
  ];

  for (const workflowId of ids) {
    commands.push(new WorkflowDefinitionOrchestrationCommand(workflowId, workflows));
  }

  return commands;
}
