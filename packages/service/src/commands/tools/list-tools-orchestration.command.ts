import { z } from 'zod';
import type {
  CommandRuntime,
  ICommand,
  ToolCatalogResult,
  ToolContext,
} from '@ai-team/core';

import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import type { ScoredPreLlmIntentCandidate } from '../../tools/pre-llm-intents.js';
import type { IToolCatalog } from '../orchestration/orchestration.types.js';

export const TOOL_LIST_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(what|which|list|show)\b.*\b(tool|tools)\b/i,
  /\bwhat can you use\b/i,
  /\bavailable tools\b/i,
];

export function matchesToolListPreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return TOOL_LIST_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

type Params = z.infer<typeof ListToolsOrchestrationCommand.schema>;

export class ListToolsOrchestrationCommand
  implements ICommand<Params, ToolContext, ToolCatalogResult>
{
  static readonly schema = z.object({
    tag: z.string().optional().describe('Filter by tag (e.g. "file", "orchestration", "hr")'),
  });

  readonly key = 'list';
  readonly description =
    'Show all tools currently available to you, including name, description, and parameters.';
  readonly availableIn = { tool: true };
  readonly group = 'tool';
  readonly parameters = ListToolsOrchestrationCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['orchestration'];

  constructor(private readonly tools: IToolCatalog) {}

  readonly scorePreLlmIntent = (
    message: string,
    _ctx: OrchestratorContext
  ): ScoredPreLlmIntentCandidate | undefined => {
    const text = message.trim();
    if (!text) return undefined;

    if (matchesToolListPreLlmIntent(text)) {
      return {
        kind: 'tool',
        toolName: 'tool_list',
        args: {},
        score: 100,
        reason: 'Explicit tool capability request.',
      };
    }

    if (/\b(tool|tools|capabilit(?:y|ies))\b/i.test(text)) {
      return {
        kind: 'tool',
        toolName: 'tool_list',
        args: {},
        score: 72,
        reason: 'Likely request for available tools.',
      };
    }

    return undefined;
  };

  async execute(params: Params, context: ToolContext, _runtime: CommandRuntime): Promise<ToolCatalogResult> {
    const { tag } = params;

    let entries = this.tools.catalog(context.agent);
    if (tag) {
      entries = entries.filter((e) => e.tags?.includes(tag));
    }

    return {
      type: 'tool_list_result',
      entries,
      timestamp: new Date().toISOString(),
    };
  }
}
