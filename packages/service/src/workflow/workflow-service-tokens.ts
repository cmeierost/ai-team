import { Token } from '@ai-team/core';
import type { CommandActorAdapterResolver } from './command-actor-adapter-resolver.js';
import type { WorkflowActorHost } from './workflow-actor-host.js';
import type { WorkflowInteractionRouter } from './workflow-interaction-router.js';

/** Tokens for XState-bearing service internals; these intentionally stay out of core. */
export const WORKFLOW_SERVICE_TOKENS = {
  CommandActorAdapterResolver: new Token<CommandActorAdapterResolver>('CommandActorAdapterResolver'),
  WorkflowActorHost: new Token<WorkflowActorHost>('WorkflowActorHost'),
  WorkflowInteractionRouter: new Token<WorkflowInteractionRouter>('WorkflowInteractionRouter'),
} as const;
