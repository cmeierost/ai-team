/**
 * Unified command dispatcher — single service-layer entry point for all commands.
 *
 * Dispatches by command key against an ICommandRegistry. The caller provides
 * a fully-constructed ExecutionContext — no interaction hooks or context
 * conversion happens here. CLI creates a fresh context from request parameters.
 */

import type {
  CommandAvailability,
  CommandDescriptor,
  CommandResponse,
  ICommandDispatcher,
} from '@ai-team/api-contracts';
import { isCommandResponse } from '@ai-team/api-contracts';
import type {
  ICommandRegistry,
  IServiceContainer,
  ExecutionContext,
  ICommand,
  TeamConfig,
  IEmitService,
} from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from './types.js';
import { resolveCommandArgs, parseArgsIntelligently } from './command-adapters.js';
import { CommandRegistry } from './command-registry-impl.js';
import type { DynamicSlashEntry } from './orchestrator/dynamic-slash/catalog.js';
import { EmitService } from './orchestrator/services/emit-service.js';
import {
  buildSkillSlashCommand,
  buildPromptSlashCommand,
  buildWorkflowSlashCommand,
} from './orchestrator/dynamic-slash/catalog.js';
import {
  AccessCanCommand,
  AccessCanCommandMetadata,
} from './commands/access/access-can.command.js';
import {
  AccessOverlapCommand,
  AccessOverlapCommandMetadata,
} from './commands/access/access-overlap.command.js';
import {
  AccessWhoCommand,
  AccessWhoCommandMetadata,
} from './commands/access/access-who.command.js';
import { AvatarCommand, AvatarCommandMetadata } from './commands/hr/avatar.command.js';
import { CreateICommand, CreateICommandMetadata } from './commands/hr/create.command.js';
import {
  CodeEditApplyCommand,
  CodeEditApplyCommandMetadata,
} from './commands/edit/edit-apply.command.js';
import {
  CodeEditApproveCommand,
  CodeEditApproveCommandMetadata,
} from './commands/edit/edit-approve.command.js';
import {
  CodeEditListCommand,
  CodeEditListCommandMetadata,
} from './commands/edit/edit-list.command.js';
import {
  CodeEditRejectCommand,
  CodeEditRejectCommandMetadata,
} from './commands/edit/edit-reject.command.js';
import { DbMigrateCommand, DbMigrateCommandMetadata } from './commands/db/db-migrate.command.js';
import { DbStatusCommand, DbStatusCommandMetadata } from './commands/db/db-status.command.js';
import { FilesAllowCommand, FilesAllowCommandMetadata } from './commands/fs/files-allow.command.js';
import { FilesDenyCommand, FilesDenyCommandMetadata } from './commands/fs/files-deny.command.js';
import {
  FilesPatternsCommand,
  FilesPatternsCommandMetadata,
} from './commands/fs/files-patterns.command.js';
import { FileTreeService } from './commands/fs/file-tree.js';
import { FireICommand, FireICommandMetadata } from './commands/hr/fire.command.js';
import { GraphCommand, GraphCommandMetadata } from './commands/team/team-graph.command.js';
import { HhRefreshCommand, HhRefreshCommandMetadata } from './commands/hr/hr-refresh.command.js';
import { HireICommand, HireICommandMetadata } from './commands/hr/hire.command.js';
import { OrgCommand, OrgCommandMetadata } from './commands/team/team-org.command.js';
import {
  PatchApplyCommand,
  PatchApplyCommandMetadata,
} from './commands/edit/edit-patch.command.js';
import {
  ResolveEmployeesICommand,
  ResolveEmployeesICommandMetadata,
} from './commands/team/team-resolve.command.js';
import {
  SearchAgentsICommand,
  SearchAgentsICommandMetadata,
} from './commands/team/team-search.command.js';
import { TeamListICommand, TeamListICommandMetadata } from './commands/team/team-list.command.js';
import {
  SkillsAddCommand,
  SkillsAddCommandMetadata,
} from './commands/skills/skills-add.command.js';
import {
  SkillsListCommand,
  SkillsListCommandMetadata,
} from './commands/skills/skills-list.command.js';
import {
  SkillsRemoveCommand,
  SkillsRemoveCommandMetadata,
} from './commands/skills/skills-remove.command.js';
import { InitICommand, InitICommandMetadata } from './commands/init/init.command.js';
import { InitCommand } from './commands/init/init.js';
import { SetupICommand, SetupICommandMetadata } from './commands/setup/setup.command.js';
import { OnboardICommand, OnboardICommandMetadata } from './commands/hr/onboard.js';
import { SetupCommand } from './commands/setup/setup.js';
import {
  ProviderICommand,
  ProviderCommandMetadata,
} from './commands/setup/setup-provider.command.js';
import {
  ProviderListICommand,
  ProviderListICommandMetadata,
  ProviderModelsICommand,
  ProviderModelsICommandMetadata,
  ProviderModelsRefreshICommand,
  ProviderModelsRefreshICommandMetadata,
} from './commands/setup/setup-models.command.js';
import {
  SystemInfoCommand,
  SystemInfoCommandMetadata,
} from './commands/system/system-info.command.js';
import {
  SystemStatusICommand,
  SystemStatusICommandMetadata,
} from './commands/setup/system-status.js';
import {
  TestConnectionICommand,
  TestConnectionICommandMetadata,
} from './commands/setup/setup-test.command.js';
import { TestConnectionCommand } from './commands/setup/test-connection.js';
import { WorkflowRunnerFactory } from './workflow/runner.js';
import {
  ToolsAllowCommand,
  ToolsAllowCommandMetadata,
} from './commands/tools/tools-allow.command.js';
import { ToolsDenyCommand, ToolsDenyCommandMetadata } from './commands/tools/tools-deny.command.js';
import { ToolsListCommand, ToolsListCommandMetadata } from './commands/tools/tools-list.command.js';
import { AgentToolsService } from './commands/tools/tools-service.js';
import { GovernanceService } from './governance/governance-service.js';
import { ChatCommand } from './commands/chat/chat.command.js';
import { HelpChatCommand } from './commands/help/help.command.js';
import { MetaService } from './routers/meta-service.js';

