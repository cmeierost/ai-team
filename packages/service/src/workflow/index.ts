// Legacy stateful workflow exports removed - use WorkflowRunner instead

export {
  WorkflowRunner,
  WorkflowRunnerFactory,
  workflowDescriptor,
  type IWorkflowLocalCommand,
  type IWorkflowRunner,
  type IWorkflowRunnerFactory,
  type WorkflowRunOptions,
} from './xstate-workflow-runner.js';

export {
  workflowCommand,
  isWorkflowCommand,
  type IWorkflowCommand,
} from './workflow-command.js';
export { OrdinaryCommandActorAdapter } from './command-actor-adapter.js';
export { WorkflowCommandActorAdapter } from './workflow-command-actor-adapter.js';
export { CommandActorAdapterResolver } from './command-actor-adapter-resolver.js';
export { WORKFLOW_SERVICE_TOKENS } from './workflow-service-tokens.js';
export { WorkflowActorHost } from './workflow-actor-host.js';
export { WorkflowInteractionRouter } from './workflow-interaction-router.js';
export {
  createDurableChatActor,
  type DurableChatActorContext,
  type DurableChatActorEvent,
  type DurableChatActorInput,
  type DurableChatActorServices,
  type DurableChatCompletionResult,
  type DurableChatTurnResult,
} from './durable-chat-actor.js';

// Workflow composition examples and utilities
export {
  createApprovalWorkflow,
  createHiringProcessWorkflow,
  registerComposableWorkflows,
} from './workflow-composition-example.js';

export {
  WorkflowAbortError,
  type WorkflowArgValue,
  type WorkflowCommandStep,
  type WorkflowDefinition,
  type WorkflowExecuteStep,
  type WorkflowLoopStep,
  type WorkflowReturnDefinition,
  type WorkflowResult,
  type WorkflowStep,
} from './workflow-types.js';

export {
  evaluateWorkflowCondition,
  getUnresolvedParamNames,
  hasUnresolvedParams,
  resolveParamsAsync,
  resolveTemplateData,
  resolveTemplateExpressions,
  type IParamResolverContext,
} from './workflow-param-resolver.js';

export { workflowDefinitionJsonToYaml, workflowDefinitionYamlToJson } from './definition-format.js';
export {
  getWorkflowDefinitionResolvers,
  listWorkflowDefinitionIds,
  type WorkflowDefinitionResolver,
} from './definition-catalog.js';

export {
  JsonWorkflowSchema,
  JsonWorkflowTool,
  type JsonWorkflow,
  type JsonWorkflowResult,
} from './json-workflow-tool.js';

export * from './chat/index.js';
