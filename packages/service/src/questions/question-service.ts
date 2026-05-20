import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';

const tick = () => new Promise<void>((r) => setImmediate(r));

function resolveSelectAnswer(
  input: string,
  choices: Array<{ name: string; value: string }>
): string | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const numeric = Number.parseInt(trimmed, 10);
  if (!Number.isNaN(numeric) && numeric >= 1 && numeric <= choices.length) {
    return choices[numeric - 1].value;
  }

  return (
    choices.find((c) => c.value.toLowerCase() === trimmed.toLowerCase())?.value ??
    choices.find((c) => c.name.toLowerCase() === trimmed.toLowerCase())?.value
  );
}

export interface IQuestionService {
  input(request: QuestionInputRequest, context: ExecutionContext): Promise<string>;
  confirm(request: QuestionConfirmRequest, context: ExecutionContext): Promise<boolean>;
  select(request: QuestionSelectRequest, context: ExecutionContext): Promise<string>;
  password(request: QuestionPasswordRequest, context: ExecutionContext): Promise<string>;
  checklist(request: QuestionChecklistRequest, context: ExecutionContext): Promise<string[]>;
}

export interface IQuestionListeners {
  questionInput?: (request: QuestionInputRequest) => Promise<string>;
  questionConfirm?: (request: QuestionConfirmRequest) => Promise<boolean>;
  questionSelect?: (request: QuestionSelectRequest) => Promise<string>;
  questionPassword?: (request: QuestionPasswordRequest) => Promise<string>;
  questionChecklist?: (request: QuestionChecklistRequest) => Promise<string[]>;
  signal?: AbortSignal;
}

export class InteractionQuestionService implements IQuestionService {
  constructor(private readonly listeners: IQuestionListeners) {}

  async input(request: QuestionInputRequest, _context: ExecutionContext): Promise<string> {
    await tick();
    if (!this.listeners.questionInput) {
      throw new Error('Input question requested but no questionInput responder is available.');
    }
    return this.listeners.questionInput(request);
  }

  async confirm(request: QuestionConfirmRequest, _context: ExecutionContext): Promise<boolean> {
    await tick();
    if (!this.listeners.questionConfirm) {
      throw new Error('Confirm question requested but no questionConfirm responder is available.');
    }
    return this.listeners.questionConfirm(request);
  }

  async select(request: QuestionSelectRequest, _context: ExecutionContext): Promise<string> {
    await tick();
    if (!this.listeners.questionSelect) {
      if (!this.listeners.questionInput) {
        throw new Error('Select question requested but no questionSelect responder is available.');
      }
      const choiceLines = request.choices.map((c, i) => `${i + 1}. ${c.name}`).join('\n');
      const answer = await this.listeners.questionInput({
        message: `${request.message}\n${choiceLines}\nEnter number or option value:`,
      });
      const resolved = resolveSelectAnswer(answer, request.choices);
      if (!resolved) {
        throw new Error('Invalid selection for select question.');
      }
      return resolved;
    }
    return this.listeners.questionSelect(request);
  }

  async password(request: QuestionPasswordRequest, _context: ExecutionContext): Promise<string> {
    await tick();
    if (!this.listeners.questionPassword) {
      throw new Error(
        'Password question requested but no questionPassword responder is available.'
      );
    }
    return this.listeners.questionPassword(request);
  }

  async checklist(
    request: QuestionChecklistRequest,
    _context: ExecutionContext
  ): Promise<string[]> {
    await tick();
    if (!this.listeners.questionChecklist) {
      if (!this.listeners.questionInput) {
        throw new Error(
          'Checklist question requested but no questionChecklist responder is available.'
        );
      }
      const options = request.choices.map((c) => `${c.value} (${c.name})`).join(', ');
      const defaults = request.default?.join(', ');
      const defaultsLine = defaults ? `\nDefaults: ${defaults}` : '';
      const prompt = `${request.message}\nOptions: ${options}${defaultsLine}\nType comma-separated option values:`;
      const raw = await this.listeners.questionInput({ message: prompt });
      const values = raw
        .split(',')
        .map((v: string) => v.trim())
        .filter(Boolean);
      const selected = values.length === 0 && request.default ? request.default : values;
      const invalid = selected.filter(
        (value: string) => !request.choices.some((c) => c.value === value)
      );
      if (invalid.length > 0) {
        throw new Error(`Invalid checklist selection(s): ${invalid.join(', ')}.`);
      }
      return selected;
    }
    return this.listeners.questionChecklist(request);
  }
}
