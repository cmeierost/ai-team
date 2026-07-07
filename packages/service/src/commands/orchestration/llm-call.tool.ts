import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
  ILlmService,
} from '@ai-team/core';

const llmCallParamsSchema = z.object({
  systemPrompt: z
    .string()
    .min(1)
    .describe('System prompt that defines the LLM behavior for this call.'),
  userPrompt: z
    .string()
    .optional()
    .describe('Optional user-facing prompt. When omitted, the system prompt drives generation.'),
  model: z.string().optional().describe('Override the default model for this call.'),
  maxTokens: z.number().int().positive().optional().describe('Max tokens in the response.'),
  temperature: z.number().min(0).max(2).optional().describe('Sampling temperature (0–2).'),
});

export type LlmCallParams = z.infer<typeof llmCallParamsSchema>;

export interface LlmCallResult {
  content: string;
}

export const LlmCallCommandMetadata = {
  key: 'call',
  group: 'llm',
  description:
    'Low-level LLM call without an agent persona. Use inside workflows to generate text from a system prompt (e.g. name suggestions, summaries).',
  availableIn: { tool: true },
  parameters: llmCallParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'llm'],
} satisfies ICommandDescriptor;

/**
 * Generic LLM call tool. Returns raw text content from a `rawChat()` call.
 *
 * Use inside workflows when you need to:
 * - Generate suggestions (e.g. names, options) for downstream user selection
 * - Summarize accumulated state into a single string
 * - Drive simple non-interactive LLM-backed steps
 */
export class LlmCallCommand implements ICommand<LlmCallParams, LlmCallResult> {
  readonly metadata = LlmCallCommandMetadata;

  constructor(private readonly llmService: ILlmService) {}

  async execute(
    params: LlmCallParams,
    _context: ExecutionContext
  ): Promise<CommandResponse<LlmCallResult>> {
    await this.llmService.ensureInitialized();

    const messages = params.userPrompt
      ? [{ role: 'user' as const, content: params.userPrompt }]
      : [];

    const content = await this.llmService.rawChat(params.systemPrompt, messages, {
      model: params.model,
      maxTokens: params.maxTokens,
      temperature: params.temperature,
    });

    return { status: 'ok', data: { content: content.trim() } };
  }
}
