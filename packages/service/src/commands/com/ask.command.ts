import { z } from 'zod';
import type { ICommand, ExecutionContext } from '@ai-team/core';

export type AskKind = 'input' | 'confirm' | 'select' | 'password' | 'checklist';

export interface AskUserParams {
  kind?: AskKind;
  message: string;
  workflow?: {
    workflowId?: string;
    stepId?: string;
    questionId?: string;
    continuationToken?: string;
  };
  defaultText?: string;
  defaultBoolean?: boolean;
  choices?: Array<{ name: string; value: string; description?: string; recommended?: boolean }>;
  defaultChecklist?: string[];
  allowOther?: boolean;
  otherLabel?: string;
  otherPrompt?: string;
  minSelections?: number;
  maxSelections?: number;
  mask?: string;
}

function askResult(kind: AskKind, answer: unknown, workflow?: AskUserParams['workflow']) {
  return {
    type: 'com_ask_result',
    kind,
    answer,
    workflow,
    timestamp: new Date().toISOString(),
  };
}

function requireInputBridge(
  context: ExecutionContext
): NonNullable<ExecutionContext['questionInput']> {
  if (!context.questionInput) {
    throw new Error('Question bridge unavailable: questionInput responder is not registered.');
  }
  return context.questionInput;
}

function normalizeYesNo(raw: string, fallback: boolean): boolean {
  const value = raw.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'y' || value === 'yes' || value === 'true' || value === '1') return true;
  if (value === 'n' || value === 'no' || value === 'false' || value === '0') return false;
  return fallback;
}

async function askSelectWithInputFallback(
  context: ExecutionContext,
  params: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string }>;
    defaultText?: string;
  }
): Promise<string> {
  const askInput = requireInputBridge(context);
  const options = params.choices.map((c) => `${c.value} (${c.name})`).join(', ');
  const prompt = `${params.message}\nOptions: ${options}${params.defaultText ? `\nDefault: ${params.defaultText}` : ''}\nType one option value:`;
  const raw = await askInput({ message: prompt });
  const picked = raw.trim();
  if (!picked && params.defaultText) return params.defaultText;
  if (!params.choices.some((c) => c.value === picked)) {
    throw new Error(
      `Invalid selection "${picked}". Expected one of: ${params.choices.map((c) => c.value).join(', ')}`
    );
  }
  return picked;
}

async function askChecklistWithInputFallback(
  context: ExecutionContext,
  params: {
    message: string;
    choices: Array<{ name: string; value: string; description?: string }>;
    defaultChecklist?: string[];
  }
): Promise<string[]> {
  const askInput = requireInputBridge(context);
  const options = params.choices.map((c) => `${c.value} (${c.name})`).join(', ');
  const defaults = params.defaultChecklist?.join(', ');
  const prompt = `${params.message}\nOptions: ${options}${defaults ? `\nDefaults: ${defaults}` : ''}\nType comma-separated option values:`;
  const raw = await askInput({ message: prompt });
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  const selected =
    values.length === 0 && params.defaultChecklist ? params.defaultChecklist : values;
  const invalid = selected.filter((value) => !params.choices.some((c) => c.value === value));
  if (invalid.length > 0) {
    throw new Error(`Invalid checklist selection(s): ${invalid.join(', ')}.`);
  }
  return selected;
}

function ensureChoices(kind: 'select' | 'checklist', choices: AskUserParams['choices']) {
  if (!choices || choices.length === 0) {
    throw new Error(`com_ask ${kind} requires at least one choice.`);
  }
  return choices;
}

