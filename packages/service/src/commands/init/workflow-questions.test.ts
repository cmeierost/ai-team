import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ExecutionContext } from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';

const askExecute = vi.hoisted(() => vi.fn());

vi.mock('../com/ask.command.js', () => ({
  AskUserCommand: class {
    execute = askExecute;
  },
}));

import { WorkflowQuestioner } from './workflow-questions.js';
import { EmitService } from '../../orchestrator/services/emit-service.js';

const minimalCtx: ExecutionContext = { workspaceRoot: '', history: [] };
const noopService = {} as IQuestionService;

describe('workflow questions ask-tool bridge', () => {
  beforeEach(() => {
    askExecute.mockReset();
  });

  it('routes input questions through com_ask and preserves workflow request payload', async () => {
    const questionInput = vi.fn().mockResolvedValue('ok-value');
    const questionService = { input: questionInput } as IQuestionService;
    const questioner = new WorkflowQuestioner(questionService, new EmitService(() => {}));

    askExecute.mockImplementation(async (params) => {
      expect(params.kind).toBe('input');
      expect(params.message).toBe('Original message');

      const answer = await questionService.input({
        message: 'Tool-adjusted prompt',
        workflow: params.workflow,
      });
      return {
        status: 'ok',
        data: {
          type: 'com_ask_result',
          kind: 'input',
          answer,
        },
      };
    });

    const answer = await questioner.requestInput({
      message: 'Original message',
      workflow: { workflowId: 'wf-1', questionId: 'step-1' },
      validate: (value: string) => (value.startsWith('ok') ? true : 'bad value'),
    });

    expect(answer).toBe('ok-value');
    expect(questionInput).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Tool-adjusted prompt',
        workflow: { workflowId: 'wf-1', questionId: 'step-1' },
      })
    );
  });

  it('routes confirm questions through com_ask', async () => {
    const questioner = new WorkflowQuestioner(noopService, new EmitService(() => {}));

    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'confirm',
        answer: true,
      },
    });

    const answer = await questioner.requestConfirm({
      message: 'Proceed?',
      default: false,
    });

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
    const questioner = new WorkflowQuestioner(noopService, new EmitService(() => {}));

    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'select',
        answer: 'Primary',
      },
    });

    const answer = await questioner.requestSelect({
      message: 'Pick one',
      choices: [
        { name: 'Primary', value: 'primary' },
        { name: 'Secondary', value: 'secondary' },
      ],
    });

    expect(answer).toBe('primary');
  });

  it('returns checklist values from com_ask', async () => {
    const questioner = new WorkflowQuestioner(noopService, new EmitService(() => {}));

    askExecute.mockResolvedValue({
      status: 'ok',
      data: {
        type: 'com_ask_result',
        kind: 'checklist',
        answer: ['primary', 'secondary'],
      },
    });

    const answer = await questioner.requestChecklist({
      message: 'Choose channels',
      choices: [
        { name: 'Primary', value: 'primary' },
        { name: 'Secondary', value: 'secondary' },
      ],
    });

    expect(answer).toEqual(['primary', 'secondary']);
  });
});