import { InfoChatCommand, InfoChatCommandMetadata } from './commands/agents/info.command.js';
import {
  TeamListChatCommand,
  TeamListChatCommandMetadata,
} from './commands/agents/team-list.command.js';
import {
  OverviewChatCommand,
  OverviewChatCommandMetadata,
} from './commands/help/overview.command.js';
import {
  SwitchChatCommand,
  SwitchChatCommandMetadata,
} from './commands/session/switch-chat.command.js';
import {
  NewSessionChatCommand,
  NewSessionChatCommandMetadata,
} from './commands/session/new-session-chat.command.js';
import { BackChatCommand, BackChatCommandMetadata } from './commands/session/back.command.js';
import {
  HistoryChatCommand,
  HistoryChatCommandMetadata,
} from './commands/session/history-chat.command.js';
import {
  InspectChatCommand,
  InspectChatCommandMetadata,
} from './commands/session/inspect-chat.command.js';
import {
  ContextAddChatCommand,
  ContextAddChatCommandMetadata,
} from './commands/session/context-add.command.js';
import {
  ContextRemoveChatCommand,
  ContextRemoveChatCommandMetadata,
} from './commands/session/context-remove.command.js';
import {
  ContextListChatCommand,
  ContextListChatCommandMetadata,
} from './commands/session/context-list.command.js';
import {
  ContextSummarizeChatCommand,
  ContextSummarizeChatCommandMetadata,
} from './commands/session/context-summarize.command.js';
import {
  SessionInfoChatCommand,
  SessionInfoChatCommandMetadata,
} from './commands/session/session-info.command.js';
import {
  SessionMessagesChatCommand,
  SessionMessagesChatCommandMetadata,
} from './commands/session/session-messages.command.js';
import {
  SessionGraphChatCommand,
  SessionGraphChatCommandMetadata,
} from './commands/session/session-graph.command.js';
import {
  SessionContextChatCommand,
  SessionContextChatCommandMetadata,
} from './commands/session/session-context.command.js';
import {
  HttpFetchChatCommand,
  HttpFetchChatCommandMetadata,
} from './commands/http/http-fetch-chat.command.js';
import {
  HttpCrawlChatCommand,
  HttpCrawlChatCommandMetadata,
} from './commands/http/http-crawl-chat.command.js';
import { RunShellChatCommand, RunShellChatCommandMetadata } from './commands/cli/run.command.js';
import {
  ListWorkflowsOrchestrationCommand,
  ListWorkflowsOrchestrationCommandMetadata,
} from './commands/workflow/workflow-tools.command.js';

