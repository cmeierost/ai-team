import { describe, expect, it, vi, beforeEach } from 'vitest';

const askExecute = vi.hoisted(() => vi.fn());

vi.mock('../com/ask.command.js', () => ({
  AskUserCommand: class {
    execute = askExecute;
  },
}));

import {
  requestInput,
  requestConfirm,
  requestSelect,
  requestChecklist,
} from './workflow-questions.js';
import { InteractionQuestionService } from '../../questions/question-service.js';

describe('workflow questions ask-tool bridge', () => {
  beforeEach(() => {
    askExecute.mockReset();
  });

  it('routes input questions through com_ask and preserves workflow request payload', async () => {
    const questionInput = vi.fn().mockResolvedValue('ok-value');
    const questionService = InteractionQuestionService({ input: questionInput });

    askExecute.mockImplementation(async (params) => {
      expect(params.kind).toBe('input');
      expect(params.message).toBe('Original message');

      const answer = await questionService.input({ message: 'Tool-adjusted prompt' });
      return {
        status: 'ok',
        data: {
          type: 'com_ask_result',
          kind: 'input',
          answer,
        },
      };
    });

    const answer = await requestInput(
      { questionInput },
      {
        message: 'Original message',
        workflow: { workflowId: 'wf-1', questionId: 'step-1' },
        validate: (value: string) => (value.startsWith('ok') ? true : 'bad value'),
      }
    );

    expect(answer).toBe('ok-value');
    expect(questionInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Tool-adjusted prompt',
        workflow: { workflowId: 'wf-1', questionId: 'step-1' },
      })
    );
  });

  it('routes confirm questions through com_ask', async () => {
    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'confirm',
        answer: true,
      },
    });

    const answer = await requestConfirm(
      {},
      {
        message: 'Proceed?',
        default: false,
      }
    );

    expect(answer).toBe(true);
    expect(askExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'confirm',
        message: 'Proceed?',
        defaultBoolean: false,
      }),
      expect.any(Object)
    );
  });

  it('normalizes select answers returned by com_ask', async () => {
    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'select',
        answer: 'Primary',
      },
    });

    const answer = await requestSelect(
      {},
      {
        message: 'Pick one',
        choices: [
          { name: 'Primary', value: 'primary' },
          { name: 'Secondary', value: 'secondary' },
        ],
      }
    );

    expect(answer).toBe('primary');
  });

  it('returns checklist values from com_ask', async () => {
    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'checklist',
        answer: ['primary', 'secondary'],
      },
    });

    const answer = await requestChecklist(
      {},
      {
        message: 'Choose channels',
        choices: [
          { name: 'Primary', value: 'primary' },
          { name: 'Secondary', value: 'secondary' },
        ],
      }
    );

    expect(answer).toEqual(['primary', 'secondary']);
  });
});
