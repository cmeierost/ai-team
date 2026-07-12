import { z } from 'zod';
import type {
  ICommand,
  ICommandDescriptor,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
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

export interface AskUserResult {
  type: 'com_ask_result';
  kind: AskKind;
  answer: unknown;
  workflow: AskUserParams['workflow'];
  timestamp: string;
}

type Params = z.infer<typeof AskUserCommand.schema>;
const _askUserCommandSchema = z.preprocess(
  (raw): unknown => {
    if (!raw || typeof raw !== 'object') {
      return raw;
    }

    const input = raw as Record<string, unknown>;
    const normalized = { ...input };

    const rawMessage = normalized.message ?? normalized.question ?? normalized.prompt;
    if (typeof rawMessage === 'string' && rawMessage.trim().length > 0) {
      normalized.message = rawMessage;
    }

    const rawChoices = normalized.choices ?? normalized.options;
    if (rawChoices !== undefined) {
      let choicesSource: unknown = rawChoices;
      if (typeof choicesSource === 'string') {
        try {
          choicesSource = JSON.parse(choicesSource);
        } catch {
          // Keep as-is; schema validation will reject malformed values.
        }
      }

      if (Array.isArray(choicesSource)) {
        normalized.choices = choicesSource
          .map((choice) => {
            if (!choice || typeof choice !== 'object') {
              return undefined;
            }

            const item = choice as Record<string, unknown>;
            const nameCandidate = item.name ?? item.label;
            const valueCandidate = item.value ?? item.name ?? item.label;

            if (typeof nameCandidate !== 'string' || typeof valueCandidate !== 'string') {
              return undefined;
            }

            const normalizedChoice: {
              name: string;
              value: string;
              description?: string;
              recommended?: boolean;
            } = {
              name: nameCandidate,
              value: valueCandidate,
            };

            if (typeof item.description === 'string') {
              normalizedChoice.description = item.description;
            }

            if (typeof item.recommended === 'boolean') {
              normalizedChoice.recommended = item.recommended;
            }

            return normalizedChoice;
          })
          .filter(
            (
              choice
            ): choice is {
              name: string;
              value: string;
              description?: string;
              recommended?: boolean;
            } => Boolean(choice)
          );
      }
    }

    return normalized;
  },
  z.object({
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
  })
);

export const AskUserCommandMetadata = {
  key: 'ask',
  description:
    'Ask the user for missing clarification as an LLM tool call. Use this instead of guessing when required information is unknown. Choose kind=input|confirm|select|password|checklist. Use select only when exactly one option may be chosen. Use checklist when multiple options may be valid (select all that apply). For select/checklist, provide machine-stable option values and clear labels.',
  availableIn: { tool: true },
  group: 'com',
  parameters: _askUserCommandSchema,
  permissionCheck: { type: 'none' as const },
  tags: ['orchestration'],
} satisfies ICommandDescriptor;

export class AskUserCommand implements ICommand<Params, AskUserResult> {
  static readonly schema = _askUserCommandSchema;
  readonly metadata = AskUserCommandMetadata;

  constructor(private readonly questionService: IQuestionService) {}

  async execute(
    params: Params,
    _context: ExecutionContext
  ): Promise<CommandResponse<AskUserResult>> {
    const normalizedParams = AskUserCommand.schema.parse(params);
    const result = await this.executeAskUser(normalizedParams);
    return { status: 'ok', data: result };
  }

  private static makeResult(
    kind: AskKind,
    answer: unknown,
    workflow?: AskUserParams['workflow']
  ): AskUserResult {
    return { type: 'com_ask_result', kind, answer, workflow, timestamp: new Date().toISOString() };
  }

  private static ensureChoices(kind: 'select' | 'checklist', choices: AskUserParams['choices']) {
    if (!choices || choices.length === 0) {
      throw new Error(`com_ask ${kind} requires at least one choice.`);
    }
    return choices;
  }

  private async executeConfirmAsk(params: AskUserParams): Promise<AskUserResult> {
    const { message, defaultBoolean, workflow } = params;
    const suffix = defaultBoolean ? '[Y/n]' : '[y/N]';
    if (typeof this.questionService.confirm === 'function') {
      const answer = await this.questionService.confirm({
        message: `${message} ${suffix}`,
        default: defaultBoolean,
      });
      return AskUserCommand.makeResult('confirm', answer, workflow);
    }
    // Fallback: use text input and interpret answer as boolean.
    const raw = await this.questionService.input({ message: `${message} ${suffix}` });
    const answer = /^(y|yes|true|1)$/i.test(raw.trim());
    return AskUserCommand.makeResult('confirm', answer, workflow);
  }

  private async executeSelectAsk(params: AskUserParams): Promise<AskUserResult> {
    const { message, defaultText, choices, workflow, allowOther, otherLabel, otherPrompt } = params;
    const options = AskUserCommand.ensureChoices('select', choices);
    if (typeof this.questionService.select === 'function') {
      const answer = await this.questionService.select({
        message,
        choices: options,
        default: defaultText,
        allowOther,
        otherLabel,
        otherPrompt,
      });
      return AskUserCommand.makeResult('select', answer, workflow);
    }
    // Fallback: use text input.
    const answer = await this.questionService.input({ message });
    return AskUserCommand.makeResult('select', answer, workflow);
  }

  private async executePasswordAsk(params: AskUserParams): Promise<AskUserResult> {
    const { message, mask, workflow } = params;
    const answer = await this.questionService.password({ message, mask });
    return AskUserCommand.makeResult('password', answer, workflow);
  }

  private async executeChecklistAsk(params: AskUserParams): Promise<AskUserResult> {
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
    const options = AskUserCommand.ensureChoices('checklist', choices);
    if (typeof this.questionService.checklist === 'function') {
      const answer = await this.questionService.checklist({
        message,
        choices: options,
        default: defaultChecklist,
        minSelections,
        maxSelections,
        allowOther,
        otherLabel,
        otherPrompt,
      });
      return AskUserCommand.makeResult('checklist', answer, workflow);
    }
    // Fallback: use text input and split by comma.
    const raw = await this.questionService.input({ message });
    const answer = raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return AskUserCommand.makeResult('checklist', answer, workflow);
  }

  private async executeInputAsk(params: AskUserParams): Promise<AskUserResult> {
    const { message, defaultText, workflow } = params;
    const prompt = defaultText ? `${message} (default: ${defaultText})` : message;
    const answer = await this.questionService.input({ message: prompt });
    return AskUserCommand.makeResult('input', answer, workflow);
  }

  private async executeAskUser(params: AskUserParams): Promise<AskUserResult> {
    const { kind = 'input' } = params;
    switch (kind) {
      case 'confirm':
        return this.executeConfirmAsk(params);
      case 'select':
        return this.executeSelectAsk(params);
      case 'password':
        return this.executePasswordAsk(params);
      case 'checklist':
        return this.executeChecklistAsk(params);
      case 'input':
      default:
        return this.executeInputAsk(params);
    }
  }
}
