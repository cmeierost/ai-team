import { z } from 'zod';
import type { ICommand, ExecutionContext, ICommandDescriptor } from '@ai-team/core';
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
  group: 'workflow',
  parameters: _listWorkflowsOrchestrationCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['workflow', 'orchestration'],
} satisfies ICommandDescriptor;

export class ListWorkflowsOrchestrationCommand implements ICommand<ListParams, WorkflowListResult> {
  static readonly schema = _listWorkflowsOrchestrationCommandSchema;
  readonly metadata = ListWorkflowsOrchestrationCommandMetadata;
  readonly key = ListWorkflowsOrchestrationCommandMetadata.key;
  readonly group = ListWorkflowsOrchestrationCommandMetadata.group;

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

  async execute(_params: ListParams, _unusedOrCtx?: unknown, _ctx?: unknown): Promise<any> {
    const workflows = this.catalog.listWorkflowIds();
    return {
      type: 'workflow_list_result',
      workflows,
      timestamp: new Date().toISOString(),
    };
  }
}

type DefinitionParams = z.infer<typeof WorkflowDefinitionOrchestrationCommand.schema>;
const _workflowDefinitionOrchestrationCommandSchema = z.object({});

export class WorkflowDefinitionOrchestrationCommand implements ICommand<
  DefinitionParams,
  WorkflowDefinitionApiResponse
> {
  static readonly schema = _workflowDefinitionOrchestrationCommandSchema;
  readonly metadata: ICommandDescriptor<DefinitionParams>;
  readonly key: string;
  readonly group = 'workflow';

  constructor(
    private readonly workflowId: string,
    private readonly catalog: IWorkflowCatalog
  ) {
    this.key = workflowId;
    this.metadata = {
      key: workflowId,
      description: `Return the workflow definition for '${workflowId}' in JSON and YAML.`,
      availableIn: { chat: true, cli: true, tool: true },
      group: 'workflow',
      parameters: _workflowDefinitionOrchestrationCommandSchema,
      permissionCheck: { type: 'none' },
      tags: ['workflow', 'orchestration'],
    };
  }

  async execute(_params: DefinitionParams, _unusedOrCtx?: unknown, _ctx?: unknown): Promise<any> {
    return this.catalog.getWorkflowDefinition(this.workflowId);
  }
}

function makeResolverBackedCatalog(
  base: IWorkflowCatalog,
  resolvers: Record<string, WorkflowDefinitionResolver>
): IWorkflowCatalog {
  return {
    listWorkflowIds: () => base.listWorkflowIds(),
    getWorkflowDefinition: async (id: string) => {
      const resolver = resolvers[id];
      if (resolver) {
        return {
          workflowId: id,
          format: resolver.format,
          definitionJson: resolver.getJson(),
          definitionYaml: resolver.getYaml(),
        };
      }
      return base.getWorkflowDefinition(id);
    },
  };
}

export function createWorkflowDefinitionCommands(
  catalog: IWorkflowCatalog,
  resolvers?: Record<string, WorkflowDefinitionResolver>
): ICommand<unknown, unknown>[] {
  const effectiveCatalog = resolvers ? makeResolverBackedCatalog(catalog, resolvers) : catalog;
  const commands: ICommand<unknown, unknown>[] = [new ListWorkflowsOrchestrationCommand(catalog)];

  for (const workflowId of effectiveCatalog.listWorkflowIds()) {
    commands.push(new WorkflowDefinitionOrchestrationCommand(workflowId, effectiveCatalog));
  }

  return commands;
}
