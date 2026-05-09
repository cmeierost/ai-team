import { describe, expect, it, vi } from 'vitest';
import { AskUserCommand } from '../commands/com/ask.command.js';

function makeContext(overrides: Record<string, unknown> = {}) {
  return {
    agentId: 'michael-brown',
    workspaceRoot: 'c:/workspace',
    agent: { id: 'michael-brown', name: 'Michael Brown', role: 'ceo', systemPrompt: '' },
    ...overrides,
  } as any;
}

describe('AskUserCommand', () => {
  it('passes workflow metadata through in tool result payload', async () => {
    const command = new AskUserCommand();
    const questionInput = vi.fn(async () => 'approved');

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
      makeContext({ questionInput }),
      { invocationSurface: 'tool', workspaceRoot: 'c:/workspace', agentId: 'michael-brown' }
    );

    expect(result).toEqual(
      expect.objectContaining({
        type: 'com_ask_result',
        kind: 'input',
        answer: 'approved',
        workflow: {
          workflowId: 'wf-1',
          stepId: 'step-2',
          questionId: 'q-2',
          continuationToken: 'cont-abc',
        },
      })
    );
  });

  it('falls back to questionInput for select when questionSelect is missing', async () => {
    const command = new AskUserCommand();
    const questionInput = vi.fn(async () => 'ai-team-context');

    const result = await command.execute(
      {
        kind: 'select',
        message: 'Which topic?',
        choices: [
          { name: 'AI Team Context', value: 'ai-team-context' },
          { name: 'Tooling', value: 'tooling' },
        ],
      },
      makeContext({ questionInput }),
      { invocationSurface: 'tool', workspaceRoot: 'c:/workspace', agentId: 'michael-brown' }
    );

    expect(questionInput).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({ type: 'com_ask_result', kind: 'select', answer: 'ai-team-context' })
    );
  });

  it('falls back to questionInput for checklist when questionChecklist is missing', async () => {
    const command = new AskUserCommand();
    const questionInput = vi.fn(async () => 'a, c');

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
      makeContext({ questionInput }),
      { invocationSurface: 'tool', workspaceRoot: 'c:/workspace', agentId: 'michael-brown' }
    );

    expect(result).toEqual(
      expect.objectContaining({ type: 'com_ask_result', kind: 'checklist', answer: ['a', 'c'] })
    );
  });

  it('falls back to questionInput for confirm when questionConfirm is missing', async () => {
    const command = new AskUserCommand();
    const questionInput = vi.fn(async () => 'yes');

    const result = await command.execute(
      {
        kind: 'confirm',
        message: 'Proceed?',
        defaultBoolean: false,
      },
      makeContext({ questionInput }),
      { invocationSurface: 'tool', workspaceRoot: 'c:/workspace', agentId: 'michael-brown' }
    );

    expect(result).toEqual(
      expect.objectContaining({ type: 'com_ask_result', kind: 'confirm', answer: true })
    );
  });
});
