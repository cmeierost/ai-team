/**
 * Bootstrap — wires the full service graph into a ServiceContainer.
 *
 * This is the ONLY place that knows the concrete implementations.
 * All other modules depend on TOKENS — they never import concrete classes.
 *
 * Plugin override pattern (Open/Closed):
 *   const c = createContainer({ workspaceRoot });
 *   c.register(TOKENS.RagProvider, () => new MyVectorRagProvider(...));
 *   // First resolve() picks up the override — before any dependent resolves.
 *
 * Self-referential ToolManager:
 *   ToolManager IS the IToolCatalog. OrchestrationDeps.tools needs IToolCatalog
 *   at construction time, but ToolManager isn't built yet. Broken with a thunk:
 *   a plain object that closes over `manager` and delegates after assignment.
 *   This is safe because tool.execute() is only ever called after construction.
 */

import {
  AgentManager,
  ContextManager,
  LlmService,
  SkillManager,
  ToolManager,
} from '@ai-team/core';
import { SessionManager } from '../session-manager.js';
import { createSqliteStorage } from '../storage/index.js';
import { createToolManager } from '../tools/create-tool-manager.js';
import type { OrchestrationDeps } from '../tools/orchestration-tools.js';
import { NoOpCompressor } from '../orchestrator/defaults/context-compressor.js';
import { DefaultContextBuilder } from '../orchestrator/defaults/context-builder.js';
import {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from '../orchestrator/defaults/context-enrichers.js';
import { NoOpRagProvider } from '../orchestrator/defaults/rag-provider.js';
import { DefaultToolResolver } from '../orchestrator/defaults/tool-resolver.js';
import { NoOpMcpGateway } from '../orchestrator/defaults/mcp-gateway.js';
import { DefaultLlmSelector } from '../orchestrator/defaults/llm-selector.js';
import { DefaultOutputHandler } from '../orchestrator/defaults/output-handler.js';
import { buildDefaultSlashCommands } from '../orchestrator/slash-commands.js';
import { ServiceContainer } from './container.js';
import { TOKENS } from './tokens.js';

export interface BootstrapConfig {
  /** Absolute path to workspace root. */
  workspaceRoot: string;
}

/**
 * Wire the full service graph. All registrations are lazy — nothing is
 * constructed until the first resolve(). Override any token after this call
 * and before the first resolve of a dependent to swap implementations.
 */
export function createContainer(config: BootstrapConfig): ServiceContainer {
  const c = new ServiceContainer();

  // ── Primitives ─────────────────────────────────────────────────────────────

  c.registerInstance(TOKENS.WorkspaceRoot, config.workspaceRoot);

  // ── Storage ────────────────────────────────────────────────────────────────

  c.registerSingleton(TOKENS.MessageStorage, c =>
    createSqliteStorage(c.resolve(TOKENS.WorkspaceRoot)),
  );

  // ── Core services ──────────────────────────────────────────────────────────

  c.registerSingleton(TOKENS.LlmService, c =>
    new LlmService(c.resolve(TOKENS.WorkspaceRoot)),
  );

  c.registerSingleton(TOKENS.AgentManager, c =>
    new AgentManager(c.resolve(TOKENS.WorkspaceRoot)),
  );

  c.registerSingleton(TOKENS.SkillManager, c =>
    new SkillManager(c.resolve(TOKENS.WorkspaceRoot)),
  );

  c.registerSingleton(TOKENS.ContextManager, c =>
    new ContextManager(c.resolve(TOKENS.WorkspaceRoot)),
  );

  c.registerSingleton(TOKENS.SessionManager, c =>
    new SessionManager(
      c.resolve(TOKENS.WorkspaceRoot),
      c.resolve(TOKENS.MessageStorage),
      c.resolve(TOKENS.AgentManager),
    ),
  );

  // ── ToolManager — self-referential via thunk ───────────────────────────────
  //
  // `manager` is assigned synchronously inside the factory before any
  // tool.execute() could ever fire, so the thunk delegation is always safe.

  c.registerSingleton(TOKENS.ToolManager, c => {
    let manager: ToolManager;

    const deps: OrchestrationDeps = {
      sessions: c.resolve(TOKENS.SessionManager),
      agents:   c.resolve(TOKENS.AgentManager),
      tools: {
        whoCanExecute: (toolName, args, agents) => manager.whoCanExecute(toolName, args, agents),
        catalog:       agent                    => manager.catalog(agent),
      },
    };

    manager = createToolManager(c.resolve(TOKENS.WorkspaceRoot), deps);
    return manager;
  });

  // ── Pipeline plugin defaults ───────────────────────────────────────────────
  // Every slot has a no-op or sensible default. Replace any token after
  // createContainer() to plug in a real implementation.

  c.registerSingleton(TOKENS.ContextCompressor, () => new NoOpCompressor());
  c.registerSingleton(TOKENS.ContextBuilder,    () => new DefaultContextBuilder());

  // Enrichers get ctx at call-time so no constructor deps needed here.
  c.registerSingleton(TOKENS.ContextEnrichers, () => [
    new WorkspaceOverviewEnricher(),
    new TeamRosterEnricher(),
  ]);

  c.registerSingleton(TOKENS.RagProvider,   () => new NoOpRagProvider());
  c.registerSingleton(TOKENS.ToolResolver,  () => new DefaultToolResolver());
  c.registerSingleton(TOKENS.McpGateway,    () => new NoOpMcpGateway());
  c.registerSingleton(TOKENS.LlmSelector,   () => new DefaultLlmSelector());
  c.registerSingleton(TOKENS.OutputHandler, () => new DefaultOutputHandler());
  c.registerSingleton(TOKENS.SlashCommands, () => buildDefaultSlashCommands());

  return c;
}