function createMinimalExecutionContext(): ExecutionContext {
  return {
    history: [],
  };
}

// ── Dispatcher ────────────────────────────────────────────────────────────────

/**
 * Resolves commands from an ICommandRegistry and executes them with a
 * caller-provided ExecutionContext. No context conversion happens here.
 */
export class CommandDispatcher implements ICommandDispatcher {
  private readonly _directHandlers: Map<
    string,
    (workspaceRoot: string, payload: unknown, ctx: ExecutionContext) => Promise<CommandResponse>
  > = new Map();
  private readonly _directCommands: Map<string, ICommand<unknown, unknown>> = new Map();

  constructor(
    private readonly registry: ICommandRegistry,
    private readonly resolver: IServiceContainer
  ) {}

  private resolveWorkspaceRoot(): string {
    try {
      return this.resolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot);
    } catch {
      return '';
    }
  }

  register(entry: {
    key: string;
    description: string;
    availableIn: CommandAvailability;
    handler: (
      workspaceRoot: string,
      payload: unknown,
      ctx: ExecutionContext
    ) => Promise<CommandResponse>;
  }): void {
    this._directHandlers.set(entry.key, entry.handler);
    try {
      this.registry.register(
        { key: entry.key, description: entry.description, availableIn: entry.availableIn },
        () =>
          ({
            metadata: {
              key: entry.key,
              description: entry.description,
              availableIn: entry.availableIn,
            },
            execute: async (params: unknown, ctx: ExecutionContext) =>
              entry.handler(this.resolveWorkspaceRoot(), params, ctx),
          }) as unknown as ICommand<unknown, unknown>
      );
    } catch {
      // duplicate key — already registered
    }
  }

  registerCommand<TIn, TOut>(cmd: ICommand<TIn, TOut>): void {
    this._directCommands.set(cmd.metadata.key, cmd);
  }

  async dispatchCommand<TIn, TOut>(
    command: ICommand<TIn, TOut>,
    payload: TIn
  ): Promise<CommandResponse<TOut>> {
    const key = command.metadata.key;
    // Prefer a registered handler for this key, falling back to command.execute directly
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const minimalCtx = createMinimalExecutionContext();
      return directHandler('', payload, minimalCtx) as Promise<CommandResponse<TOut>>;
    }
    const minimalCtx = createMinimalExecutionContext();
    try {
      const result = await command.execute(payload, minimalCtx);
      if (result && typeof result === 'object' && 'status' in result) {
        const r = result as CommandResponse<TOut>;
        return { ...r, message: r.message ?? '' };
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return {
        status: 'error',
        message: error instanceof Error ? error.message : 'Command dispatch failed',
        error: { code: 'COMMAND_DISPATCH_FAILED', details: error },
      };
    }
  }

  dispatch(key: string, params: unknown, ctx: ExecutionContext): Promise<CommandResponse<unknown>>;
  dispatch(request: { command: string; payload: unknown }): Promise<CommandResponse>;
  async dispatch(
    keyOrRequest: string | { command: string; payload: unknown },
    params?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    if (typeof keyOrRequest === 'object' && 'command' in keyOrRequest) {
      return this.dispatchFromRequestAsync(keyOrRequest);
    }
    return this.dispatchByKeyAsync(keyOrRequest, params, ctx);
  }

  private async dispatchFromRequestAsync(request: {
    command: string;
    payload: unknown;
  }): Promise<CommandResponse<unknown>> {
    const { command: key, payload } = request;
    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      return directHandler('', payload, createMinimalExecutionContext());
    }

    const descriptor = this.registry.get(key);
    if (!descriptor) {
      return this.unknownCommandResponse(key);
    }

    const cmd = this.registry.resolve(key, this.resolver);
    if (!cmd) {
      return this.unknownCommandResponse(key);
    }

    const result = await cmd.execute(payload, createMinimalExecutionContext());
    if (isCommandResponse(result)) {
      return { ...result, message: result.message ?? '' };
    }
    return { status: 'ok', message: '', data: result };
  }

  private async dispatchByKeyAsync(
    key: string,
    params: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<unknown>> {
    const descriptor = this.registry.get(key);
    if (!descriptor) {
      return this.unknownCommandResponse(key);
    }

    const directHandler = this._directHandlers.get(key);
    if (directHandler) {
      const executionContext = ctx ?? createMinimalExecutionContext();
      return directHandler(this.resolveWorkspaceRoot(), params, executionContext);
    }

    try {
      const executionContext = ctx ?? createMinimalExecutionContext();
      // Parse raw string args using the Zod schema from the descriptor metadata —
      // no command instantiation needed at this stage.
      const parsed =
        typeof params === 'string' && descriptor.parameters
          ? parseArgsIntelligently(params, descriptor.parameters)
          : params;

      const cmd = this.registry.resolve(key, this.resolver);
      if (!cmd) {
        return this.unknownCommandResponse(key);
      }

      const resolvedParams = resolveCommandArgs(cmd, parsed, executionContext);
      const result = await cmd.execute(resolvedParams, executionContext);
      if (isCommandResponse(result)) {
        return { ...result, message: result.message ?? '' };
      }
      return { status: 'ok', message: '', data: result };
    } catch (error) {
      return this.commandDispatchFailedResponse(error);
    }
  }

  private unknownCommandResponse(key: string): CommandResponse<unknown> {
    return {
      status: 'error',
      message: `Unknown command '${key}'`,
      error: { code: 'UNKNOWN_COMMAND', details: { key } },
    };
  }

  private commandDispatchFailedResponse(error: unknown): CommandResponse<unknown> {
    return {
      status: 'error',
      message: error instanceof Error ? error.message : 'Command dispatch failed',
      error: { code: 'COMMAND_DISPATCH_FAILED', details: error },
    };
  }

  getCommands(filter?: Partial<CommandAvailability>): CommandDescriptor[] {
    return this.registry.getAll({ availableIn: filter });
  }

  getCommand(key: string): CommandDescriptor | undefined {
    return this.registry.get(key);
  }

  /**
   * Register dynamic slash commands (loaded from workspace skills/prompts/workflows)
   * after initial construction. Registers the descriptor from entry metadata and a
   * typed factory based on the entry source. Built-in commands always win — duplicate
   * keys are silently skipped, not overwritten.
   */
  registerDynamic(entries: DynamicSlashEntry[], emitService: IEmitService): void {
    const es: IEmitService = emitService;
    for (const entry of entries) {
      try {
        const descriptor = {
          key: entry.key,
          usage: entry.usage,
          description: entry.description,
          availableIn: { chat: true, tool: false, cli: false } as const,
          group: 'chat',
          path: ['dynamic', entry.source],
        };
        this.registry.register(descriptor, () => {
          const workspaceRoot = this.resolver.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot);
          const toolManager = this.resolver.resolve(COMMAND_FACTORY_TOKENS.ToolManager);
          if (entry.source === 'workflow') {
            return buildWorkflowSlashCommand(entry, es, toolManager, workspaceRoot);
          }
          if (entry.source === 'skill') {
            return buildSkillSlashCommand(entry, es, workspaceRoot);
          }
          return buildPromptSlashCommand(entry, es);
        });
      } catch {
        // Built-in command with the same key already registered — skip silently.
      }
    }
  }
}

