import { describe, expect, it, vi } from 'vitest';
import { InquirerQuestionService } from './question-responders.js';

describe('InquirerQuestionService', () => {
  it('runs questions inside the injected terminal lifecycle hooks', async () => {
    const calls: string[] = [];
    const prompt = vi.fn(async () => {
      calls.push('prompt');
      return { value: true };
    });
    const service = new InquirerQuestionService(prompt);
    service.setLifecycleHooks({
      beforeQuestion: () => calls.push('pause-tui'),
      afterQuestion: () => calls.push('resume-tui'),
    });

    await expect(
      service.confirm({ message: 'Proceed?', default: true })
    ).resolves.toBe(true);
    expect(calls).toEqual(['pause-tui', 'prompt', 'resume-tui']);
  });

  it('always restores the TUI when a question fails', async () => {
    const afterQuestion = vi.fn();
    const service = new InquirerQuestionService(async () => {
      throw new Error('prompt failed');
    });
    service.setLifecycleHooks({
      beforeQuestion: vi.fn(),
      afterQuestion,
    });

    await expect(service.input({ message: 'Value' })).rejects.toThrow('prompt failed');
    expect(afterQuestion).toHaveBeenCalledOnce();
  });

  it('normalizes select choices before invoking the prompt adapter', async () => {
    const prompt = vi.fn(async () => ({ value: 'sarah-lee' }));
    const service = new InquirerQuestionService(prompt);

    await expect(
      service.select({
        message: 'Choose',
        choices: [
          {
            name: 'Sarah Lee',
            value: 'sarah-lee',
            description: 'Architect',
            recommended: true,
          },
        ],
      })
    ).resolves.toBe('sarah-lee');

    expect(prompt).toHaveBeenCalledWith([
      expect.objectContaining({
        type: 'select',
        choices: [
          expect.objectContaining({
            name: 'Sarah Lee ★',
            value: 'sarah-lee',
          }),
        ],
      }),
    ]);
  });
});
