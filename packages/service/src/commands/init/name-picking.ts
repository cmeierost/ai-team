import ora from 'ora';
import type { LlmService } from '@ai-team/core';
import type { InitRuntimeHooks } from './workflow-questions.js';
import { renderTemplate, type InitTemplates } from './template-utils.js';

const DEFAULT_NAME_SUGGESTIONS = [
  'John Smith',
  'Emily Davis',
  'Michael Brown',
  'Sarah Johnson',
  'David Wilson',
  'Jessica Miller',
  'Daniel Anderson',
  'Olivia Martinez',
  'James Taylor',
  'Sophia Thompson',
  'William Jackson',
  'Ava White',
  'Benjamin Harris',
  'Mia Clark',
  'Lucas Lewis',
];

export interface NamePickingIo {
  requestSelect: (hooks: InitRuntimeHooks | undefined, request: { message: string; choices: Array<{ name: string; value: string }> }) => Promise<string>;
  requestInput: (hooks: InitRuntimeHooks | undefined, request: { message: string; validate?: (value: string) => true | string }) => Promise<string>;
  writeWarn: (hooks: InitRuntimeHooks | undefined, message: string) => void;
}

export async function pickAgentName(
  llm: LlmService,
  templates: InitTemplates,
  roleLabel: string,
  selectedNames: string[] = [],
  hooks: InitRuntimeHooks | undefined,
  io: NamePickingIo,
): Promise<string> {
  const spinner = ora(`Generating name suggestions for ${roleLabel}...`).start();
  let suggestions: string[] = [];

  try {
    const selectedContext = selectedNames.length > 0
      ? `Already selected names: ${selectedNames.join(', ')}. `
      : '';

    const firstRaw = await llm.rawChat(
      templates.nameSystemPrompt.trim(),
      [{ role: 'user', content: renderTemplate(templates.nameRequestPrompt, { selectedContext, roleLabel }).trim() }],
      { temperature: 1.2, maxTokens: 120 },
    );

    suggestions = parseNameSuggestions(firstRaw, selectedNames).slice(0, 5);
    if (suggestions.length === 0) {
      const strictRaw = await llm.rawChat(
        templates.nameSystemPrompt.trim(),
        [{
          role: 'user',
          content: renderTemplate(templates.nameRequestStrictPrompt, { selectedContext, roleLabel }).trim(),
        }],
        { maxTokens: 120 },
      );

      suggestions = parseNameSuggestions(strictRaw, selectedNames).slice(0, 5);
      if (suggestions.length === 0) {
        throw new Error('Name generation returned no usable suggestions after strict retry.');
      }
    }

    spinner.stop();
  } catch (error) {
    spinner.stop();
    const reason = error instanceof Error ? error.message : String(error);
    io.writeWarn(hooks, `  Could not generate names from LLM (${reason}). Using fallback suggestions.`);
    suggestions = buildFallbackNameSuggestions(selectedNames, 5);
  }

  const customValue = '__custom__';
  const choices = [
    ...suggestions.map((n) => ({ name: n, value: n })),
    { name: 'Enter a custom name...', value: customValue },
  ];

  const chosen = await io.requestSelect(hooks, {
    message: `Name your ${roleLabel}:`,
    choices,
  });

  if (chosen === customValue) {
    return io.requestInput(hooks, {
      message: 'Enter a name:',
      validate: (v: string) => v.trim().length > 0 || 'Name cannot be empty',
    });
  }

  return chosen;
}

function parseNameSuggestions(raw: string, selectedNames: string[]): string[] {
  const selectedTokens = buildUsedNameTokenSet(selectedNames);
  const parsed = parseJsonArrayFromRawText(raw);

  return parsed
    .map(value => typeof value === 'string' ? value.trim() : '')
    .filter((value): value is string => value.length > 0)
    .map(value => value.replace(/^[-*\d.)\s]+/, '').replace(/[`"']/g, '').trim())
    .filter(value => /^[A-Za-z]+(?:[\s-][A-Za-z]+)+$/.test(value))
    .filter(value => !hasTokenCollision(value, selectedTokens))
    .filter((value, index, all) => all.findIndex(entry => entry.toLowerCase() === value.toLowerCase()) === index);
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
  const fallback = DEFAULT_NAME_SUGGESTIONS
    .filter(name => !hasTokenCollision(name, selectedTokens))
    .slice(0, count);

  if (fallback.length >= count) {
    return fallback;
  }

  for (const name of DEFAULT_NAME_SUGGESTIONS) {
    if (fallback.length >= count) {
      break;
    }
    if (!fallback.includes(name)) {
      fallback.push(name);
    }
  }

  return fallback;
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
    .map(part => part.trim().toLowerCase())
    .some(part => part.length > 0 && usedTokens.has(part));
}
