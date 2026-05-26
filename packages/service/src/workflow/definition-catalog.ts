import type { WorkflowDefinitionDocument } from '@ai-team/api-contracts';
import { chatWorkflowIdSchema, type ChatWorkflowId } from './chat-loop-contracts.js';
import { workflowDefinitionJsonToYaml } from './definition-format.js';
import {
  getChatLoopWorkflowDefinitionJson,
  getChatLoopWorkflowDefinitionYaml,
} from './chat-loop-engine.js';
import {
  getSendTurnWorkflowDefinitionJson,
  getSendTurnWorkflowDefinitionYaml,
} from './send-turn-machine.js';

export interface WorkflowDefinitionResolver {
  format: 'workflow/v1';
  getJson: () => WorkflowDefinitionDocument;
  getYaml: () => string;
}

function cloneWithWorkflowId(
  workflowId: string,
  source: WorkflowDefinitionDocument
): WorkflowDefinitionDocument {
  return {
    ...source,
    id: workflowId,
  };
}

function aliasResolver(
  workflowId: ChatWorkflowId,
  sourceResolver: WorkflowDefinitionResolver
): WorkflowDefinitionResolver {
  return {
    format: 'workflow/v1',
    getJson: () => cloneWithWorkflowId(workflowId, sourceResolver.getJson()),
    getYaml: () =>
      workflowDefinitionJsonToYaml(cloneWithWorkflowId(workflowId, sourceResolver.getJson())),
  };
}

const primaryResolvers: Record<'chat-full-loop' | 'chat-send-turn', WorkflowDefinitionResolver> = {
  'chat-full-loop': {
    format: 'workflow/v1',
    getJson: () => getChatLoopWorkflowDefinitionJson(),
    getYaml: () => getChatLoopWorkflowDefinitionYaml(),
  },
  'chat-send-turn': {
    format: 'workflow/v1',
    getJson: () => getSendTurnWorkflowDefinitionJson(),
    getYaml: () => getSendTurnWorkflowDefinitionYaml(),
  },
};

const aliasMap: Record<
  Exclude<ChatWorkflowId, 'chat-full-loop' | 'chat-send-turn'>,
  'chat-full-loop' | 'chat-send-turn'
> = {
  'chat-preturn-interceptors': 'chat-full-loop',
  'chat-tool-round': 'chat-full-loop',
  'chat-post-turn-resolution': 'chat-full-loop',
  'chat-handoff-transition': 'chat-full-loop',
  'chat-turn-failure': 'chat-full-loop',
};

export function getWorkflowDefinitionResolvers(): Record<
  ChatWorkflowId,
  WorkflowDefinitionResolver
> {
  const resolvers = {
    'chat-full-loop': primaryResolvers['chat-full-loop'],
    'chat-send-turn': primaryResolvers['chat-send-turn'],
  } as Record<ChatWorkflowId, WorkflowDefinitionResolver>;

  const workflowIds = chatWorkflowIdSchema.options;
  for (const workflowId of workflowIds) {
    if (resolvers[workflowId]) continue;
    const sourceId =
      aliasMap[workflowId as Exclude<ChatWorkflowId, 'chat-full-loop' | 'chat-send-turn'>];
    resolvers[workflowId] = aliasResolver(workflowId, primaryResolvers[sourceId]);
  }

  return resolvers;
}

export function listWorkflowDefinitionIds(): ChatWorkflowId[] {
  return [...chatWorkflowIdSchema.options];
}
