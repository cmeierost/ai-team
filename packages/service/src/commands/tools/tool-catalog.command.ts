import { z } from 'zod';
import type {
  ICommand,
  ToolCatalogResult,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';

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
const _listToolsOrchestrationCommandSchema = z.object({
  tag: z.string().optional().describe('Filter by tag (e.g. "file", "orchestration", "hr")'),
});

export const ListToolsOrchestrationCommandMetadata = {
  key: 'catalog',
  description:
    'Show all tools currently available to you, including name, description, and parameters.',
  availableIn: { tool: true },
  group: 'tool',
  parameters: _listToolsOrchestrationCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class ListToolsOrchestrationCommand implements ICommand<Params, ToolCatalogResult> {
  static readonly schema = _listToolsOrchestrationCommandSchema;
  readonly metadata = ListToolsOrchestrationCommandMetadata;

  constructor(private readonly tools: IToolCatalog) {}

  readonly scorePreLlmIntent = (
    message: string,
    _ctx: ExecutionContext
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

  async execute(
    params: Params,
    ctx: ExecutionContext
  ): Promise<CommandResponse<ToolCatalogResult>> {
    const { tag } = params;

    let entries = this.tools.catalog(ctx.agent!);
    if (tag) {
      entries = entries.filter((e) => e.tags?.includes(tag));
    }

    return {
      status: 'ok',
      data: {
        type: 'tool_list_result',
        entries,
        timestamp: new Date().toISOString(),
      },
    };
  }
}
