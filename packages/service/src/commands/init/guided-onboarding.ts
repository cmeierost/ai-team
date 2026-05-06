import type { ILlmService } from '@ai-team/core';

export interface GuidedChoice {
  name: string;
  value: string;
}

export interface GuidedInitialSuggestions {
  productModes: GuidedChoice[];
  priorities: GuidedChoice[];
}

export interface GuidedDependentSuggestions {
  constraints: GuidedChoice[];
  mustHaveRoles: GuidedChoice[];
}

export interface IdeaClarifierQuestion {
  question: string;
}

interface GuidedSuggestionPayload {
  productModes?: Array<{ name?: string; value?: string }>;
  priorities?: Array<{ name?: string; value?: string }>;
  constraints?: Array<{ name?: string; value?: string }>;
  mustHaveRoles?: Array<{ name?: string; value?: string }>;
}

function sanitizeValue(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
}

function normalizeChoices(
  choices: Array<{ name?: string; value?: string }> | undefined,
  min: number,
  max: number
): GuidedChoice[] | undefined {
  if (!choices || choices.length === 0) {
    return undefined;
  }

  const seen = new Set<string>();
  const normalized: GuidedChoice[] = [];

  for (const choice of choices) {
    const name = (choice.name ?? '').trim();
    const value = sanitizeValue(choice.value ?? name);
    if (!name || !value || seen.has(value)) {
      continue;
    }
    seen.add(value);
    normalized.push({ name, value });
    if (normalized.length >= max) {
      break;
    }
  }

  if (normalized.length < min) {
    return undefined;
  }

  return normalized;
}

function tryParsePayload(raw: string): GuidedSuggestionPayload | undefined {
  try {
    const parsed = JSON.parse(raw.trim()) as GuidedSuggestionPayload;
    return parsed && typeof parsed === 'object' ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function sanitizeQuestion(value: string): string | undefined {
  const collapsed = value.replaceAll(/\s+/g, ' ').trim();
  if (!collapsed) return undefined;
  const normalized = collapsed.endsWith('?') ? collapsed : `${collapsed}?`;
  if (normalized.length < 24 || normalized.length > 260) return undefined;
  return normalized;
}

function getRawChat(
  llm: ILlmService
): (
  systemPrompt: string,
  messages: Array<{ role: 'user'; content: string }>,
  options?: { maxTokens?: number; temperature?: number }
) => Promise<string> {
  return llm.rawChat.bind(llm);
}

export async function getIdeaClarifierQuestion(
  llm: ILlmService,
  ideaText: string
): Promise<IdeaClarifierQuestion> {
  const rawChat = getRawChat(llm);
  const response = await rawChat(
    'You craft one high-quality product discovery question. Return plain text only.',
    [
      {
        role: 'user',
        content: [
          'Based on the idea below, write exactly ONE concise follow-up onboarding question.',
          'The question must be tailored to the idea domain (game/app/tool/platform/etc.).',
          'Do not mention "AI team" unless the idea explicitly mentions it.',
          'Ask for product target + first pain point in a natural way.',
          'Return only the question text, nothing else.',
          '',
          'Idea:',
          ideaText,
        ].join('\n'),
      },
    ],
    { temperature: 0.4, maxTokens: 120 }
  );

  const question = sanitizeQuestion(response);
  if (question) {
    return { question };
  }

  return {
    question: 'What kind of product is this idea, and what single user pain should it solve first?',
  };
}

async function requestStrictJsonPayload(
  rawChat: ReturnType<typeof getRawChat>,
  promptLines: string[]
): Promise<GuidedSuggestionPayload> {
  const firstResponse = await rawChat(
    'You are a product strategy expert. Return JSON only with no markdown or commentary.',
    [{ role: 'user', content: promptLines.join('\n') }],
    { temperature: 0.85, maxTokens: 900 }
  );

  const firstPayload = tryParsePayload(firstResponse);
  if (firstPayload) {
    return firstPayload;
  }

  const strictResponse = await rawChat(
    'Return JSON only. No prose, no markdown, no code fences.',
    [
      {
        role: 'user',
        content: [
          ...promptLines,
          '',
          'IMPORTANT: Return a valid JSON object only. Do not include any text outside JSON.',
        ].join('\n'),
      },
    ],
    { temperature: 0.2, maxTokens: 900 }
  );

  const strictPayload = tryParsePayload(strictResponse);
  if (!strictPayload) {
    throw new Error('LLM did not return valid JSON for guided onboarding suggestions.');
  }

  return strictPayload;
}

export async function getGuidedInitialSuggestions(
  llm: ILlmService,
  ideaText: string
): Promise<GuidedInitialSuggestions> {
  const rawChat = getRawChat(llm);
  const payload = await requestStrictJsonPayload(rawChat, [
    'You are advising a startup founder during initial product strategy shaping.',
    'Based on the developer idea below, generate inspiring onboarding choices.',
    'Return strict JSON object with keys: productModes, priorities.',
    'Each key must be an array of objects: { "name": string, "value": kebab-case-string }.',
    'productModes: 4-6 options that represent strategic product directions with clear business posture.',
    'priorities: 5-8 options that are concrete, motivating, and decision-shaping.',
    'Avoid generic labels like "misc", "other", or vague buzzwords.',
    'Use language a founder would find energizing and actionable.',
    'Keep each option short (2-6 words), distinct, and non-overlapping.',
    'Do not include explanatory text. JSON only.',
    '',
    'Developer idea:',
    ideaText,
  ]);

  const productModes = normalizeChoices(payload.productModes, 4, 6);
  const priorities = normalizeChoices(payload.priorities, 5, 8);
  if (!productModes || !priorities) {
    throw new Error('LLM suggestions were incomplete for initial guided onboarding choices.');
  }

  return {
    productModes,
    priorities,
  };
}

export async function getGuidedDependentSuggestions(
  llm: ILlmService,
  input: {
    ideaText: string;
    selectedProductMode: string;
    selectedPriorities: string[];
    selectedConstraints?: string[];
  }
): Promise<GuidedDependentSuggestions> {
  const rawChat = getRawChat(llm);
  const payload = await requestStrictJsonPayload(rawChat, [
    'You are advising a startup founder on execution trade-offs and first-wave team design.',
    'Generate dependent onboarding choices based on selected context.',
    'Return strict JSON object with keys: constraints, mustHaveRoles.',
    'Each key must be an array of objects: { "name": string, "value": kebab-case-string }.',
    'constraints: 4-8 options. mustHaveRoles: 4-8 options.',
    'Roles should be practical for first hiring wave and aligned to selected mode, priorities, and constraints.',
    'Strongly reflect dependency context: changing selected mode/priorities should materially change output.',
    'Prefer concrete role titles over generic labels.',
    'Keep each option short (2-6 words), distinct, and non-overlapping.',
    'Do not include explanatory text. JSON only.',
    '',
    `Selected product mode: ${input.selectedProductMode}`,
    `Selected priorities: ${input.selectedPriorities.join(', ') || 'none'}`,
    `Selected constraints: ${(input.selectedConstraints ?? []).join(', ') || 'none'}`,
    'Developer idea:',
    input.ideaText,
  ]);

  const constraints = normalizeChoices(payload.constraints, 4, 8);
  const mustHaveRoles = normalizeChoices(payload.mustHaveRoles, 4, 8);
  if (!constraints || !mustHaveRoles) {
    throw new Error('LLM suggestions were incomplete for dependent guided onboarding choices.');
  }

  return {
    constraints,
    mustHaveRoles,
  };
}
