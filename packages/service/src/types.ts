import { CORE_SERVICE_TOKENS, type ICommandRegistry, type Token } from '@ai-team/core';

export { CORE_SERVICE_TOKENS } from '@ai-team/core';

/**
 * Back-compat token facade for legacy service imports/tests.
 * Prefer importing CORE_SERVICE_TOKENS directly from @ai-team/core in new code.
 */
export const COMMAND_FACTORY_TOKENS = {
  ...CORE_SERVICE_TOKENS,
  CommandRegistry: CORE_SERVICE_TOKENS.CommandRegistry as Token<ICommandRegistry>,
} as const;
