import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { ICommandDispatcher } from '@ai-team/api-contracts';
import type { Agent } from '@ai-team/core';
import type { IEmitService } from '@ai-team/core';

const INIT_ASK_AGENT: Agent = {
  id: 'init-system',
  name: 'Init System',
  role: 'setup orchestrator',
  type: 'executive' as Agent['type'],
  contextLevel: 'organization' as Agent['contextLevel'],
  filePath: '',
  skillPath: '',
  createdAt: new Date().toISOString(),
};

type AskKind = 'input' | 'confirm' | 'select' | 'password' | 'checklist';

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) {
    return undefined;
  }

  // Try exact match first
  const exact = choices.find((c) => c.value === trimmed || c.name === trimmed);
  if (exact) {
    return exact.value;
  }

  // Try case-insensitive match
  const caseInsensitive = choices.find(
    (c) =>
      c.value.toLowerCase() === trimmed.toLowerCase() ||
      c.name.toLowerCase() === trimmed.toLowerCase()
  );
  if (caseInsensitive) {
    return caseInsensitive.value;
  }

  // Try prefix match
  const prefix = choices.find(
    (c) =>
      c.value.toLowerCase().startsWith(trimmed.toLowerCase()) ||
      c.name.toLowerCase().startsWith(trimmed.toLowerCase())
  );
  if (prefix) {
    return prefix.value;
  }

  return undefined;
}

/**
 * Orchestrates workflow question flows by delegating to CommandDispatcher.
 * Uses 'com-ask' command which is resolved from DI container.
 */
export class InitWorkflowQuestioner {
  constructor(
    private readonly commandDispatcher: ICommandDispatcher,
    private readonly emitService: IEmitService,
    private readonly signal?: AbortSignal
  ) {}

  private async askViaComAsk(params: {
    kind: AskKind;
    message: string;
    workflow?: {
      workflowId?: string;
      stepId?: string;
      continuationToken?: string;
      questionId?: string;
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
  }): Promise<unknown> {
    const response = await this.commandDispatcher.dispatch('com-ask', params, {
      agent: INIT_ASK_AGENT,
      agentId: INIT_ASK_AGENT.id,
      history: [],
    });

    if (response.status === 'error') {
      throw new Error(response.message || 'com-ask command returned an error response.');
    }

    const result = response.data;
    if (!result || typeof result !== 'object' || !('answer' in result)) {
      throw new Error('com-ask command returned an unexpected response shape.');
    }
    return (result as Record<string, unknown>).answer;
  }

  async requestInput(request: QuestionInputRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.emitService.emit({
      kind: 'question',
      questionType: 'input',
      message: request.message,
    });

    const answer = await this.askViaComAsk({
      kind: 'input',
      message: request.message,
      workflow: request.workflow,
    });

    if (typeof answer !== 'string') {
      throw new TypeError('Input question expected a string answer from com_ask.');
    }

    if (request.validate) {
      const validationResult = request.validate(answer);
      if (validationResult !== true) {
        throw new Error(typeof validationResult === 'string' ? validationResult : 'Invalid input.');
      }
    }

    return answer;
  }

  async requestConfirm(request: QuestionConfirmRequest): Promise<boolean> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.emitService.emit({
      kind: 'question',
      questionType: 'confirm',
      message: request.message,
    });

    const answer = await this.askViaComAsk({
      kind: 'confirm',
      message: request.message,
      workflow: request.workflow,
      defaultBoolean: request.default,
    });

    if (typeof answer !== 'boolean') {
      throw new TypeError('Confirm question expected a boolean answer from com_ask.');
    }

    return answer;
  }

  async requestSelect(request: QuestionSelectRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.emitService.emit({
      kind: 'question',
      questionType: 'select',
      message: request.message,
      choices: request.choices,
    });

    const answer = await this.askViaComAsk({
      kind: 'select',
      message: request.message,
      choices: request.choices,
      workflow: request.workflow,
      defaultText: request.default,
      allowOther: request.allowOther,
      otherLabel: request.otherLabel,
      otherPrompt: request.otherPrompt,
    });

    if (typeof answer !== 'string') {
      throw new TypeError('Select question expected a string answer from com_ask.');
    }

    const resolved = resolveSelectAnswer(answer, request.choices);
    if (!resolved) {
      throw new Error(
        'Select responder returned an invalid choice. Please choose one of the listed options.'
      );
    }
    return resolved;
  }

  async requestPassword(request: QuestionPasswordRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.emitService.emit({
      kind: 'question',
      questionType: 'password',
      message: request.message,
    });

    const answer = await this.askViaComAsk({
      kind: 'password',
      message: request.message,
      workflow: request.workflow,
      mask: request.mask,
    });

    if (typeof answer !== 'string') {
      throw new TypeError('Password question expected a string answer from com_ask.');
    }

    return answer;
  }

  async requestChecklist(request: QuestionChecklistRequest): Promise<string[]> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.emitService.emit({
      kind: 'question',
      questionType: 'checklist',
      message: request.message,
      choices: request.choices,
    });

    const answer = await this.askViaComAsk({
      kind: 'checklist',
      message: request.message,
      choices: request.choices,
      workflow: request.workflow,
      defaultChecklist: request.default,
      minSelections: request.minSelections,
      maxSelections: request.maxSelections,
      allowOther: request.allowOther,
      otherLabel: request.otherLabel,
      otherPrompt: request.otherPrompt,
    });

    if (!Array.isArray(answer) || !answer.every((value) => typeof value === 'string')) {
      throw new Error('Checklist question expected a string[] answer from com_ask.');
    }

    const parsed = answer.map((value) => value.trim());
    for (const value of parsed) {
      if (!request.choices.some((choice) => choice.value === value)) {
        throw new Error(`Invalid checklist option: "${value}".`);
      }
    }

    return parsed;
  }
}
