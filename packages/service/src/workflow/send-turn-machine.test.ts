import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../orchestrator/send-turn-steps.js', () => ({
  ensureTurnStartAsync: vi.fn(async () => {}),
  persistUserMessageAsync: vi.fn(async () => ({
    timestamp: new Date().toISOString(),
    from: 'human',
    to: 'agent',
    isHuman: true,
    content: 'hello',
  })),
  prepareMessagesAsync: vi.fn(async () => [{ role: 'user', content: 'hello' }]),
  resolveSkillsAndToolsAsync: vi.fn(async () => ({
    skills: [],
    teamRoster: [],
    allTools: [],
    toolDefs: [],
  })),
  invokeTurnLlmAsync: vi.fn(async () => ({
    fullResponse: 'assistant response',
    structuredResults: [],
  })),
  persistAssistantMessageAsync: vi.fn(async () => ({
    persistedContent: 'assistant response',
    persistedMessage: {
      timestamp: new Date().toISOString(),
      from: 'agent',
      to: 'human',
      isHuman: false,
      content: 'assistant response',
    },
  })),
  parseTurnResultAsync: vi.fn(async () => null),
  finalizeTurnResultAsync: vi.fn(async () => ({ text: 'assistant response', done: false })),
  handleLlmFailureAsync: vi.fn(async () => ({ text: 'fallback', done: true })),
}));

import {
  ensureTurnStartAsync,
  finalizeTurnResultAsync,
  handleLlmFailureAsync,
  invokeTurnLlmAsync,
  parseTurnResultAsync,
  persistAssistantMessageAsync,
  persistUserMessageAsync,
  prepareMessagesAsync,
  resolveSkillsAndToolsAsync,
} from '../orchestrator/send-turn-steps.js';
import { runSendTurnMachineAsync } from './send-turn-machine.js';

describe('send-turn-machine', () => {
  const ctx = {
    hooks: {},
    history: [],
  } as any;

  const plugins = {
    hookPlugins: [],
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(invokeTurnLlmAsync).mockResolvedValue({
      fullResponse: 'assistant response',
      structuredResults: [],
    });
    vi.mocked(handleLlmFailureAsync).mockResolvedValue({ text: 'fallback', done: true });
    vi.mocked(finalizeTurnResultAsync).mockResolvedValue({
      text: 'assistant response',
      done: false,
    });
    vi.mocked(parseTurnResultAsync).mockResolvedValue(null);
  });

  it('runs full success path and returns chat loop compatible output', async () => {
    const result = await runSendTurnMachineAsync({
      userMessage: 'hello',
      hop: 0,
      ctx,
      plugins,
      options: { skipPersist: false },
    });

    expect(result.chatResult).toEqual({
      text: 'assistant response',
      toolRoundNeeded: false,
    });
    expect(result.turnResult).toEqual({
      text: 'assistant response',
      done: false,
    });

    expect(ensureTurnStartAsync).toHaveBeenCalledOnce();
    expect(persistUserMessageAsync).toHaveBeenCalledOnce();
    expect(prepareMessagesAsync).toHaveBeenCalledOnce();
    expect(resolveSkillsAndToolsAsync).toHaveBeenCalledOnce();
    expect(invokeTurnLlmAsync).toHaveBeenCalledOnce();
    expect(persistAssistantMessageAsync).toHaveBeenCalledOnce();
    expect(parseTurnResultAsync).toHaveBeenCalledOnce();
    expect(finalizeTurnResultAsync).toHaveBeenCalledOnce();
    expect(handleLlmFailureAsync).not.toHaveBeenCalled();
  });

  it('runs llm-failure fallback path when invoke step throws', async () => {
    vi.mocked(invokeTurnLlmAsync).mockRejectedValue(new Error('provider unavailable'));

    const result = await runSendTurnMachineAsync({
      userMessage: 'hello',
      hop: 0,
      ctx,
      plugins,
      options: { skipPersist: false },
    });

    expect(result.chatResult).toEqual({
      text: 'fallback',
      toolRoundNeeded: false,
    });
    expect(result.turnResult).toEqual({
      text: 'fallback',
      done: true,
    });

    expect(invokeTurnLlmAsync).toHaveBeenCalledOnce();
    expect(handleLlmFailureAsync).toHaveBeenCalledOnce();
    expect(persistAssistantMessageAsync).not.toHaveBeenCalled();
    expect(parseTurnResultAsync).not.toHaveBeenCalled();
    expect(finalizeTurnResultAsync).not.toHaveBeenCalled();
  });
});
