import inquirer from 'inquirer';
import chalk from 'chalk';
import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { IQuestionService } from '@ai-team/core';

// Route all inquirer UI output to stderr so it is never captured by the
// stdout patch that STDOUT_CAPTURE_SCOPE applies during command execution.
const prompt = inquirer.createPromptModule({ output: process.stderr });
type PromptRunner = <T extends Record<string, unknown>>(questions: unknown[]) => Promise<T>;

export class InquirerQuestionService implements IQuestionService {
  private beforeQuestion?: () => void;
  private afterQuestion?: () => void;
  private presenter?: IQuestionService;

  constructor(private readonly promptRunner: PromptRunner = prompt as PromptRunner) {}

  setLifecycleHooks(hooks?: { beforeQuestion(): void; afterQuestion(): void }): void {
    this.beforeQuestion = hooks?.beforeQuestion;
    this.afterQuestion = hooks?.afterQuestion;
  }

  attachPresenter(presenter: IQuestionService): () => void {
    this.presenter = presenter;
    return () => {
      if (this.presenter === presenter) this.presenter = undefined;
    };
  }

  private async runQuestion<T>(question: () => Promise<T>): Promise<T> {
    this.beforeQuestion?.();
    try {
      return await question();
    } finally {
      this.afterQuestion?.();
    }
  }

  private readTrimmedString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
  }

  private parseChoice(
    item: unknown
  ): { name: string; value: string; description?: string } | undefined {
    if (typeof item === 'string') {
      const value = this.readTrimmedString(item);
      return value ? { name: value, value } : undefined;
    }

    if (!item || typeof item !== 'object') {
      return undefined;
    }

    const nameValue = this.readTrimmedString((item as { name?: unknown }).name);
    const rawValue = this.readTrimmedString((item as { value?: unknown }).value);
    const value = rawValue || nameValue;
    const name = nameValue || value;
    if (!name || !value) {
      return undefined;
    }

    const description = this.readTrimmedString((item as { description?: unknown }).description);
    const recommended = Boolean((item as { recommended?: unknown }).recommended);

    return {
      name: recommended ? `${name} ★` : name,
      value,
      description: description || undefined,
    };
  }

  private normalizeSelectChoices(
    rawChoices: unknown
  ): Array<{ name: string; value: string; description?: string }> {
    let source: unknown = rawChoices;

    if (typeof source === 'string') {
      try {
        source = JSON.parse(source);
      } catch {
        source = [];
      }
    }

    if (!Array.isArray(source)) {
      return [];
    }

    return source
      .map((item) => this.parseChoice(item))
      .filter((entry): entry is { name: string; value: string; description?: string } =>
        Boolean(entry)
      );
  }

  async input(request: QuestionInputRequest): Promise<string> {
    if (this.presenter) return this.presenter.input(request);
    return this.runQuestion(async () => {
      const answer = await this.promptRunner<{ value: string }>([
        {
          type: 'input',
          name: 'value',
          message: request.message,
          validate: request.validate,
          transformer: (val: string) => chalk.white(val),
        },
      ]);
      return answer.value;
    });
  }

  async confirm(request: QuestionConfirmRequest): Promise<boolean> {
    if (this.presenter) return this.presenter.confirm(request);
    return this.runQuestion(async () => {
      const answer = await this.promptRunner<{ value: boolean }>([
        {
          type: 'confirm',
          name: 'value',
          message: request.message,
          default: request.default,
        },
      ]);
      return answer.value;
    });
  }

  async select(request: QuestionSelectRequest): Promise<string> {
    if (this.presenter) return this.presenter.select(request);
    const choices = this.normalizeSelectChoices(request.choices as unknown);
    if (choices.length === 0) {
      throw new Error('Select question has no valid choices.');
    }

    const defaultValue = typeof request.default === 'string' ? request.default : undefined;
    return this.runQuestion(async () => {
      const answer = await this.promptRunner<{ value: string }>([
        {
          type: 'select',
          name: 'value',
          message: request.message,
          choices,
          default: defaultValue,
        },
      ]);
      return answer.value;
    });
  }

  async password(request: QuestionPasswordRequest): Promise<string> {
    if (this.presenter) return this.presenter.password(request);
    return this.runQuestion(async () => {
      const answer = await this.promptRunner<{ value: string }>([
        {
          type: 'password',
          name: 'value',
          message: request.message,
          mask: request.mask,
        },
      ]);
      return answer.value;
    });
  }

  async checklist(request: QuestionChecklistRequest): Promise<string[]> {
    if (this.presenter) return this.presenter.checklist(request);
    const defaultValues = Array.isArray(request.default)
      ? request.default.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : undefined;
    return this.runQuestion(async () => {
      const answer = await this.promptRunner<{ value: string[] }>([
        {
          type: 'checkbox',
          name: 'value',
          message: request.message,
          choices: request.choices,
          default: defaultValues,
        },
      ]);
      return answer.value;
    });
  }
}

export function createQuestionResponders(): InquirerQuestionService {
  return new InquirerQuestionService();
}
