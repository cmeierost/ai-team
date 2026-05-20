import type {
  ICommand,
  ICommandRegistry,
  ExecutionContext,
  IServiceContainer,
  IConfigurationStorage,
  ISkillManager,
} from '@ai-team/core';
import {
  buildDynamicSlashCatalog,
  buildDynamicSlashCommands,
} from '../../orchestrator/dynamic-slash/catalog.js';
import { readDynamicSlashCatalogConfig } from '../../orchestrator/dynamic-slash/config.js';
import type { ChatRuntimeHooks } from '../../orchestrator/hooks.js';
import { createCommandDispatcher } from '../../command-dispatcher.js';

export interface BuildChatSlashCommandsParams {
  workspaceRoot: string;
  chatToolManager: ICommandRegistry;
  skillManager: ISkillManager;
  configurationStorage: Pick<IConfigurationStorage, 'loadEffectiveConfigAsync'>;
  serviceContainer: IServiceContainer;
  hooks: ChatRuntimeHooks;
  currentSessionId: string;
  executionContext: ExecutionContext;
}

export async function buildChatSlashCommands(
  params: BuildChatSlashCommandsParams
): Promise<ICommand<string, unknown>[]> {
  const {
    workspaceRoot,
    skillManager,
    configurationStorage,
    serviceContainer,
    hooks,
    currentSessionId,
    executionContext,
  } = params;

  const staticSlashCommands: ICommand<string, unknown>[] = [];

  const reservedSlashKeys = new Set<string>();

  const dynamicSlashCatalog = await buildDynamicSlashCatalog({
    workspaceRoot,
    skillManager,
    reservedKeys: reservedSlashKeys,
    dynamicSlashCatalog: readDynamicSlashCatalogConfig(
      await configurationStorage.loadEffectiveConfigAsync(workspaceRoot)
    ),
  });

  const dynamicSourceByKey = new Map<string, string>();
  for (const entry of dynamicSlashCatalog.entries) {
    dynamicSourceByKey.set(entry.key, entry.source);
  }
  const dynamicSlashCommands = buildDynamicSlashCommands(dynamicSlashCatalog.entries);

  const dispatcher = createCommandDispatcher(workspaceRoot, serviceContainer.child());
  const existingSlashKeys = new Set<string>();
  for (const command of [...staticSlashCommands, ...dynamicSlashCommands]) {
    existingSlashKeys.add(command.key.toLowerCase());
    for (const alias of command.aliases ?? []) {
      existingSlashKeys.add(alias.toLowerCase());
    }
  }

  const resolverSlashCommands: ICommand<string, unknown>[] = dispatcher
    .getCommands({ chat: true })
    .filter((entry) => !existingSlashKeys.has(entry.key.toLowerCase()))
    .map((entry) => ({
      key: entry.key,
      aliases: entry.aliases,
      usage: entry.usage,
      description: entry.description,
      availableIn: { chat: true, tool: Boolean(entry.availableIn.tool), cli: false },
      execute: async (rawArgs: string) => {
        if (entry.key === 'help') {
          const help = new (await import('../help/help.command.js')).HelpChatCommand(() =>
            [...staticSlashCommands, ...dynamicSlashCommands, ...resolverSlashCommands].map(
              (command) => ({
                key: command.key,
                usage: command.usage,
                description: command.description,
                availableIn: command.availableIn,
                path: dynamicSourceByKey.has(command.key)
                  ? ['dynamic', dynamicSourceByKey.get(command.key) ?? 'dynamic']
                  : command.path,
              })
            )
          );
          return help.execute(rawArgs, executionContext);
        }

        const invokeContext = {
          ...(hooks as unknown as Record<string, unknown>),
          signal: hooks.signal,
          emit: hooks.emit,
          questionInput: hooks.questionInput,
          questionConfirm: hooks.questionConfirm,
          questionSelect: hooks.questionSelect,
          questionPassword: hooks.questionPassword,
          questionChecklist: hooks.questionChecklist,
          workflowState: hooks.workflowState,
          onWorkflowFrame: hooks.onWorkflowFrame,
          sessionId: currentSessionId,
        };

        const payload =
          entry.input?.mode === 'structured' && rawArgs.trim().length === 0 ? {} : rawArgs;
        const response = await dispatcher.dispatch({ command: entry.key, payload }, invokeContext);
        if (response.status === 'error') {
          return {
            status: 'error' as const,
            message: response.message,
            error: {
              code: response.error?.code ?? 'COMMAND_DISPATCH_FAILED',
              message: response.message,
              details: response.error?.details,
            },
          };
        }

        return {
          status: 'ok' as const,
          message: response.message,
          data: response.data,
        };
      },
    }));

  return [...dynamicSlashCommands, ...resolverSlashCommands];
}
