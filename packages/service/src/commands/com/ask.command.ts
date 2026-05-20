import { z } from 'zod';
import type { ICommand, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';

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

type AskUserResult = ReturnType<typeof askResult>;

function ensureChoices(kind: 'select' | 'checklist', choices: AskUserParams['choices']) {
  if (!choices || choices.length === 0) {
    throw new Error(`com_ask ${kind} requires at least one choice.`);
  }
  return choices;
}

async function executeConfirmAsk(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<AskUserResult> {
  const { message, defaultBoolean, workflow } = params;
  const suffix = defaultBoolean ? '[Y/n]' : '[y/N]';
  const answer = await questionService.confirm(
    { message: `${message} ${suffix}`, default: defaultBoolean },
    context
  );
  return askResult('confirm', answer, workflow);
}

async function executeSelectAsk(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<AskUserResult> {
  const { message, defaultText, choices, workflow, allowOther, otherLabel, otherPrompt } = params;
  const options = ensureChoices('select', choices);
  const answer = await questionService.select(
    {
      message,
      choices: options,
      default: defaultText,
      allowOther,
      otherLabel,
      otherPrompt,
    },
    context
  );
  return askResult('select', answer, workflow);
}

async function executePasswordAsk(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<AskUserResult> {
  const { message, mask, workflow } = params;
  const answer = await questionService.password({ message, mask }, context);
  return askResult('password', answer, workflow);
}

async function executeChecklistAsk(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<AskUserResult> {
  const {
    message,
    defaultChecklist,
    choices,
    workflow,
    minSelections,
    maxSelections,
    allowOther,
    otherLabel,
    otherPrompt,
  } = params;
  const options = ensureChoices('checklist', choices);
  const answer = await questionService.checklist(
    {
      message,
      choices: options,
      default: defaultChecklist,
      minSelections,
      maxSelections,
      allowOther,
      otherLabel,
      otherPrompt,
    },
    context
  );
  return askResult('checklist', answer, workflow);
}

async function executeInputAsk(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<AskUserResult> {
  const { message, defaultText, workflow } = params;
  const prompt = defaultText ? `${message} (default: ${defaultText})` : message;
  return askResult('input', await questionService.input({ message: prompt }, context), workflow);
}

async function executeAskUser(
  questionService: IQuestionService,
  params: AskUserParams,
  context: ExecutionContext
): Promise<unknown> {
  const { kind = 'input' } = params;

  switch (kind) {
    case 'confirm':
      return executeConfirmAsk(questionService, params, context);
    case 'select':
      return executeSelectAsk(questionService, params, context);
    case 'password':
      return executePasswordAsk(questionService, params, context);
    case 'checklist':
      return executeChecklistAsk(questionService, params, context);
    case 'input':
    default:
      return executeInputAsk(questionService, params, context);
  }
}

type Params = z.infer<typeof AskUserCommand.schema>;

export class AskUserCommand implements ICommand<Params, AskUserResult> {
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

  constructor(private readonly questionService: IQuestionService) {}

  async execute(
    params: Params,
    context: ExecutionContext
  ): Promise<CommandResponse<AskUserResult>> {
    const result = (await executeAskUser(this.questionService, params, context)) as AskUserResult;
    return { status: 'ok', data: result };
  }
}
