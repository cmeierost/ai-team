import { beforeEach, describe, expect, it, vi } from 'vitest';

const infraMocks = vi.hoisted(() => ({
  loadEffectiveConfig: vi.fn(),
  loadEnvFile: vi.fn(),
  loadSkill: vi.fn(),
  resolveEffectiveLlmSettings: vi.fn(),
  testLlmConnection: vi.fn(),
  parseTextToolCalls: vi.fn(),
  AgentManager: class {
    resolveAgentAsync = vi.fn();
    getAllAgentsAsync = vi.fn();
  },
}));

vi.mock('@ai-team/infrastructure', () => ({
  AgentManager: infraMocks.AgentManager,
  loadEnvFile: infraMocks.loadEnvFile,
  loadSkill: infraMocks.loadSkill,
  loadEffectiveConfig: infraMocks.loadEffectiveConfig,
  resolveEffectiveLlmSettings: infraMocks.resolveEffectiveLlmSettings,
  testLlmConnection: infraMocks.testLlmConnection,
  parseTextToolCalls: infraMocks.parseTextToolCalls,
}));

import { testConnectionCommand } from './test-connection.js';

describe('commands/test-connection --tool-call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);

    infraMocks.loadEffectiveConfig.mockResolvedValue({ providers: {} });
    infraMocks.loadEnvFile.mockResolvedValue({});
    infraMocks.loadSkill.mockResolvedValue(undefined);
    infraMocks.resolveEffectiveLlmSettings.mockReturnValue({
      config: {
        provider: 'openai-compatible',
        baseUrl: 'http://localhost:11434/v1',
        model: 'qwen2.5-coder:7b',
      },
      providerRef: 'ollama-local',
      apiKeyEnvVar: undefined,
    });
    infraMocks.testLlmConnection.mockResolvedValue(undefined);
    infraMocks.parseTextToolCalls.mockReturnValue([]);
  });

  it('uses resolved provider-specific API key env var', async () => {
    infraMocks.loadEnvFile.mockResolvedValue({
      LLM_HUB_API_KEY: 'hub-secret',
    });
    infraMocks.resolveEffectiveLlmSettings.mockReturnValue({
      config: {
        provider: 'openai-compatible',
        baseUrl: 'https://llmhub.example.com/v1',
        model: 'gpt-4o-mini',
      },
      providerRef: 'llm-hub',
      apiKeyEnvVar: 'LLM_HUB_API_KEY',
    });

    await expect(testConnectionCommand('C:/workspace')).resolves.toBeUndefined();

    expect(infraMocks.testLlmConnection).toHaveBeenCalledWith(
      {
        provider: 'openai-compatible',
        baseUrl: 'https://llmhub.example.com/v1',
        model: 'gpt-4o-mini',
      },
      'hub-secret'
    );
  });

  it('rejects --all with --tool-call', async () => {
    await expect(
      testConnectionCommand('C:/workspace', { all: true, toolCall: true })
    ).rejects.toThrow('Do not combine --all with --tool-call.');
  });

  it('passes when provider returns structured tool_calls', async () => {
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

    await expect(
      testConnectionCommand('C:/workspace', { toolCall: true })
    ).resolves.toBeUndefined();

    expect(infraMocks.testLlmConnection).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('passes when provider encodes tool call in JSON text content', async () => {
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

    infraMocks.parseTextToolCalls.mockReturnValue([
      {
        toolCallId: 'tc-1',
        toolName: '__ait_ping_tool',
        args: { text: 'ok' },
      },
    ]);

    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    await expect(
      testConnectionCommand('C:/workspace', { toolCall: true })
    ).resolves.toBeUndefined();

    expect(infraMocks.parseTextToolCalls).toHaveBeenCalledWith(
      '{"name":"__ait_ping_tool","arguments":{"text":"ok"}}',
      expect.any(Set)
    );
  });

  it('fails when no recognizable tool call is emitted', async () => {
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

    await expect(testConnectionCommand('C:/workspace', { toolCall: true })).rejects.toThrow(
      'Tool-call probe did not find a recognizable tool call'
    );
  });
});
