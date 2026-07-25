import { Token } from '@ai-team/core';
import type { CommandActorAdapterResolver } from './command-actor-adapter-resolver.js';

/** Tokens for XState-bearing service internals; these intentionally stay out of core. */
export const WORKFLOW_SERVICE_TOKENS = {
  CommandActorAdapterResolver: new Token<CommandActorAdapterResolver>('CommandActorAdapterResolver'),
} as const;
