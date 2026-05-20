/**
 * Application bootstrap: creates a fully-wired ToolManager.
 *
 * This is a SERVICE-LAYER concern — it resolves all tools through the ICommandRegistry,
 * which is the single source of truth for registered commands/tools.
 *
 * All tool registration happens once in the service layer (register-service-layer-services.ts),
 * not here. This function simply resolves the registry and seeds the ToolManager from it.
 *
 * Call createToolManager() once at startup (in service/src/index.ts or
 * the server/CLI entry point), then pass the instance down via ExecutionContext.
 *
 * To add a tool: register it in register-service-layer-services.ts in the CommandRegistry,
 * not here. No other file needs to change — Open/Closed.
 */

import type { Agent, ICommand, IServiceContainer, IPathPermissionChecker } from '@ai-team/core';
import { ToolManager } from './tool-manager.js';
import { createOrchestrationTools } from './orchestration-tools.js';
import { getWorkflowDefinitionResolvers } from '../workflow/index.js';
import { COMMAND_FACTORY_TOKENS } from '../types.js';

export interface CreateToolManagerOptions {
  pathPermissionChecker: IPathPermissionChecker;
  /** DI container to resolve CommandRegistry and forward into tool ExecutionContext. */
  container: IServiceContainer;
}

/**
 * Create a ToolManager seeded with all built-in tools from the CommandRegistry.
 *
 * @param workspaceRoot  Absolute path to the workspace root (used by ToolManager
 *                       for permission checks).
 * @param options        Dependencies: pathPermissionChecker, container.
 */
export function createToolManager(
  workspaceRoot: string,
  options: CreateToolManagerOptions
): ToolManager {
  if (!options.pathPermissionChecker) {
    throw new Error('createToolManager requires options.pathPermissionChecker');
  }

  // Resolve CommandRegistry (single source of truth for all tools)
  const registry = options.container.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry);

  const manager = new ToolManager(
    workspaceRoot,
    options.pathPermissionChecker,
    registry,
    options.container
  );

  // 2. Orchestration tools — factory-constructed with injected dependencies
  // ToolManager is the single source of truth for registered workflows.
  // listWorkflowIds reads from the manager (post-registration, at call time).
  // getWorkflowDefinition reads the getDefinition() method carried on each workflow tool.
  const workflowCatalog = {
    listWorkflowIds(): string[] {
      return registry
        .getAll({ availableIn: { tool: true }, group: 'workflow' })
        .filter((t) => t.key !== 'list')
        .map((t) => t.key);
    },
    async getWorkflowDefinition(workflowId: string) {
      const tool = registry.get(`workflow_${workflowId}`);
      const command = isToolCommand(tool) ? tool : undefined;
      const definition = hasDefinition(tool) ? tool.getDefinition : undefined;
      if (!command?.availableIn?.tool || !definition) {
        throw new Error(`Workflow definition '${workflowId}' is not available.`);
      }
      return definition() as import('@ai-team/api-contracts').WorkflowDefinitionApiResponse;
    },
  };

  const workflowResolvers = getWorkflowDefinitionResolvers();

  for (const tool of createOrchestrationTools(options.container, {
    tools: {
      whoCanExecute: (toolName: string, args: unknown, agents: Agent[]) =>
        manager.whoCanExecute(toolName, args, agents),
      catalog: (agent: Agent) => manager.catalog(agent),
    },
    workflows: workflowCatalog,
    workflowResolvers,
  })) {
    registry.register(tool);
  }

  return manager;
}

function isToolCommand(value: unknown): value is ICommand {
  if (!value || typeof value !== 'object') return false;
  return 'availableIn' in value;
}

function hasDefinition(value: unknown): value is { getDefinition: () => unknown } {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as { getDefinition?: unknown }).getDefinition === 'function';
}
