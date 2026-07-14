import ora from 'ora';
import type { ILlmService, IEmitService } from '@ai-team/core';
import type { InitWorkflowQuestioner } from './workflow-questions.js';
import { renderTemplate, type InitTemplates } from './template-utils.js';

type BinaryGender = 'male' | 'female';

interface SuggestedPerson {
  name: string;
  gender: BinaryGender;
}

const DEFAULT_NAME_SUGGESTIONS: SuggestedPerson[] = [
  { name: 'John Smith', gender: 'male' },
  { name: 'Emily Davis', gender: 'female' },
  { name: 'Michael Brown', gender: 'male' },
  { name: 'Sarah Johnson', gender: 'female' },
  { name: 'David Wilson', gender: 'male' },
  { name: 'Jessica Miller', gender: 'female' },
  { name: 'Daniel Anderson', gender: 'male' },
  { name: 'Olivia Martinez', gender: 'female' },
  { name: 'James Taylor', gender: 'male' },
  { name: 'Sophia Thompson', gender: 'female' },
  { name: 'William Jackson', gender: 'male' },
  { name: 'Ava White', gender: 'female' },
  { name: 'Benjamin Harris', gender: 'male' },
  { name: 'Mia Clark', gender: 'female' },
  { name: 'Lucas Lewis', gender: 'male' },
];

const DEFAULT_GENDER_BY_FIRST_NAME = new Map(
  DEFAULT_NAME_SUGGESTIONS.map((entry) => [
    entry.name.split(/\s+/, 1)[0]!.toLowerCase(),
    entry.gender,
  ])
);

export interface PickAgentNameOptions {
  selectionMessage?: string;
  suggestionAnnouncement?: (suggestions: string[]) => string;
}

/**
 * Service for picking agent names with LLM-generated suggestions.
 * Uses constructor injection for all dependencies.
 */
export class NamePickingService {
  constructor(
    private readonly llmService: ILlmService,
    private readonly questioner: InitWorkflowQuestioner,
    private readonly emitService: IEmitService,
    private readonly templates: InitTemplates
  ) {}

  async pickAgentName(
    roleLabel: string,
    selectedNames: string[] = [],
    options?: PickAgentNameOptions
  ): Promise<string> {
    const spinner = ora(`Generating name suggestions for ${roleLabel}...`).start();
    let suggestions: string[] = [];
    let lastError: unknown;

    try {
      const selectedContext =
        selectedNames.length > 0 ? `Already selected names: ${selectedNames.join(', ')}. ` : '';

      try {
        const firstRaw = await this.llmService.rawChat(
          this.templates.nameSystemPrompt.trim(),
          [
            {
              role: 'user',
              content: renderTemplate(this.templates.nameRequestPrompt, {
                selectedContext,
                roleLabel,
              }).trim(),
            },
          ],
          { temperature: 1.2, maxTokens: 120 }
        );

        suggestions = normalizeSuggestedNames(
          parseNameSuggestions(firstRaw, selectedNames),
          selectedNames,
          5
        );
      } catch (error) {
        lastError = error;
        suggestions = [];
      }

      if (suggestions.length === 0) {
        try {
          const strictRaw = await this.llmService.rawChat(
            this.templates.nameSystemPrompt.trim(),
            [
              {
                role: 'user',
                content: renderTemplate(this.templates.nameRequestStrictPrompt, {
                  selectedContext,
                  roleLabel,
                }).trim(),
              },
            ],
            { maxTokens: 120 }
          );

          suggestions = normalizeSuggestedNames(
            parseNameSuggestions(strictRaw, selectedNames),
            selectedNames,
            5
          );
        } catch (error) {
          lastError = error;
          suggestions = [];
        }

        if (suggestions.length === 0 && lastError) {
          throw lastError;
        }

        if (suggestions.length === 0) {
          throw new Error('Name generation returned no usable suggestions after strict retry.');
        }
      }

      spinner.stop();
    } catch (error) {
      spinner.stop();
      // Fallback to default suggestions on LLM failure
      suggestions = buildFallbackNameSuggestions(selectedNames, 5);
    }

    const customValue = '__custom__';
    const choices = [
      ...suggestions.map((n) => ({ name: n, value: n })),
      { name: 'Enter a custom name...', value: customValue },
    ];

    const chosen = await this.questioner.requestSelect({
      message: options?.selectionMessage ?? `Name your ${roleLabel}:`,
      choices,
    });

    if (chosen === customValue) {
      return this.questioner.requestInput({
        message: 'Enter a name:',
        validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
      });
    }

    return chosen;
  }
}