/**
 * Build a fully wired CommandDispatcher with all known command handlers.
 */
export function createCommandDispatcher(
  workspaceRoot: string,
  resolver?: IServiceContainer
): CommandDispatcher {
  if (!resolver) {
    throw new Error(
      'createCommandDispatcher requires a resolver. Use createContainerWithBootstrap(...).child() and pass it in.'
    );
  }

  const scopedResolver = resolver.child();
  scopedResolver.registerInstance(COMMAND_FACTORY_TOKENS.WorkspaceRoot, workspaceRoot);

  scopedResolver.registerTransient(COMMAND_FACTORY_TOKENS.ContextService, (r) => {
    return new MetaService(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
      r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
      r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
      r.resolve(COMMAND_FACTORY_TOKENS.AgentDocumentStorage)
    );
  });

  const registry = new CommandRegistry();

  // ── Access commands ────────────────────────────────────────────────────

  registry.register(
    AccessCanCommandMetadata,
    (r) =>
      new AccessCanCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
  );

  registry.register(
    AccessOverlapCommandMetadata,
    (r) => new AccessOverlapCommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    AccessWhoCommandMetadata,
    (r) =>
      new AccessWhoCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.PathPermissionChecker)
      )
  );

  // ── Service commands ───────────────────────────────────────────────────

  registry.register(
    TeamListICommandMetadata,
    (r) => new TeamListICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(InitICommandMetadata, (r) => {
    const setupCmd = new SetupCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
    );
    const onboardCmd = new OnboardICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
      r
    );
    return new InitICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      new InitCommand(
        onboardCmd,
        setupCmd,
        new TestConnectionCommand(
          null as any, // resolved below
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
          r.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
        ),
        new WorkflowRunnerFactory(r)
      )
    );
  });

  registry.register(
    SetupICommandMetadata,
    (r) =>
      new SetupICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        new SetupCommand(
          r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
          r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceStorage),
          r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
          r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
          r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
          r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
          r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
        )
      )
  );

  registry.register(
    OnboardICommandMetadata,
    (r) =>
      new OnboardICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
        r
      )
  );

  registry.register(SystemStatusICommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new SystemStatusICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
      configStorage.get() as TeamConfig
    );
  });

  // ── Provider commands ──────────────────────────────────────────────────

  registry.register(ProviderCommandMetadata, (r) => {
    return new ProviderICommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
      r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.ProviderConfigurationService)
    );
  });

  registry.register(
    ProviderListICommandMetadata,
    (r) =>
      new ProviderListICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  registry.register(
    ProviderModelsICommandMetadata,
    (r) =>
      new ProviderModelsICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  registry.register(
    ProviderModelsRefreshICommandMetadata,
    (r) =>
      new ProviderModelsRefreshICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.ModelDiscoveryRegistry)
      )
  );

  // ── Search & skills commands ───────────────────────────────────────────

  registry.register(
    SearchAgentsICommandMetadata,
    (r) => new SearchAgentsICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    ResolveEmployeesICommandMetadata,
    (r) => new ResolveEmployeesICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(
    SkillsListCommandMetadata,
    (r) =>
      new SkillsListCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager)
      )
  );

  registry.register(
    SkillsAddCommandMetadata,
    (r) =>
      new SkillsAddCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
  );

  registry.register(
    SkillsRemoveCommandMetadata,
    (r) =>
      new SkillsRemoveCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService)
      )
  );

  // ── Tools commands ─────────────────────────────────────────────────────

  registry.register(
    ToolsListCommandMetadata,
    (r) =>
      new ToolsListCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  registry.register(
    ToolsAllowCommandMetadata,
    (r) =>
      new ToolsAllowCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  registry.register(
    ToolsDenyCommandMetadata,
    (r) =>
      new ToolsDenyCommand(
        new AgentToolsService(
          r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
          r.resolve(COMMAND_FACTORY_TOKENS.ToolManager),
          new GovernanceService(
            r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
            r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
          )
        )
      )
  );

  // ── Files commands ─────────────────────────────────────────────────────

  registry.register(FilesAllowCommandMetadata, (r) => {
    const governance = new GovernanceService(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    );
    return new FilesAllowCommand(
      new FileTreeService(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        governance,
        r.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
        r.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
      ),
      governance
    );
  });

  registry.register(FilesDenyCommandMetadata, (r) => {
    const governance = new GovernanceService(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
    );
    return new FilesDenyCommand(
      new FileTreeService(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage),
        governance,
        r.resolve(COMMAND_FACTORY_TOKENS.FileTreeService),
        r.resolve(COMMAND_FACTORY_TOKENS.FileAnnotationService)
      ),
      governance
    );
  });

  registry.register(FilesPatternsCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    const fileTree = configStorage.get('fileTree') ?? {};
    return new FilesPatternsCommand(
      fileTree,
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      r.resolve(COMMAND_FACTORY_TOKENS.PermissionStorage)
    );
  });

  // ── Org commands ───────────────────────────────────────────────────────

  registry.register(
    GraphCommandMetadata,
    (r) => new GraphCommand(r.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
  );

  registry.register(
    OrgCommandMetadata,
    (r) => new OrgCommand(r.resolve(COMMAND_FACTORY_TOKENS.TeamGraphBuilder))
  );

  registry.register(
    HireICommandMetadata,
    (r) =>
      new HireICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.MarkdownSectionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
      )
  );

  registry.register(
    FireICommandMetadata,
    (r) =>
      new FireICommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager), new WorkflowRunnerFactory(r))
  );

  registry.register(
    CreateICommandMetadata,
    (r) =>
      new CreateICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SkillManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
      )
  );

  registry.register(AvatarCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new AvatarCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
      configStorage.get(),
      r.resolve(COMMAND_FACTORY_TOKENS.AvatarManager),
      r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
      r.resolve(COMMAND_FACTORY_TOKENS.EmitService)
    );
  });

  registry.register(
    HhRefreshCommandMetadata,
    (r) => new HhRefreshCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot))
  );

  // ── Utility commands ───────────────────────────────────────────────────

  registry.register(
    SystemInfoCommandMetadata,
    (r) =>
      new SystemInfoCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.SystemInfoService)
      )
  );

  registry.register(
    TestConnectionICommandMetadata,
    (r) =>
      new TestConnectionICommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmProviderTester),
        r.resolve(COMMAND_FACTORY_TOKENS.TextToolCallParser)
      )
  );

  registry.register(
    DbMigrateCommandMetadata,
    (r) => new DbMigrateCommand(r.resolve(COMMAND_FACTORY_TOKENS.MessageStorage))
  );

  registry.register(
    DbStatusCommandMetadata,
    (r) =>
      new DbStatusCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.MessageStorage)
      )
  );

  registry.register(
    PatchApplyCommandMetadata,
    (r) =>
      new PatchApplyCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.IdeAdapterFactory),
        r.resolve(COMMAND_FACTORY_TOKENS.ProposalStoreFactory)
      )
  );

  registry.register(ChatCommand.metadata, (r) => new ChatCommand(r));

  registry.register(
    CodeEditListCommandMetadata,
    (r) => new CodeEditListCommand(r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
  );

  registry.register(
    CodeEditApproveCommandMetadata,
    (r) => new CodeEditApproveCommand(r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager))
  );

  registry.register(
    CodeEditRejectCommandMetadata,
    (r) =>
      new CodeEditRejectCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
  );

  registry.register(
    CodeEditApplyCommandMetadata,
    (r) =>
      new CodeEditApplyCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.CodeEditManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService)
      )
  );

  // ── Agent chat / info commands ─────────────────────────────────────────

  registry.register(
    InfoChatCommandMetadata,
    (r) =>
      new InfoChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.QuestionService),
        r.resolve(COMMAND_FACTORY_TOKENS.EmitService),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  const sharedEmitter = EmitService.forConsole();

  registry.register(
    TeamListChatCommandMetadata,
    (r) =>
      new TeamListChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any, sharedEmitter)
  );

  registry.register(
    OverviewChatCommandMetadata,
    (r) =>
      new OverviewChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        sharedEmitter
      )
  );

  // ── Session & context commands ─────────────────────────────────────────

  registry.register(
    SwitchChatCommandMetadata,
    (r) =>
      new SwitchChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
        r.resolve(COMMAND_FACTORY_TOKENS.AgentManager),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager)
      )
  );

  registry.register(
    NewSessionChatCommandMetadata,
    (r) =>
      new NewSessionChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.DeveloperIdentityService),
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        EmitService.forConsole()
      )
  );

  registry.register(
    BackChatCommandMetadata,
    (r) => new BackChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.AgentManager))
  );

  registry.register(HistoryChatCommandMetadata, (_r) => new HistoryChatCommand());

  registry.register(
    InspectChatCommandMetadata,
    (r) => new InspectChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.QuestionService))
  );

  registry.register(
    ContextAddChatCommandMetadata,
    (r) =>
      new ContextAddChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  registry.register(
    ContextRemoveChatCommandMetadata,
    (r) => new ContextRemoveChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(
    ContextListChatCommandMetadata,
    (r) => new ContextListChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(
    ContextSummarizeChatCommandMetadata,
    (r) =>
      new ContextSummarizeChatCommand(
        r.resolve(COMMAND_FACTORY_TOKENS.SessionManager),
        r.resolve(COMMAND_FACTORY_TOKENS.LlmService)
      )
  );

  registry.register(
    SessionInfoChatCommandMetadata,
    (r) => new SessionInfoChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(SessionMessagesChatCommandMetadata, (_r) => new SessionMessagesChatCommand());

  registry.register(
    SessionGraphChatCommandMetadata,
    (r) => new SessionGraphChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.SessionManager))
  );

  registry.register(SessionContextChatCommandMetadata, (r) => {
    const configStorage = r.resolve(COMMAND_FACTORY_TOKENS.ConfigurationStorage);
    return new SessionContextChatCommand(
      r.resolve(COMMAND_FACTORY_TOKENS.ContextService),
      r.resolve(COMMAND_FACTORY_TOKENS.LlmService),
      configStorage.get() as TeamConfig
    );
  });

  // ── HTTP chat commands ─────────────────────────────────────────────────

  registry.register(
    HttpFetchChatCommandMetadata,
    (r) => new HttpFetchChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any)
  );

  registry.register(
    HttpCrawlChatCommandMetadata,
    (r) => new HttpCrawlChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.ToolManager) as any)
  );

  // ── CLI chat command ───────────────────────────────────────────────────

  registry.register(
    RunShellChatCommandMetadata,
    (r) => new RunShellChatCommand(r.resolve(COMMAND_FACTORY_TOKENS.WorkspaceRoot), sharedEmitter)
  );

  // ── Workflow commands (cli + chat) ─────────────────────────────────────

  registry.register(ListWorkflowsOrchestrationCommandMetadata, (r) => {
    const serviceCommandRegistry = r.resolve(COMMAND_FACTORY_TOKENS.CommandRegistry) as
      | ICommandRegistry
      | undefined;

    const workflowCatalog = {
      listWorkflowIds(): string[] {
        if (!serviceCommandRegistry) {
          return [];
        }

        return serviceCommandRegistry
          .getAll({ availableIn: { tool: true } })
          .filter(
            (t) =>
              t.key !== 'list' &&
              (t.group === 'workflow' || (t.tags ?? []).includes('workflow-definition'))
          )
          .map((t) => t.key);
      },
    };
    return new ListWorkflowsOrchestrationCommand(workflowCatalog as any);
  });

  // ── Dispatcher — must be created before HelpChatCommand ───────────────

  const dispatcher = new CommandDispatcher(registry, scopedResolver);

  // HelpChatCommand lazily calls dispatcher.getCommands(); register after dispatcher is created
  const helpCmd = new HelpChatCommand(() =>
    registry.getAll({ availableIn: { chat: true } }).map((entry) => ({
      key: entry.key,
      group: entry.group,
      usage: entry.usage,
      description: entry.description,
      availableIn: entry.availableIn,
      path: entry.path,
      parameters: entry.parameters,
    }))
  );
  registry.register(helpCmd.metadata, () => helpCmd);

  return dispatcher;
}
