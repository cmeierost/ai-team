/**
 * Application bootstrap: creates a fully-wired ToolManager.
 *
 * This is a SERVICE-LAYER concern — it knows about all tools across all layers:
 *   core domain tools  (file, search, agent, hr intrinsics)
 *   service orchestration tools (com_handoff, hr_hire, fs_who_should, tool_list, team_list)
 *
 * Orchestration tools are resolved via IServiceContainer constructor injection.
 *
 * Call createToolManager() once at startup (in service/src/index.ts or
 * the server/CLI entry point), then pass the instance down via ExecutionContext.
 *
 * To add a tool: call toolManager.register(myTool) after creation.
 * No other file needs to change — Open/Closed.
 */

import { ToolManager } from './tool-manager.js';
import { ALL_TOOLS } from './catalog/index.js';
import type { Agent, ICommand, IServiceContainer, LspProvider } from '@ai-team/core';
import { createOrchestrationTools } from './orchestration-tools.js';
import { getWorkflowDefinitionResolvers } from '../workflow/index.js';

export interface PathPermissionCheckerLike {
  canReadPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canWritePath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  canListPath(workspaceRoot: string, permissions: unknown, filePath: string): boolean;
  assertCanReadPath(
    workspaceRoot: string,
    contextId: string,
    permissions: unknown,
    filePath: string
  ): void;
  assertCanWritePath(
    workspaceRoot: string,
    contextId: string,
    permissions: unknown,
    filePath: string
  ): void;
}

export interface CreateToolManagerOptions {
  lsp?: LspProvider;
  pathPermissionChecker: PathPermissionCheckerLike;
  /** DI container forwarded into every tool's ExecutionContext.resolve. */
  container: IServiceContainer;
  /** Narrow dependency bag for tools that mutate agent/config documents. */
  agentManagementDeps?: any;
}

function isServiceContainer(candidate: unknown): candidate is IServiceContainer {
  return Boolean(
    candidate &&
    typeof candidate === 'object' &&
    'resolve' in candidate &&
    typeof (candidate as IServiceContainer).resolve === 'function' &&
    'child' in candidate &&
    typeof (candidate as IServiceContainer).child === 'function' &&
    'registerInstance' in candidate &&
    typeof (candidate as IServiceContainer).registerInstance === 'function' &&
    'registerTransient' in candidate &&
    typeof (candidate as IServiceContainer).registerTransient === 'function'
  );
}

/**
 * Create a ToolManager seeded with all built-in tools.
 *
 * @param workspaceRoot  Absolute path to the workspace root (used by ToolManager
 *                       for permission checks).
 * @param deps           Dependencies injected into the orchestration tools (sessions,
 *                       agents, tools). These are narrow interfaces — any compatible
 *                       implementation (e.g. a mock) can be used.
 */
export function createToolManager(
  workspaceRoot: string,
  options: CreateToolManagerOptions
): ToolManager {
  if (!options.pathPermissionChecker) {
    throw new Error('createToolManager requires options.pathPermissionChecker');
  }
  const opts: CreateToolManagerOptions = options;

  const manager = new ToolManager(workspaceRoot, opts.pathPermissionChecker);

  if (opts.lsp) {
    manager.setLspProvider(opts.lsp);
  }

  manager.setContainer(opts.container);

  // 1. Core domain tools (file, search, code-analysis, agent, hr intrinsics)
  for (const tool of Object.values(ALL_TOOLS)) {
    manager.register(tool);
  }

  if (opts.agentManagementDeps) {
    for (const tool of [] /* createAgentManagementTools removed */) {
      manager.register(tool);
    }
  }

  // 2. Orchestration tools — factory-constructed with injected dependencies
  const orchestrationResolver = isServiceContainer(opts.container) ? opts.container : undefined;
  if (!orchestrationResolver) {
    throw new Error(
      'createToolManager requires options.container with full IServiceContainer for orchestration command resolution'
    );
  }

  // ToolManager is the single source of truth for registered workflows.
  // listWorkflowIds reads from the manager (post-registration, at call time).
  // getWorkflowDefinition reads the getDefinition() method carried on each workflow tool.
  const workflowCatalog = {
    listWorkflowIds(): string[] {
      return manager
        .getAll()
        .filter((t) => t.group === 'workflow' && t.key !== 'list')
        .map((t) => t.key);
    },
    async getWorkflowDefinition(workflowId: string) {
      const tool = manager.get(`workflow_${workflowId}`) as
        | (ICommand & { getDefinition?: () => unknown })
        | undefined;
      if (!tool?.getDefinition) {
        throw new Error(`Workflow definition '${workflowId}' is not available.`);
      }
      return tool.getDefinition() as import('@ai-team/api-contracts').WorkflowDefinitionApiResponse;
    },
  };

  const workflowResolvers = getWorkflowDefinitionResolvers();

  for (const tool of createOrchestrationTools(orchestrationResolver, {
    tools: {
      whoCanExecute: (toolName: string, args: unknown, agents: Agent[]) =>
        manager.whoCanExecute(toolName, args, agents),
      catalog: (agent: Agent) => manager.catalog(agent),
    },
    workflows: workflowCatalog,
    workflowResolvers,
  })) {
    manager.register(tool);
  }

  return manager;
}
