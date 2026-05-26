/**
 * Shim — chat-commands.command was refactored into the main command dispatcher.
 * All commands with availableIn.chat=true are now registered in command-dispatcher.ts.
 * These stubs satisfy legacy import sites until they are updated.
 */
import type {
  ICommand,
  ICommandDescriptor,
  IDeveloperIdentityService,
  IAgentManager,
  ILlmService,
  IConfigurationStorage,
  IToolManager,
} from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { SessionManager } from '../../session-manager.js';
import type { ChatCommandEmitter } from '../../orchestrator/services/emit-service.js';

export type ChatCommandRegistryEntry = Pick<
  ICommandDescriptor<string>,
  | 'key'
  | 'usage'
  | 'description'
  | 'aliases'
  | 'availableIn'
  | 'path'
  | 'help'
  | 'llm'
  | 'intents'
  | 'intentExamples'
  | 'input'
>;

export interface ChatCommandDependencyOptions {
  contextService: Pick<IContextService, 'getContextEstimate'>;
  developerIdentityService: IDeveloperIdentityService;
  agentManager?: Pick<IAgentManager, 'getAgentAsync' | 'resolveAgentAsync'>;
  sessionManager?: Pick<
    SessionManager,
    | 'createSession'
    | 'getSession'
    | 'getSessionChain'
    | 'getSessionMessages'
    | 'appendMessage'
    | 'listSessionMessages'
    | 'summarizeForContextAsync'
    | 'updateToolCallLlmResult'
    | 'updateMessageContent'
    | 'setMessageHiddenFromLlm'
    | 'getOrCreateLatestSession'
  >;
  llmService?: ILlmService;
  configurationStorage?: IConfigurationStorage;
  toolManager?: IToolManager;
  emitter?: ChatCommandEmitter;
}

export interface ChatCommandListOptions {
  includeCliChat?: boolean;
}

export function buildSlashICommands(
  _deps?: ChatCommandDependencyOptions,
  _options?: ChatCommandListOptions
): Array<ICommand<string, unknown>> {
  return [];
}

export function buildChatCommandRegistry(
  _options?: ChatCommandListOptions
): ChatCommandRegistryEntry[] {
  return [];
}

export function buildChatCommandAliases(_options?: ChatCommandListOptions): Record<string, string> {
  return {};
}
