import inquirer from 'inquirer';
import type {
  InteractionContext,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-client';

export function createQuestionResponders(): Pick<
  InteractionContext,
  'questionInput' | 'questionConfirm' | 'questionSelect' | 'questionPassword' | 'questionChecklist'
> {
  const readTrimmedString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

  const parseChoice = (item: unknown): { name: string; value: string; description?: string } | undefined => {
    if (typeof item === 'string') {
      const value = readTrimmedString(item);
      return value ? { name: value, value } : undefined;
    }

    if (!item || typeof item !== 'object') {
      return undefined;
    }

    const nameValue = readTrimmedString((item as { name?: unknown }).name);
    const rawValue = readTrimmedString((item as { value?: unknown }).value);
    const value = rawValue || nameValue;
    const name = nameValue || value;
    if (!name || !value) {
      return undefined;
    }

    const description = readTrimmedString((item as { description?: unknown }).description);
    const recommended = Boolean((item as { recommended?: unknown }).recommended);

    return {
      name: recommended ? `${name} ★` : name,
      value,
      description: description || undefined,
    };
  };

  const normalizeSelectChoices = (rawChoices: unknown): Array<{ name: string; value: string; description?: string }> => {
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
      .map(parseChoice)
      .filter((entry): entry is { name: string; value: string; description?: string } => Boolean(entry));
  };

  return {
    questionInput: async (request: QuestionInputRequest) => {
      const answer = await inquirer.prompt<{ value: string }>([
        {
          type: 'input',
          name: 'value',
          message: request.message,
          validate: request.validate,
        },
      ]);
      return answer.value;
    },
    questionConfirm: async (request: QuestionConfirmRequest) => {
      const answer = await inquirer.prompt<{ value: boolean }>([
        {
          type: 'confirm',
          name: 'value',
          message: request.message,
          default: request.default,
        },
      ]);
      return answer.value;
    },
    questionSelect: async (request: QuestionSelectRequest) => {
      const choices = normalizeSelectChoices(request.choices as unknown);
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
    },
    questionPassword: async (request: QuestionPasswordRequest) => {
      const answer = await inquirer.prompt<{ value: string }>([
        {
          type: 'password',
          name: 'value',
          message: request.message,
          mask: request.mask,
        },
      ]);
      return answer.value;
    },
    questionChecklist: async (request: QuestionChecklistRequest) => {
      const defaultValues = Array.isArray(request.default)
        ? request.default.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
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
    },
  };
}
