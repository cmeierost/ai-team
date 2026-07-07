import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
  ILlmService,
} from '@ai-team/core';

const nameSuggestionsParamsSchema = z.object({
  roleLabel: z
    .string()
    .min(1)
    .describe('Role label used in the prompt (e.g. "CEO", "Head of Human Resources").'),
  excludeNames: z
    .array(z.string())
    .default([])
    .describe('Names that must not appear in the suggestions (already-taken names).'),
  count: z.number().int().min(1).max(10).default(5).describe('Number of suggestions to return.'),
});

export type NameSuggestionsParams = z.infer<typeof nameSuggestionsParamsSchema>;

export interface NameSuggestionsResult {
  /** Suggested full names, one per line as returned by the LLM. */
  suggestions: string[];
}

export const NameSuggestionsCommandMetadata = {
  key: 'name_suggestions',
  group: 'hr',
  description:
    'Generate a list of candidate full names for a given role, suitable to feed into `com_ask` as choices. Excludes any names already taken.',
  availableIn: { tool: true },
  parameters: nameSuggestionsParamsSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration', 'hr'],
} satisfies ICommandDescriptor;

const SYSTEM_PROMPT = `You generate candidate full names for fictional team members.

Rules:
- Return ONLY the names, one per line. No numbering, no extra text.
- Each name must be a plausible full name (first + last).
- Aim for diversity across gender and background.
- Do not repeat any name from the exclusion list.`;

/**
 * `hr_name_suggestions` — generate N candidate full names for a role.
 *
 * Returns a string array. The workflow typically feeds this into `com_ask`
 * with `kind: select` so the user picks one. The selected name then flows
 * into `hr_hire`.
 */
export class NameSuggestionsCommand implements ICommand<
  NameSuggestionsParams,
  NameSuggestionsResult
> {
  readonly metadata = NameSuggestionsCommandMetadata;

  constructor(private readonly llmService: ILlmService) {}

  async execute(
    params: NameSuggestionsParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<NameSuggestionsResult>> {
    await this.llmService.ensureInitialized();
    const excluded =
      params.excludeNames.length > 0
        ? `\n\nExcluded names (do not use): ${params.excludeNames.join(', ')}`
        : '';
    const userPrompt = `Generate ${params.count} candidate full names for the role: ${params.roleLabel}.${excluded}`;

    const raw = await this.llmService.rawChat(
      SYSTEM_PROMPT,
      [{ role: 'user', content: userPrompt }],
      { temperature: 1.2, maxTokens: 200 }
    );

    const suggestions = raw
      .split('\n')
      .map((line) => line.replace(/^[\s\d.\-*•)]+/, '').trim())
      .filter((line) => line.length > 0 && line.length < 80)
      .filter((line) => !params.excludeNames.some((ex) => ex.toLowerCase() === line.toLowerCase()))
      .slice(0, params.count);

    return { status: 'ok', data: { suggestions } };
  }
}
