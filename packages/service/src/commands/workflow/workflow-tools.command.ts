import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-contracts';

import type { ScoredPreLlmIntentCandidate } from '../../tools/pre-llm-intents.js';
import type { IWorkflowCatalog } from '../orchestration/orchestration.types.js';
import type { WorkflowDefinitionResolver } from '../../workflow/definition-catalog.js';

/** Any workflow tool can implement this to expose its definition for catalog introspection. */
export interface IWorkflowDefinitionProvider {
  getDefinition(): WorkflowDefinitionApiResponse;
}
export interface WorkflowListResult {
  type: 'workflow_list_result';
  workflows: string[];
  timestamp: string;
}

type ListParams = z.infer<typeof ListWorkflowsOrchestrationCommand.schema>;
const _listWorkflowsOrchestrationCommandSchema = z.object({});

export const ListWorkflowsOrchestrationCommandMetadata = {
  key: 'list',
  description: 'List all registered workflows that can be discovered and queried as tools.',
  availableIn: { chat: true, cli: true, tool: true },
  cli: { command: 'list', parentKey: 'workflow' },
  group: 'workflow',
  parameters: _listWorkflowsOrchestrationCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['workflow', 'orchestration'],
} satisfies ICommandDescriptor;

export class ListWorkflowsOrchestrationCommand implements ICommand<ListParams, WorkflowListResult> {
  static readonly schema = _listWorkflowsOrchestrationCommandSchema;
  readonly metadata = ListWorkflowsOrchestrationCommandMetadata;

  constructor(private readonly catalog: IWorkflowCatalog) {}

  readonly scorePreLlmIntent = (
    message: string,
    _ctx: ExecutionContext
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

  async execute(
    _params: ListParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<WorkflowListResult>> {
    const workflows = this.catalog.listWorkflowIds();
    return {
      status: 'ok',
      data: {
        type: 'workflow_list_result',
        workflows,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

type DefinitionParams = z.infer<typeof WorkflowDefinitionOrchestrationCommand.schema>;
const _workflowDefinitionOrchestrationCommandSchema = z.object({});

export class WorkflowDefinitionOrchestrationCommand
  implements ICommand<DefinitionParams, WorkflowDefinitionApiResponse>, IWorkflowDefinitionProvider
{
  static readonly schema = _workflowDefinitionOrchestrationCommandSchema;
  readonly metadata: ICommandDescriptor<DefinitionParams>;

  constructor(
    private readonly workflowId: string,
    private readonly resolver: WorkflowDefinitionResolver
  ) {
    this.metadata = {
      key: workflowId,
      description: `Return the workflow definition for '${workflowId}' in JSON and YAML.`,
      availableIn: { chat: true, cli: true, tool: true },
      group: 'workflow',
      cli: { command: workflowId, parentKey: 'workflow' },
      parameters: _workflowDefinitionOrchestrationCommandSchema,
      permissionCheck: { type: 'none' },
      tags: ['workflow', 'orchestration'],
    };
  }

  async execute(
    _params: DefinitionParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<WorkflowDefinitionApiResponse>> {
    return { status: 'ok', data: this.getDefinition() };
  }

  getDefinition(): WorkflowDefinitionApiResponse {
    return {
      workflowId: this.workflowId,
      format: this.resolver.format,
      definitionJson: this.resolver.getJson(),
      definitionYaml: this.resolver.getYaml(),
    };
  }
}

export function createWorkflowDefinitionCommands(
  catalog: IWorkflowCatalog,
  resolvers: Record<string, WorkflowDefinitionResolver>
): ICommand<unknown, unknown>[] {
  const commands: ICommand<unknown, unknown>[] = [new ListWorkflowsOrchestrationCommand(catalog)];

  for (const [workflowId, resolver] of Object.entries(resolvers)) {
    commands.push(new WorkflowDefinitionOrchestrationCommand(workflowId, resolver));
  }

  return commands;
}
