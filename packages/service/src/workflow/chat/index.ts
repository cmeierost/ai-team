// Legacy ChatLoopEngine removed - use ChatRuntime with XState WorkflowRunner instead

export {
  chatHandoffTransitionResultSchema,
  chatWorkflowIdSchema,
  chatPostTurnOutcomeSchema,
  chatPostTurnResolutionResultSchema,
  chatPreturnOutcomeSchema,
  chatPreturnResultSchema,
  chatSendTurnResultSchema,
  chatToolCallSchema,
  chatToolRoundOutcomeSchema,
  chatToolRoundResultSchema,
  workflowSessionPolicySchema,
  workflowToolPolicySchema,
  parseChatHandoffTransitionResult,
  parseChatPostTurnResolutionResult,
  parseChatPreturnResult,
  parseChatSendTurnResult,
  parseChatToolRoundResult,
  type ChatHandoffTransitionResult,
  type ChatPreturnOutcome,
  type ChatPreturnResult,
  type ChatWorkflowId,
  type ChatPostTurnOutcome,
  type ChatPostTurnResolutionResult,
  type ChatSendTurnResult,
  type ChatToolCall,
  type ChatToolRoundOutcome,
  type ChatToolRoundResult,
  type WorkflowSessionPolicy,
  type WorkflowToolPolicy,
} from './chat-loop-contracts.js';

export {
  ChatRuntime,
  createChatRuntimeStepCommand,
  type ChatRuntimeStepContractMap,
  type ChatRuntimeRunInput,
  type IChatRuntimeStepCommand,
  type ChatRuntimeStepName,
  type ChatRuntimeStepResolver,
  type ChatRuntimeTurnInput,
  type ChatRuntimeTurnResult,
  type IChatRuntime,
} from './chat-runtime.js';

export {
  WorkflowPreTurnIntentResolver,
  type IWorkflowToolSource,
  type WorkflowAskChoice,
  type WorkflowAskSpec,
  type WorkflowIntentProvider,
  type WorkflowPreTurnIntent,
  type WorkflowPreTurnIntentResolverOptions,
  type WorkflowScoredIntentCandidate,
} from './preturn-intent-resolver.js';

export {
  ChatSkillService,
  type ChatSkillResolutionInput,
  type ChatSkillResolutionResult,
  type ChatSkillServiceDependencies,
  type IChatSkillService,
} from './chat-skill-service.js';

export { HANDOFF_AUTO_REACT_MESSAGE } from './handoff-auto-react.js';
export { CommandChatRuntime } from './command-chat-runtime.js';
export {
  HandoffSubWorkflow,
  type HandoffSubWorkflowInput,
  type HandoffSubWorkflowResult,
} from './handoff-subworkflow.js';

// Legacy send-turn-machine removed - use ChatRuntime with XState WorkflowRunner instead

export {
  createSendTurnStepCommand,
  createSendTurnStepCommands,
  type SendTurnStepName,
  type SendTurnStepResolver,
  type SendTurnStepCommandMap,
  type SendTurnStepCommandInputMap,
  type SendTurnStepCommandOutputMap,
} from './send-turn-step-commands.js';

// Legacy send-turn-contracts removed

export {
  RecentTurnsContextCompressor,
  RegistryMcpGateway,
  SearchHintRagProvider,
} from './runtime-plugin-services.js';

export {
  DefaultContextBuilder,
  DefaultLlmSelector,
  DefaultOutputHandler,
  DefaultToolResolver,
  HandoffToolResultParser,
  TeamRosterEnricher,
  WorkspaceOverviewEnricher,
  buildDefaultTurnResultParsers,
} from './runtime-defaults.js';
