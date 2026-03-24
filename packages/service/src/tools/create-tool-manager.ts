/**
 * Application bootstrap: creates a fully-wired ToolManager.
 *
 * This is a SERVICE-LAYER concern — it knows about all tools across all layers:
 *   core domain tools  (file, search, agent, hr intrinsics)
 *   service orchestration tools (com_handoff, hr_hire, fs_who_should, tool_list, team_list)
 *
 * Orchestration tools receive their dependencies at construction time via
 * OrchestrationDeps — Dependency Inversion keeps tools testable in isolation.
 *
 * Call createToolManager() once at startup (in service/src/index.ts or
 * the server/CLI entry point), then pass the instance down via OrchestratorContext.
 *
 * To add a tool: call toolManager.register(myTool) after creation.
 * No other file needs to change — Open/Closed.
 */

import { ToolManager, ALL_TOOLS } from '@ai-team/core';
import type { LspProvider } from '@ai-team/ide-interface';
import {
  createOrchestrationTools,
  type OrchestrationDeps,
} from './orchestration-tools.js';

export type { OrchestrationDeps } from './orchestration-tools.js';

export interface CreateToolManagerOptions {
  permissionEngine?: ConstructorParameters<typeof ToolManager>[1];
  lsp?: LspProvider;
}

/**
 * Create a ToolManager seeded with all built-in tools.
 *
 * @param workspaceRoot  Absolute path to the workspace root (used by ContextManager
 *                       inside ToolManager for permission checks).
 * @param deps           Dependencies injected into the orchestration tools (sessions,
 *                       agents, tools). These are narrow interfaces — any compatible
 *                       implementation (e.g. a mock) can be used.
 */
export function createToolManager(
  workspaceRoot: string,
  deps: OrchestrationDeps,
  permissionEngineOrOptions?: ConstructorParameters<typeof ToolManager>[1] | CreateToolManagerOptions,
): ToolManager {
  // Backward compat: accept bare PermissionEngine or options object
  const opts: CreateToolManagerOptions = permissionEngineOrOptions && typeof permissionEngineOrOptions === 'object' && 'lsp' in permissionEngineOrOptions
    ? permissionEngineOrOptions
    : { permissionEngine: permissionEngineOrOptions as any };

  const manager = new ToolManager(workspaceRoot, opts.permissionEngine);

  if (opts.lsp) {
    manager.setLspProvider(opts.lsp);
  }

  // 1. Core domain tools (file, search, code-analysis, agent, hr intrinsics)
  for (const tool of Object.values(ALL_TOOLS)) {
    manager.register(tool);
  }

  // 2. Orchestration tools — factory-constructed with injected dependencies
  for (const tool of createOrchestrationTools(deps)) {
    manager.register(tool);
  }

  return manager;
}
