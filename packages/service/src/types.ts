import type { IMessageStorage, ICommandRegistry } from '@ai-team/core';
import { CORE_SERVICE_TOKENS, Token } from '@ai-team/core';
import type { IContextService, ICommandDispatcher } from '@ai-team/api-contracts';
import type { ToolManager } from './tooling/manager/tool-manager.js';
import type { SessionManager } from './sessions/session-manager.js';
import type { ToolDispatchSupportService } from './workflow/runtime/tools/tool-dispatch-support-service.js';
import type { ToolSerializationService } from './workflow/runtime/tools/tool-serialization-service.js';
import type { ToolSchemaService } from './workflow/runtime/tools/schema-service.js';
import type { IEmitService } from '@ai-team/core';
import type { IQuestionService } from './interaction/question-service.js';
import type { IWorkflowRunnerFactory } from './workflow/index.js';
import type { IChatRuntime } from './workflow/chat/chat-runtime.js';

export const COMMAND_FACTORY_TOKENS = {
  ...CORE_SERVICE_TOKENS,

  // Service uses API-contract-specialized generics for these core interfaces.
  QuestionService: new Token<IQuestionService>('QuestionService'),
  EmitService: new Token<IEmitService>('EmitService'),

  ToolManager: new Token<ToolManager>('ToolManager'),
  SessionManager: new Token<SessionManager>('SessionManager'),
  ToolDispatchSupportService: new Token<ToolDispatchSupportService>('ToolDispatchSupportService'),
  ToolSerializationService: new Token<ToolSerializationService>('ToolSerializationService'),
  ToolSchemaService: new Token<ToolSchemaService>('ToolSchemaService'),
  ContextService: new Token<Pick<IContextService, 'getContextEstimate'>>('ContextService'),
  MessageStorage: new Token<IMessageStorage>('MessageStorage'),
  CommandRegistry: new Token<ICommandRegistry>('CommandRegistry'),
  CommandDispatcher: new Token<ICommandDispatcher>('CommandDispatcher'),
  WorkflowRunnerFactory: new Token<IWorkflowRunnerFactory>('WorkflowRunnerFactory'),
  ChatRuntime: new Token<IChatRuntime>('ChatRuntime'),
} as const;
