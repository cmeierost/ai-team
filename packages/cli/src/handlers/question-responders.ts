import inquirer from 'inquirer';
import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import type { IQuestionService } from '@ai-team/service';

export class InquirerQuestionService implements IQuestionService {
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
    const answer = await inquirer.prompt<{ value: string }>([
      {
        type: 'input',
        name: 'value',
        message: request.message,
        validate: request.validate,
      },
    ]);
    return answer.value;
  }

  async confirm(request: QuestionConfirmRequest): Promise<boolean> {
    const answer = await inquirer.prompt<{ value: boolean }>([
      {
        type: 'confirm',
        name: 'value',
        message: request.message,
        default: request.default,
      },
    ]);
    return answer.value;
  }

  async select(request: QuestionSelectRequest): Promise<string> {
    const choices = this.normalizeSelectChoices(request.choices as unknown);
    if (choices.length === 0) {
      throw new Error('Select question has no valid choices.');
    }

    const defaultValue = typeof request.default === 'string' ? request.default : undefined;
    const answer = await inquirer.prompt<{ value: string }>([
      {
        type: 'select',
        name: 'value',
        message: request.message,
        choices,
        default: defaultValue,
      },
    ]);
    return answer.value;
  }

  async password(request: QuestionPasswordRequest): Promise<string> {
    const answer = await inquirer.prompt<{ value: string }>([
      {
        type: 'password',
        name: 'value',
        message: request.message,
        mask: request.mask,
      },
    ]);
    return answer.value;
  }

  async checklist(request: QuestionChecklistRequest): Promise<string[]> {
    const defaultValues = Array.isArray(request.default)
      ? request.default.filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0
        )
      : undefined;
    const answer = await inquirer.prompt<{ value: string[] }>([
      {
        type: 'checkbox',
        name: 'value',
        message: request.message,
        choices: request.choices,
        default: defaultValues,
      },
    ]);
    return answer.value;
  }
}

export function createQuestionResponders(): IQuestionService {
  return new InquirerQuestionService();
}
