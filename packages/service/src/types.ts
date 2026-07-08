import type { IMessageStorage, ICommandRegistry } from '@ai-team/core';
import { CORE_SERVICE_TOKENS, Token } from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { ToolManager } from './tools/tool-manager.js';
import type { SessionManager } from './session-manager.js';
import type { ToolDispatchSupportService } from './orchestrator/services/tool-dispatch-support-service.js';
import type { ToolSerializationService } from './orchestrator/services/tool-serialization-service.js';
import type { ToolSchemaService } from './orchestrator/services/schema-service.js';
import type { IEmitService } from '@ai-team/core';
import type { IQuestionService } from './questions/question-service.js';
import type { IWorkflowRunnerFactory } from './workflow/runner.js';

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
  WorkflowRunnerFactory: new Token<IWorkflowRunnerFactory>('WorkflowRunnerFactory'),
} as const;
