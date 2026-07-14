import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  QuestionChecklistRequest,
  QuestionConfirmRequest,
  QuestionPasswordRequest,
  QuestionSelectRequest,
} from '@ai-team/api-contracts';
import { CHAT_RENDERING_TESTING } from './chat.js';

describe('chat question UX parity', () => {
  const originalIsTTY = process.stdin.isTTY;

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it('uses inquirer-backed responders for tty confirm/select/checklist/password', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });

    const onQuestionStart = vi.fn();
    const onAnswered = vi.fn();

    const inquirerQuestionService = {
      confirm: vi.fn(async (_request: QuestionConfirmRequest) => true),
      select: vi.fn(async (_request: QuestionSelectRequest) => 'michael-brown'),
      checklist: vi.fn(async (_request: QuestionChecklistRequest) => ['chat', 'build']),
      password: vi.fn(async (_request: QuestionPasswordRequest) => 'secret'),
    };

    const responders = CHAT_RENDERING_TESTING.createChatQuestionResponders(
      new AbortController().signal,
      onAnswered,
      onQuestionStart,
      undefined,
      [],
      inquirerQuestionService
    );

    const confirmRequest: QuestionConfirmRequest = {
      questionType: 'confirm',
      message: 'Proceed?',
      default: true,
    };
    const selectRequest: QuestionSelectRequest = {
      questionType: 'select',
      message: 'Pick one',
      choices: [{ name: 'Michael', value: 'michael-brown' }],
    };
    const checklistRequest: QuestionChecklistRequest = {
      questionType: 'checklist',
      message: 'Pick many',
      choices: [
        { name: 'Chat', value: 'chat' },
        { name: 'Build', value: 'build' },
      ],
      minSelections: 1,
    };
    const passwordRequest: QuestionPasswordRequest = {
      questionType: 'password',
      message: 'Enter secret',
      mask: '*',
    };

    await expect(responders.confirm(confirmRequest)).resolves.toBe(true);
    await expect(responders.select(selectRequest)).resolves.toBe('michael-brown');
    await expect(responders.checklist(checklistRequest)).resolves.toEqual(['chat', 'build']);
    await expect(responders.password(passwordRequest)).resolves.toBe('secret');

    expect(inquirerQuestionService.confirm).toHaveBeenCalledWith(confirmRequest);
    expect(inquirerQuestionService.select).toHaveBeenCalledWith(selectRequest);
    expect(inquirerQuestionService.checklist).toHaveBeenCalledWith(checklistRequest);
    expect(inquirerQuestionService.password).toHaveBeenCalledWith(passwordRequest);

    expect(onQuestionStart).toHaveBeenCalledTimes(4);
    expect(onAnswered).toHaveBeenCalledTimes(4);
  });
});
