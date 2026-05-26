import { describe, expect, it, vi } from 'vitest';
import type { InitTemplates } from './template-utils.js';
import { pickAgentName } from './name-picking.js';

vi.mock('ora', () => ({
  default: () => ({
    start() {
      return this;
    },
    stop() {
      return this;
    },
  }),
}));

const baseTemplates = {
  nameSystemPrompt: 'system',
  nameRequestPrompt: '{{selectedContext}}Names for {{roleLabel}}',
  nameRequestStrictPrompt: '{{selectedContext}}STRICT names for {{roleLabel}}',
} as unknown as InitTemplates;

function createIo() {
  return {
    requestSelect: vi.fn().mockImplementation(async (_hooks, request) => request.choices[0]?.value),
    requestInput: vi.fn(),
    writeWarn: vi.fn(),
  };
}

describe('pickAgentName', () => {
  it('retries with strict prompt when first name call throws empty response', async () => {
    const llm = {
      rawChat: vi
        .fn()
        .mockRejectedValueOnce(new Error('LLM returned an empty response'))
        .mockResolvedValueOnce('["Jane Doe","Alice Brown","Eve Adams","Liam Stone","Noah Reed"]'),
    };

    const io = createIo();

    const selected = await pickAgentName(llm as never, baseTemplates, 'CEO', [], undefined, io);

    expect(llm.rawChat).toHaveBeenCalledTimes(2);
    expect(io.writeWarn).not.toHaveBeenCalled();
    expect(selected).toBe('Jane Doe');
  });

  it('falls back only after both primary and strict attempts fail', async () => {
    const llm = {
      rawChat: vi
        .fn()
        .mockRejectedValueOnce(new Error('LLM returned an empty response'))
        .mockRejectedValueOnce(new Error('LLM returned an empty response')),
    };

    const io = createIo();

    const selected = await pickAgentName(
      llm as never,
      baseTemplates,
      'CEO',
      ['John Smith'],
      undefined,
      io
    );

    expect(llm.rawChat).toHaveBeenCalledTimes(2);
    expect(io.writeWarn).toHaveBeenCalledTimes(1);
    expect(selected).not.toBe('John Smith');
    expect(typeof selected).toBe('string');
    expect(selected.length).toBeGreaterThan(0);
  });
});