function parseNameSuggestions(raw: string, selectedNames: string[]): string[] {
  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const parsed = parseJsonArrayFromRawText(raw);

  return parsed
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter((value): value is string => value.length > 0)
    .map((value) =>
      value
        .replace(/^[-*\d.)\s]+/, '')
        .replace(/[`"']/g, '')
        .trim()
    )
    .filter((value) => /^[A-Za-z]+(?:[\s-][A-Za-z]+)+$/.test(value))
    .filter((value) => !hasTokenCollision(value, selectedTokens))
    .filter(
      (value, index, all) =>
        all.findIndex((entry) => entry.toLowerCase() === value.toLowerCase()) === index
    );
}

function parseJsonArrayFromRawText(raw: string): unknown[] {
  const direct = tryParseJsonArray(raw);
  if (direct) {
    return direct;
  }

  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  if (fenced) {
    const fencedParsed = tryParseJsonArray(fenced);
    if (fencedParsed) {
      return fencedParsed;
    }
  }

  const firstBracket = raw.indexOf('[');
  const lastBracket = raw.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    const sliced = raw.slice(firstBracket, lastBracket + 1);
    const slicedParsed = tryParseJsonArray(sliced);
    if (slicedParsed) {
      return slicedParsed;
    }
  }

  throw new Error('Name suggestions were not valid JSON array output.');
}

function tryParseJsonArray(input: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(input.trim());
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function buildFallbackNameSuggestions(selectedNames: string[], count: number): string[] {
  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const fallback = DEFAULT_NAME_SUGGESTIONS.map((entry) => entry.name)
    .filter((name) => !hasTokenCollision(name, selectedTokens))
    .slice(0, count);

  if (fallback.length >= count) {
    return fallback;
  }

  for (const name of DEFAULT_NAME_SUGGESTIONS.map((entry) => entry.name)) {
    if (fallback.length >= count) {
      break;
    }
    if (!fallback.includes(name)) {
      fallback.push(name);
    }
  }

  return fallback;
}

function normalizeSuggestedNames(
  rawSuggestions: string[],
  selectedNames: string[],
  count: number
): string[] {
  const unique = rawSuggestions.filter(
    (value, index, all) =>
      all.findIndex((entry) => entry.toLowerCase() === value.toLowerCase()) === index
  );

  const classified = unique.map((name) => ({ name, gender: inferGender(name) }));
  const males = classified
    .filter((entry): entry is { name: string; gender: 'male' } => entry.gender === 'male')
    .map((entry) => entry.name);
  const females = classified
    .filter((entry): entry is { name: string; gender: 'female' } => entry.gender === 'female')
    .map((entry) => entry.name);
  const unknowns = classified.filter((entry) => !entry.gender).map((entry) => entry.name);

  const options = [
    { maleTarget: 3, femaleTarget: 2 },
    { maleTarget: 2, femaleTarget: 3 },
  ] as const;

  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const maleFallback = DEFAULT_NAME_SUGGESTIONS.filter(
    (entry) => entry.gender === 'male' && !hasTokenCollision(entry.name, selectedTokens)
  ).map((entry) => entry.name);
  const femaleFallback = DEFAULT_NAME_SUGGESTIONS.filter(
    (entry) => entry.gender === 'female' && !hasTokenCollision(entry.name, selectedTokens)
  ).map((entry) => entry.name);
  const genericFallback = DEFAULT_NAME_SUGGESTIONS.map((entry) => entry.name).filter(
    (name) => !hasTokenCollision(name, selectedTokens)
  );

  let best: (typeof options)[number] = options[0];
  let bestScore = -1;
  for (const option of options) {
    const score =
      Math.min(males.length, option.maleTarget) + Math.min(females.length, option.femaleTarget);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }

  const picked: string[] = [];
  const addUnique = (name: string) => {
    if (!picked.some((entry) => entry.toLowerCase() === name.toLowerCase())) {
      picked.push(name);
    }
  };

  for (const name of males.slice(0, best.maleTarget)) addUnique(name);
  for (const name of maleFallback) {
    if (picked.filter((name) => inferGender(name) === 'male').length >= best.maleTarget) break;
    addUnique(name);
  }

  for (const name of females.slice(0, best.femaleTarget)) addUnique(name);
  for (const name of femaleFallback) {
    if (picked.filter((name) => inferGender(name) === 'female').length >= best.femaleTarget) break;
    addUnique(name);
  }

  // Fill remaining slots with unknowns and any remaining fallback candidates.
  for (const name of unknowns) {
    if (picked.length >= count) break;
    addUnique(name);
  }

  for (const name of maleFallback) {
    if (picked.length >= count) break;
    addUnique(name);
  }

  for (const name of femaleFallback) {
    if (picked.length >= count) break;
    addUnique(name);
  }

  for (const name of genericFallback) {
    if (picked.length >= count) break;
    addUnique(name);
  }

  return picked.slice(0, count);
}

function inferGender(name: string): BinaryGender | undefined {
  const firstName = name.split(/\s+/, 1)[0]?.toLowerCase();
  if (!firstName) return undefined;
  return DEFAULT_GENDER_BY_FIRST_NAME.get(firstName);
}

function buildUsedNameTokenSet(selectedNames: string[]): Set<string> {
  const tokens = new Set<string>();
  for (const name of selectedNames) {
    for (const part of name.split(/\s+/)) {
      const normalized = part.trim().toLowerCase();
      if (normalized) {
        tokens.add(normalized);
      }
    }
  }
  return tokens;
}

function hasTokenCollision(name: string, usedTokens: Set<string>): boolean {
  return name
    .split(/\s+/)
    .map((part) => part.trim().toLowerCase())
    .some((part) => part.length > 0 && usedTokens.has(part));
}
