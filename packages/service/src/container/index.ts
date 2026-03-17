export { Token } from './token.js';
export { ServiceContainer } from './container.js';
export { TOKENS } from './tokens.js';
export { createContainer } from './bootstrap.js';
export type { BootstrapConfig } from './bootstrap.js';

import type { ResolvedPlugins } from '../orchestrator/pipeline.js';
import type { ServiceContainer as SC } from './container.js';
import { TOKENS } from './tokens.js';

/** Resolve all pipeline plugin tokens into a ResolvedPlugins object. */
export function resolvePlugins(c: SC): ResolvedPlugins {
  return {
    compressor:        c.resolve(TOKENS.ContextCompressor),
    contextBuilder:    c.resolve(TOKENS.ContextBuilder),
    enrichers:         c.resolve(TOKENS.ContextEnrichers),
    ragProvider:       c.resolve(TOKENS.RagProvider),
    toolResolver:      c.resolve(TOKENS.ToolResolver),
    mcpGateway:        c.resolve(TOKENS.McpGateway),
    llmSelector:       c.resolve(TOKENS.LlmSelector),
    outputHandler:     c.resolve(TOKENS.OutputHandler),
    slashCommands:     c.resolve(TOKENS.SlashCommands),
    turnResultParsers: c.resolve(TOKENS.TurnResultParsers),
    hookPlugins:       c.resolve(TOKENS.HookPlugins),
  };
}
