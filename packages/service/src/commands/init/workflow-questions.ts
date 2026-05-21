import type {
  RuntimeStreamEvent,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
  WorkflowFrame,
  WorkflowStateSnapshot,
} from '@ai-team/api-contracts';
import type { Agent, ExecutionContext, CommandResponse } from '@ai-team/core';
import type { IInteractionService } from '../../questions/question-service.js';

// ─── Runtime hooks ────────────────────────────────────────────────────────────

/**
 * Callbacks injected by a transport layer (CLI, API, VS Code) to handle
 * streaming output and interactive questions during init/onboard flows.
 */
export interface InitRuntimeHooks {
  signal?: AbortSignal;
  emit?: (event: RuntimeStreamEvent) => void;
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  workflowState?: WorkflowStateSnapshot;
  onWorkflowFrame?: (frame: WorkflowFrame) => void;
}
import type { IWorkflowService } from '../../workflow/workflow-service.js';
import { AskUserCommand } from '../com/ask.command.js';

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

function createAskExecutionContext(): ExecutionContext {
  return {
    agent: INIT_ASK_AGENT,
    agentId: INIT_ASK_AGENT.id,
    workspaceRoot: '',
    history: [],
  };
}

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
 * Orchestrates workflow question flows by delegating to an injected IQuestionService.
 * The service's methods do not require ExecutionContext parameters; context is bound at construction time.
 */
export class WorkflowQuestioner {
  constructor(
    private readonly questionService: IInteractionService,
    private readonly context: ExecutionContext,
    private readonly workflowService?: IWorkflowService,
    private readonly emit?: (event: RuntimeStreamEvent) => void,
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
    const askUserCommand = new AskUserCommand(this.questionService);
    const result = await askUserCommand.execute(params, createAskExecutionContext());
    const response =
      result && typeof result === 'object' && 'status' in result
        ? (result as CommandResponse<unknown>)
        : undefined;
    if (response?.status === 'error') {
      throw new Error(response.message || 'com_ask returned an error response.');
    }
    const payload = response?.data ?? result;
    if (!payload || typeof payload !== 'object' || !('answer' in payload)) {
      throw new Error('com_ask returned an unexpected response shape.');
    }
    return (payload as Record<string, unknown>).answer;
  }

  async requestInput(request: QuestionInputRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.workflowService?.emitQuestionFrame({ kind: 'input', ...request });
    this.emit?.({
      kind: 'question',
      questionType: 'input',
      message: request.message,
    });

    const resumed = this.workflowService?.resolveAnswer(request);
    if (typeof resumed === 'string') {
      this.workflowService?.emitResultFrame(request, resumed);
      return resumed;
    }

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

    this.workflowService?.emitResultFrame(request, answer);
    return answer;
  }

  async requestConfirm(request: QuestionConfirmRequest): Promise<boolean> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.workflowService?.emitQuestionFrame({ kind: 'confirm', ...request });
    this.emit?.({
      kind: 'question',
      questionType: 'confirm',
      message: request.message,
    });

    const resumed = this.workflowService?.resolveAnswer(request);
    if (typeof resumed === 'boolean') {
      this.workflowService?.emitResultFrame(request, resumed);
      return resumed;
    }

    const answer = await this.askViaComAsk({
      kind: 'confirm',
      message: request.message,
      workflow: request.workflow,
      defaultBoolean: request.default,
    });

    if (typeof answer !== 'boolean') {
      throw new TypeError('Confirm question expected a boolean answer from com_ask.');
    }

    this.workflowService?.emitResultFrame(request, answer);
    return answer;
  }

  async requestSelect(request: QuestionSelectRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.workflowService?.emitQuestionFrame({ kind: 'select', ...request });
    this.emit?.({
      kind: 'question',
      questionType: 'select',
      message: request.message,
      choices: request.choices,
    });

    const resumed = this.workflowService?.resolveAnswer(request);
    if (typeof resumed === 'string') {
      this.workflowService?.emitResultFrame(request, resumed);
      return resumed;
    }

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
    this.workflowService?.emitResultFrame(request, resolved);
    return resolved;
  }

  async requestPassword(request: QuestionPasswordRequest): Promise<string> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.workflowService?.emitQuestionFrame({ kind: 'password', ...request });
    this.emit?.({
      kind: 'question',
      questionType: 'password',
      message: request.message,
    });

    const resumed = this.workflowService?.resolveAnswer(request);
    if (typeof resumed === 'string') {
      this.workflowService?.emitResultFrame(request, resumed);
      return resumed;
    }

    const answer = await this.askViaComAsk({
      kind: 'password',
      message: request.message,
      workflow: request.workflow,
      mask: request.mask,
    });

    if (typeof answer !== 'string') {
      throw new TypeError('Password question expected a string answer from com_ask.');
    }

    this.workflowService?.emitResultFrame(request, answer);
    return answer;
  }

  async requestChecklist(request: QuestionChecklistRequest): Promise<string[]> {
    if (this.signal?.aborted) throw new Error('Workflow aborted');
    this.workflowService?.emitQuestionFrame({ kind: 'checklist', ...request });
    this.emit?.({
      kind: 'question',
      questionType: 'checklist',
      message: request.message,
      choices: request.choices,
    });

    const resumed = this.workflowService?.resolveAnswer(request);
    if (Array.isArray(resumed) && resumed.every((value) => typeof value === 'string')) {
      this.workflowService?.emitResultFrame(request, resumed);
      return resumed;
    }

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

    this.workflowService?.emitResultFrame(request, parsed);
    return parsed;
  }
}
