import { describe, expect, it, vi } from 'vitest';
import { AskUserCommand } from '../commands/com/ask.command.js';
import type { IQuestionService } from '../questions/question-service.js';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'michael-brown',
    workspaceRoot: 'c:/workspace',
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo', systemPrompt: '' },
    history: [],
    ...overrides,
  } as any;
}

function makeQuestionService(
  overrides: Partial<IQuestionService>
): IQuestionService {
  return {
    input: vi.fn(async () => ''),
    confirm: vi.fn(async () => true),
    select: vi.fn(async () => ''),
    password: vi.fn(async () => ''),
    checklist: vi.fn(async () => []),
    ...overrides,
  };
}

describe('AskUserCommand', () => {
  it('passes workflow metadata through in tool result payload', async () => {
    const questionInput = vi.fn(async () => 'approved');
    const questionService = makeQuestionService({
      input: questionInput,
      confirm: vi.fn(async () => true),
      select: vi.fn(async () => ''),
      password: vi.fn(async () => ''),
      checklist: vi.fn(async () => []),
    });
    const command = new AskUserCommand(questionService);

    const result = await command.execute(
      {
        kind: 'input',
        message: 'Provide decision',
        workflow: {
          workflowId: 'wf-1',
          stepId: 'step-2',
          questionId: 'q-2',
          continuationToken: 'cont-abc',
        },
      },
      makeContext()
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: expect.objectContaining({
          type: 'com_ask_result',
          kind: 'input',
          answer: 'approved',
          workflow: {
            workflowId: 'wf-1',
            stepId: 'step-2',
            questionId: 'q-2',
            continuationToken: 'cont-abc',
          },
        }),
      })
    );
  });

  it('falls back to questionInput for select when questionSelect is missing', async () => {
    const questionInput = vi.fn(async () => 'ai-team-context');
    const questionService = makeQuestionService({
      input: questionInput,
      confirm: vi.fn(async () => true),
      select: undefined,
      password: vi.fn(async () => ''),
      checklist: vi.fn(async () => []),
    });
    const command = new AskUserCommand(questionService);

    const result = await command.execute(
      {
        kind: 'select',
        message: 'Which topic?',
        choices: [
          { name: 'AI Team Context', value: 'ai-team-context' },
          { name: 'Tooling', value: 'tooling' },
        ],
      },
      makeContext()
    );

    expect(questionInput).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: expect.objectContaining({
          type: 'com_ask_result',
          kind: 'select',
          answer: 'ai-team-context',
        }),
      })
    );
  });

  it('falls back to questionInput for checklist when questionChecklist is missing', async () => {
    const questionInput = vi.fn(async () => 'a, c');
    const questionService = makeQuestionService({
      input: questionInput,
      confirm: vi.fn(async () => true),
      select: vi.fn(async () => ''),
      password: vi.fn(async () => ''),
      checklist: undefined,
    });
    const command = new AskUserCommand(questionService);

    const result = await command.execute(
      {
        kind: 'checklist',
        message: 'Pick topics',
        choices: [
          { name: 'A', value: 'a' },
          { name: 'B', value: 'b' },
          { name: 'C', value: 'c' },
        ],
      },
      makeContext()
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: expect.objectContaining({
          type: 'com_ask_result',
          kind: 'checklist',
          answer: ['a', 'c'],
        }),
      })
    );
  });

  it('falls back to questionInput for confirm when questionConfirm is missing', async () => {
    const questionInput = vi.fn(async () => 'yes');
    const questionService = makeQuestionService({
      input: questionInput,
      confirm: undefined,
      select: vi.fn(async () => ''),
      password: vi.fn(async () => ''),
      checklist: vi.fn(async () => []),
    });
    const command = new AskUserCommand(questionService);

    const result = await command.execute(
      {
        kind: 'confirm',
        message: 'Proceed?',
        defaultBoolean: false,
      },
      makeContext()
    );

    expect(result).toEqual(
      expect.objectContaining({
        status: 'ok',
        data: expect.objectContaining({
          type: 'com_ask_result',
          kind: 'confirm',
          answer: true,
        }),
      })
    );
  });
});
