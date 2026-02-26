import inquirer from 'inquirer';
import type {
  MediatorContext,
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionInputRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-client';

export function createQuestionResponders(): Pick<
  MediatorContext,
  'questionInput' | 'questionConfirm' | 'questionSelect' | 'questionPassword' | 'questionChecklist'
> {
  const normalizeSelectChoices = (rawChoices: unknown): Array<{ name: string; value: string }> => {
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

    const normalized: Array<{ name: string; value: string }> = [];
    for (const item of source) {
      if (typeof item === 'string') {
        const value = item.trim();
        if (value) {
          normalized.push({ name: value, value });
        }
        continue;
      }

      if (!item || typeof item !== 'object') {
        continue;
      }

      const nameValue = 'name' in item ? String((item as { name?: unknown }).name ?? '').trim() : '';
      const rawValue = 'value' in item ? String((item as { value?: unknown }).value ?? '').trim() : '';
      const value = rawValue || nameValue;
      const name = nameValue || value;
      if (!name || !value) {
        continue;
      }
      normalized.push({ name, value });
    }

    return normalized;
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
      const answer = await inquirer.prompt<{ value: string }>([
        {
          type: 'select',
          name: 'value',
          message: request.message,
          choices,
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
      const answer = await inquirer.prompt<{ value: string[] }>([
        {
          type: 'checkbox',
          name: 'value',
          message: request.message,
          choices: request.choices,
        },
      ]);
      return answer.value;
    },
  };
}
