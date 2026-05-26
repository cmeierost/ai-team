import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TestConnectionCommand } from './test-connection.js';

const mocks = {
  configurationStorage: {
    loadEffectiveConfigAsync: vi.fn(),
  },
  environmentStorage: {
    loadEnvFileAsync: vi.fn(),
  },
  agentManager: {
    resolveAgentAsync: vi.fn(),
    getAllAgentsAsync: vi.fn(),
  },
  llmProviderTester: {
    testLlmConnectionAsync: vi.fn(),
  },
  textToolCallParser: {
    parseTextToolCalls: vi.fn(),
  },
};

describe('commands/test-connection --tool-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mocks.configurationStorage.loadEffectiveConfigAsync.mockResolvedValue({
      providers: {
        'ollama-local': {
          kind: 'openai-compatible',
          baseUrl: 'http://localhost:11434/v1',
          defaultModel: 'qwen2.5-coder:7b',
        },
      },
      defaultModel: {
        provider: 'ollama-local',
        model: 'qwen2.5-coder:7b',
      },
    });
    mocks.environmentStorage.loadEnvFileAsync.mockResolvedValue({});
    mocks.llmProviderTester.testLlmConnectionAsync.mockResolvedValue(undefined);
    mocks.textToolCallParser.parseTextToolCalls.mockReturnValue([]);
    mocks.agentManager.resolveAgentAsync.mockResolvedValue([]);
    mocks.agentManager.getAllAgentsAsync.mockResolvedValue([]);
  });

  function createCommand() {
    return new TestConnectionCommand(
      mocks.configurationStorage as any,
      mocks.environmentStorage as any,
      mocks.agentManager as any,
      mocks.llmProviderTester as any,
      mocks.textToolCallParser as any
    );
  }

  it('uses resolved provider-specific API key env var', async () => {
    mocks.environmentStorage.loadEnvFileAsync.mockResolvedValue({
      LLM_HUB_API_KEY: 'hub-secret',
    });
    const command = createCommand();
    const effectiveConfig = {
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://llmhub.example.com/v1',
        model: 'gpt-4o-mini',
      },
      providerRef: 'llm-hub',
      apiKeyEnvVar: 'LLM_HUB_API_KEY',
    };
    mocks.configurationStorage.loadEffectiveConfigAsync.mockResolvedValue({
      providers: {
        'llm-hub': {
          kind: 'openai-compatible',
          baseUrl: 'https://llmhub.example.com/v1',
          defaultModel: 'gpt-4o-mini',
          apiKeyEnvVar: 'LLM_HUB_API_KEY',
        },
      },
      defaultModel: {
        providerRef: 'llm-hub',
        provider: 'llm-hub',
        model: 'gpt-4o-mini',
      },
    });

    await expect(command.executeAsync('C:/workspace')).resolves.toBeUndefined();

    expect(mocks.llmProviderTester.testLlmConnectionAsync).toHaveBeenCalledWith(
      effectiveConfig.config,
      'hub-secret'
    );
  });

  it('rejects --all with --tool-call', async () => {
    const command = createCommand();

    await expect(command.executeAsync('C:/workspace', { all: true, toolCall: true })).rejects.toThrow(
      'Do not combine --all with --tool-call.'
    );
  });

  it('passes when provider returns structured tool_calls', async () => {
    const command = createCommand();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  function: { name: '__ait_ping_tool' },
                },
              ],
            },
          },
        ],
      }),
      text: async () => '',
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(command.executeAsync('C:/workspace', { toolCall: true })).resolves.toBeUndefined();

    expect(mocks.llmProviderTester.testLlmConnectionAsync).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('passes when provider encodes tool call in JSON text content', async () => {
    const command = createCommand();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: '{"name":"__ait_ping_tool","arguments":{"text":"ok"}}',
            },
          },
        ],
      }),
      text: async () => '',
    });

    mocks.textToolCallParser.parseTextToolCalls.mockReturnValue([
      {
        toolCallId: 'tc-1',
        toolName: '__ait_ping_tool',
        args: { text: 'ok' },
      },
    ]);

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(command.executeAsync('C:/workspace', { toolCall: true })).resolves.toBeUndefined();

    expect(mocks.textToolCallParser.parseTextToolCalls).toHaveBeenCalledWith(
      '{"name":"__ait_ping_tool","arguments":{"text":"ok"}}',
      expect.any(Set)
    );
  });

  it('fails when no recognizable tool call is emitted', async () => {
    const command = createCommand();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          {
            message: {
              content: 'I cannot call tools in this mode.',
            },
          },
        ],
      }),
      text: async () => '',
    });

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(command.executeAsync('C:/workspace', { toolCall: true })).rejects.toThrow(
      'Tool-call probe did not find a recognizable tool call'
    );
  });
});