async function executeAskUser(params: AskUserParams, context: ExecutionContext): Promise<unknown> {
  const {
    kind = 'input',
    message,
    workflow,
    defaultText,
    defaultBoolean,
    choices,
    defaultChecklist,
    allowOther,
    otherLabel,
    otherPrompt,
    minSelections,
    maxSelections,
    mask,
  } = params;

  switch (kind) {
    case 'confirm': {
      if (context.questionConfirm) {
        return askResult(
          kind,
          await context.questionConfirm({ message, default: defaultBoolean }),
          workflow
        );
      }
      const askInput = requireInputBridge(context);
      const suffix = defaultBoolean ? '[Y/n]' : '[y/N]';
      const raw = await askInput({ message: `${message} ${suffix}` });
      return askResult(kind, normalizeYesNo(raw, defaultBoolean ?? false), workflow);
    }
    case 'select': {
      const options = ensureChoices(kind, choices);
      if (context.questionSelect) {
        return askResult(
          kind,
          await context.questionSelect({
            message,
            choices: options,
            default: defaultText,
            allowOther,
            otherLabel,
            otherPrompt,
          }),
          workflow
        );
      }
      return askResult(
        kind,
        await askSelectWithInputFallback(context, { message, choices: options, defaultText }),
        workflow
      );
    }
    case 'password': {
      if (context.questionPassword) {
        return askResult(kind, await context.questionPassword({ message, mask }), workflow);
      }
      const askInput = requireInputBridge(context);
      return askResult(kind, await askInput({ message }), workflow);
    }
    case 'checklist': {
      const options = ensureChoices(kind, choices);
      if (context.questionChecklist) {
        return askResult(
          kind,
          await context.questionChecklist({
            message,
            choices: options,
            default: defaultChecklist,
            minSelections,
            maxSelections,
            allowOther,
            otherLabel,
            otherPrompt,
          }),
          workflow
        );
      }
      return askResult(
        kind,
        await askChecklistWithInputFallback(context, {
          message,
          choices: options,
          defaultChecklist,
        }),
        workflow
      );
    }
    case 'input':
    default: {
      if (!context.questionInput) {
        throw new Error('Question bridge unavailable: questionInput responder is not registered.');
      }
      const prompt = defaultText ? `${message} (default: ${defaultText})` : message;
      return askResult('input', await context.questionInput({ message: prompt }), workflow);
    }
  }
}

type Params = z.infer<typeof AskUserCommand.schema>;

export class AskUserCommand{
  static readonly schema = z.object({
    kind: z
      .enum(['input', 'confirm', 'select', 'password', 'checklist'])
      .default('input')
      .describe(
        'Question kind: input (free text), confirm (yes/no), select (single choice), password (sensitive text), checklist (multi-select). Prefer checklist when more than one option can be valid.'
      ),
    message: z
      .string()
      .min(1)
      .describe(
        'User-visible prompt text. For checklist prompts, phrase as "select all that apply".'
      ),
    workflow: z
      .object({
        workflowId: z.string().optional().describe('Workflow ID for stateful flows.'),
        stepId: z.string().optional().describe('Workflow step ID.'),
        questionId: z.string().optional().describe('Stable workflow question identifier.'),
        continuationToken: z.string().optional().describe('Workflow continuation token.'),
      })
      .optional()
      .describe('Optional workflow metadata passthrough for workflow controllers.'),
    defaultText: z
      .string()
      .optional()
      .describe('Default text value for input/select when the user submits empty input.'),
    defaultBoolean: z.boolean().optional().describe('Default yes/no value for confirm prompts.'),
    choices: z
      .array(
        z.object({
          name: z.string().min(1).describe('Human-readable option label.'),
          value: z.string().min(1).describe('Machine-stable value returned to the model.'),
          description: z.string().optional().describe('Optional helper text for this choice.'),
          recommended: z
            .boolean()
            .optional()
            .describe('Marks this option as recommended in capable UIs.'),
        })
      )
      .optional()
      .describe('Required for select/checklist prompts. Include every valid option.'),
    defaultChecklist: z
      .array(z.string())
      .optional()
      .describe('Default selected values for checklist prompts (kind=checklist only).'),
    allowOther: z
      .boolean()
      .optional()
      .describe('Allow custom value outside listed choices in supported UIs.'),
    otherLabel: z.string().optional().describe('Label for custom "other" option in supported UIs.'),
    otherPrompt: z
      .string()
      .optional()
      .describe('Prompt used when custom "other" option is selected.'),
    minSelections: z.number().int().min(0).optional().describe('Minimum selections for checklist.'),
    maxSelections: z.number().int().min(1).optional().describe('Maximum selections for checklist.'),
    mask: z.string().optional().describe('Mask character for password prompts'),
  });

  readonly key = 'ask';
  readonly description =
    'Ask the user for missing clarification as an LLM tool call. Use this instead of guessing when required information is unknown. Choose kind=input|confirm|select|password|checklist. Use select only when exactly one option may be chosen. Use checklist when multiple options may be valid (select all that apply). For select/checklist, provide machine-stable option values and clear labels.';
  readonly availableIn = { tool: true };
  readonly group = 'com';
  readonly parameters = AskUserCommand.schema;
  readonly permissionCheck = { type: 'none' as const };
  readonly tags = ['orchestration'];

  async execute(params: Params, context: ExecutionContext): Promise<unknown> {
    return executeAskUser(params, context);
  }
}
