import { describe, expect, it, vi } from 'vitest';
import { AskUserCommand } from './ask.command.js';

describe('AskUserCommand', () => {
  it('accepts message aliases and options JSON for select prompts', async () => {
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(async () => 'backend'),
      password: vi.fn(),
      checklist: vi.fn(),
    } as any;

    const command = new AskUserCommand(questionService);
    const response = await command.execute(
      {
        kind: 'select',
        question: 'Which area?',
        options: JSON.stringify([
          { label: 'Frontend', value: 'frontend' },
          { label: 'Backend', value: 'backend', description: 'Server/API' },
        ]),
      } as any,
      { history: [] } as any
    );

    expect(questionService.select).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Which area?',
        choices: [
          { name: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend', description: 'Server/API' },
        ],
      })
    );

    expect(response.status).toBe('ok');
    expect(response.data).toEqual(
      expect.objectContaining({
        type: 'com_ask_result',
        kind: 'select',
        answer: 'backend',
      })
    );
  });

  it('accepts options objects for checklist prompts', async () => {
    const questionService = {
      input: vi.fn(),
      confirm: vi.fn(),
      select: vi.fn(),
      password: vi.fn(),
      checklist: vi.fn(async () => ['frontend', 'backend']),
    } as any;

    const command = new AskUserCommand(questionService);
    const response = await command.execute(
      {
        kind: 'checklist',
        message: 'Select areas',
        options: [
          { label: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend', recommended: true },
        ],
      } as any,
      { history: [] } as any
    );

    expect(questionService.checklist).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Select areas',
        choices: [
          { name: 'Frontend', value: 'frontend' },
          { name: 'Backend', value: 'backend', recommended: true },
        ],
      })
    );

    expect(response.status).toBe('ok');
    expect(response.data).toEqual(
      expect.objectContaining({
        type: 'com_ask_result',
        kind: 'checklist',
        answer: ['frontend', 'backend'],
      })
    );
  });
});
