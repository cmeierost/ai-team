import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { QuestionConfirmRequest, QuestionInputRequest } from '@ai-team/api-contracts';

const mocks = vi.hoisted(() => ({
  askWithSlashSuggestionsMock:
    vi.fn<(message: string, commands: unknown[], signal?: AbortSignal) => Promise<string>>(),
  questionMock: vi.fn<(message: string, options?: { signal?: AbortSignal }) => Promise<string>>(),
  closeMock: vi.fn(),
}));

vi.mock('../utils/slash-prompt.js', () => ({
  askWithSlashSuggestions: mocks.askWithSlashSuggestionsMock,
}));

vi.mock('node:readline/promises', () => ({
  createInterface: vi.fn(() => ({
    question: mocks.questionMock,
    close: mocks.closeMock,
  })),
}));

import { CHAT_RENDERING_TESTING } from './chat.js';

describe('chat question UX fallback + input behavior', () => {
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: originalIsTTY,
      configurable: true,
    });
  });

  it('keeps input slash-aware path and validation loop, without delegating to inquirer service', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: true,
      configurable: true,
    });

    mocks.askWithSlashSuggestionsMock.mockResolvedValueOnce('bad').mockResolvedValueOnce('good');

    const inquirerQuestionService = {
      confirm: vi.fn(),
      select: vi.fn(),
      checklist: vi.fn(),
      password: vi.fn(),
    };

    const onQuestionStart = vi.fn();
    const onAnswered = vi.fn();
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const responders = CHAT_RENDERING_TESTING.createChatQuestionResponders(
      new AbortController().signal,
      onAnswered,
      onQuestionStart,
      undefined,
      [],
      inquirerQuestionService
    );

    const request: QuestionInputRequest = {
      questionType: 'input',
      message: 'Type value',
      validate: (value) => (value === 'good' ? true : 'Not good enough'),
    };

    await expect(responders.input(request)).resolves.toBe('good');

    expect(mocks.askWithSlashSuggestionsMock).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Not good enough'));
    expect(onQuestionStart).toHaveBeenCalledTimes(1);
    expect(onAnswered).toHaveBeenCalledTimes(1);

    expect(inquirerQuestionService.confirm).not.toHaveBeenCalled();
    expect(inquirerQuestionService.select).not.toHaveBeenCalled();
    expect(inquirerQuestionService.checklist).not.toHaveBeenCalled();
    expect(inquirerQuestionService.password).not.toHaveBeenCalled();
  });

  it('uses readline fallback for non-tty confirm prompts', async () => {
    Object.defineProperty(process.stdin, 'isTTY', {
      value: false,
      configurable: true,
    });

    mocks.questionMock.mockResolvedValueOnce('maybe').mockResolvedValueOnce('yes');

    const inquirerQuestionService = {
      confirm: vi.fn(async () => true),
      select: vi.fn(),
      checklist: vi.fn(),
      password: vi.fn(),
    };

    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    const responders = CHAT_RENDERING_TESTING.createChatQuestionResponders(
      new AbortController().signal,
      vi.fn(),
      vi.fn(),
      undefined,
      [],
      inquirerQuestionService
    );

    const request: QuestionConfirmRequest = {
      questionType: 'confirm',
      message: 'Proceed?',
      default: false,
    };

    await expect(responders.confirm(request)).resolves.toBe(true);

    expect(mocks.questionMock).toHaveBeenCalledTimes(2);
    expect(mocks.closeMock).toHaveBeenCalledTimes(2);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Please answer yes or no.'));
    expect(inquirerQuestionService.confirm).not.toHaveBeenCalled();
  });
});
