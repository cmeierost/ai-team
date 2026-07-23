import { describe, expect, it, vi } from 'vitest';
import type { Agent, ILlmSettingsResolver, LlmConfig, TeamConfig } from '@ai-team/core';
import { LlmService } from './llm-service.js';

function createService(config: LlmConfig): LlmService {
  const resolver: ILlmSettingsResolver = {
    resolveEffectiveLlmSettings: vi.fn(),
  } as unknown as ILlmSettingsResolver;

  const consoleLog = {
    isEnabled: () => false,
    write: vi.fn(),
  };

  const service = new LlmService('/tmp', {} as TeamConfig, resolver, consoleLog);
  service.initializeFromConfig(config);
  return service;
}

function createAgent(): Agent {
  return {
    id: 'michael',
    name: 'Michael Brown',
    role: 'ceo',
  } as Agent;
}

function createToolStream(round: number): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${round}`,
                  function: {
                    name: 'com_ask',
                    arguments: '{"kind":"select","message":"Pick one","choices":[]}',
                  },
                },
              ],
            },
          },
        ],
      };
    },
  };
}

function createToolStreamWithArguments(round: number, argumentsJson: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: `call_${round}`,
                  function: {
                    name: 'com_ask',
                    arguments: argumentsJson,
                  },
                },
              ],
            },
          },
        ],
      };
    },
  };
}

function createAssistantTextStream(text: string): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [
          {
            delta: {
              content: text,
            },
          },
        ],
      };
    },
  };
}

describe('LlmService tool retry cap', () => {
  it('logs the exact Chat Completions tool payload sent for a tool loop', async () => {
    const resolver: ILlmSettingsResolver = {
      resolveEffectiveLlmSettings: vi.fn(),
    } as unknown as ILlmSettingsResolver;
    const backendLog = { write: vi.fn() };
    const service = new LlmService('/tmp', {} as TeamConfig, resolver, backendLog as any);
    service.initializeFromConfig({
      provider: 'openai-compatible',
      model: 'gpt-4.1',
      baseUrl: 'http://localhost:9999/v1',
      apiKey: 'test-key',
    });
    (service as unknown as { client: unknown }).client = {
      chat: { completions: { create: vi.fn(async () => createAssistantTextStream('Done.')) } },
    };

    await service.chatWithTools(
      createAgent(),
      [{ role: 'user', content: 'Ask a question' }],
      [{ name: 'com_ask', description: 'Ask the developer', parameters: { type: 'object' } }],
      vi.fn()
    );

    const payload = backendLog.write.mock.calls[0]?.[0];
    expect(payload.request.api).toBe('chat-completions');
    expect(payload.request.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'com_ask',
          description: 'Ask the developer',
          parameters: { type: 'object' },
        },
      },
    ]);
  });

  it('stops repeated failing tool calls after one automatic retry in chat-completions mode', async () => {
    const service = createService({
      provider: 'github-copilot',
      model: 'gpt-4.1',
    });

    let round = 0;
    const create = vi.fn(async () => createToolStream(round++));
    (service as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create,
        },
      },
    };

    const executeTool = vi.fn(async ({ toolCallId }: { toolCallId: string }) => ({
      toolCallId,
      toolName: 'com_ask',
      result: 'Invalid parameters for com_ask',
      isError: true,
    }));

    await expect(
      service.chatWithTools(
        createAgent(),
        [{ role: 'user', content: 'ask a question' }],
        [{ name: 'com_ask', description: 'Ask user', parameters: { type: 'object' } }],
        executeTool,
        undefined,
        undefined,
        undefined,
        6
      )
    ).rejects.toThrow('Automatic retries are capped at 1');

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(3);
  });

  it('stops repeated failing tool calls after one automatic retry in responses mode', async () => {
    const service = createService({
      provider: 'openai-compatible',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-5',
    });

    let round = 0;
    const responsesCreate = vi.fn(async () => ({
      id: `resp_${round}`,
      output: [
        {
          type: 'function_call',
          id: `fc_${round}`,
          call_id: `fc_${round}`,
          name: 'com_ask',
          arguments: '{"kind":"select","message":"Pick one","choices":[]}',
        },
      ],
    }));

    (service as unknown as { client: unknown }).client = {
      responses: {
        create: responsesCreate,
      },
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };

    const executeTool = vi.fn(async ({ toolCallId }: { toolCallId: string }) => {
      round += 1;
      return {
        toolCallId,
        toolName: 'com_ask',
        result: 'Invalid parameters for com_ask',
        isError: true,
      };
    });

    await expect(
      service.chatWithTools(
        createAgent(),
        [{ role: 'user', content: 'ask a question' }],
        [{ name: 'com_ask', description: 'Ask user', parameters: { type: 'object' } }],
        executeTool,
        undefined,
        undefined,
        undefined,
        6
      )
    ).rejects.toThrow('Automatic retries are capped at 1');

    expect(executeTool).toHaveBeenCalledTimes(2);
    expect(responsesCreate).toHaveBeenCalledTimes(3);
  });

  it('resets the retry counter for the same tool+args after a successful execution', async () => {
    const service = createService({
      provider: 'github-copilot',
      model: 'gpt-4.1',
    });

    let round = 0;
    const argsJson = '{"kind":"select","message":"Pick one","choices":[]}';
    const create = vi.fn(async () => createToolStreamWithArguments(round++, argsJson));

    (service as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create,
        },
      },
    };

    let callCount = 0;
    const executeTool = vi.fn(async ({ toolCallId }: { toolCallId: string }) => {
      callCount += 1;
      const fail = callCount === 1 || callCount >= 3;
      return {
        toolCallId,
        toolName: 'com_ask',
        result: fail ? 'Invalid parameters for com_ask' : { ok: true },
        isError: fail,
      };
    });

    await expect(
      service.chatWithTools(
        createAgent(),
        [{ role: 'user', content: 'ask a question' }],
        [{ name: 'com_ask', description: 'Ask user', parameters: { type: 'object' } }],
        executeTool,
        undefined,
        undefined,
        undefined,
        8
      )
    ).rejects.toThrow('Automatic retries are capped at 1');

    expect(executeTool).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledTimes(5);
  });

  it('tracks retry cap independently per argument payload', async () => {
    const service = createService({
      provider: 'github-copilot',
      model: 'gpt-4.1',
    });

    const argsA = '{"kind":"select","message":"Pick one","choices":[]}';
    const argsB = '{"kind":"select","message":"Pick two","choices":[]}';
    let round = 0;
    const create = vi.fn(async () => {
      if (round === 0) {
        round += 1;
        return createToolStreamWithArguments(0, argsA);
      }
      if (round === 1) {
        round += 1;
        return createToolStreamWithArguments(1, argsA);
      }
      if (round === 2) {
        round += 1;
        return createToolStreamWithArguments(2, argsB);
      }
      return createAssistantTextStream('done');
    });

    (service as unknown as { client: unknown }).client = {
      chat: {
        completions: {
          create,
        },
      },
    };

    const executeTool = vi.fn(async ({ toolCallId }: { toolCallId: string }) => ({
      toolCallId,
      toolName: 'com_ask',
      result: 'Invalid parameters for com_ask',
      isError: true,
    }));

    await expect(
      service.chatWithTools(
        createAgent(),
        [{ role: 'user', content: 'ask a question' }],
        [{ name: 'com_ask', description: 'Ask user', parameters: { type: 'object' } }],
        executeTool,
        undefined,
        undefined,
        undefined,
        8
      )
    ).resolves.toEqual({
      text: 'done',
      toolResults: [
        {
          toolCallId: 'call_0',
          toolName: 'com_ask',
          result: 'Invalid parameters for com_ask',
          isError: true,
        },
        {
          toolCallId: 'call_1',
          toolName: 'com_ask',
          result: 'Invalid parameters for com_ask',
          isError: true,
        },
        {
          toolCallId: 'call_2',
          toolName: 'com_ask',
          result: 'Invalid parameters for com_ask',
          isError: true,
        },
      ],
    });

    expect(executeTool).toHaveBeenCalledTimes(3);
    expect(create).toHaveBeenCalledTimes(4);
  });
});
