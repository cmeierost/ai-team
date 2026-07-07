import { describe, expect, it, vi } from 'vitest';
import type { Agent, ICommand } from '@ai-team/core';
import { EmitService } from './services/emit-service.js';
import { invokeLlm } from './llm-invoke.js';

function makeAgent(id: string, name = id): Agent {
  return { id, name, role: 'assistant', systemPrompt: '' } as unknown as Agent;
}

function makeTool(name: string): ICommand {
  const [group, ...rest] = name.split('_');
  return {
    metadata: {
      key: rest.join('_') || name,
      group,
      description: `${name} tool`,
      availableIn: { cli: false, chat: false, tool: true },
    },
    execute: vi.fn(),
    name,
  } as unknown as ICommand;
}

describe('invokeLlm', () => {
  it('emits fallback token text when tool loop returns final text without streamed deltas', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && event.text) {
        emittedTokens.push(event.text);
      }
    });

    const chatWithTools = vi.fn(async () => ({ text: 'Final answer from model.' }));

    const llmService = {
      chatWithTools,
      streamChat: vi.fn(),
    };

    const result = await invokeLlm({
      messages: [{ role: 'user', content: 'Hello' } as any],
      tools: [makeTool('fs_read')],
      toolDefs: [
        {
          name: 'fs_read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      ],
      skills: [],
      teamRoster: [makeAgent('michael-brown', 'Michael Brown')],
      ctx: {
        agent: makeAgent('michael-brown', 'Michael Brown'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
      emitService,
      llmService: llmService as any,
      toolDispatcher: { dispatch: vi.fn() } as any,
    });

    expect(result.fullResponse).toBe('Final answer from model.');
    expect(emittedTokens.join('')).toBe('Final answer from model.');
  });

  it('does not duplicate text when deltas are already streamed through onToken', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && event.text) {
        emittedTokens.push(event.text);
      }
    });

    const chatWithTools = vi.fn(async (...args: unknown[]) => {
      const onToken = args[8] as ((delta: string) => void) | undefined;
      onToken?.('Hello ');
      onToken?.('world');
      return { text: 'Hello world' };
    });

    const llmService = {
      chatWithTools,
      streamChat: vi.fn(),
    };

    const result = await invokeLlm({
      messages: [{ role: 'user', content: 'Hi' } as any],
      tools: [makeTool('fs_read')],
      toolDefs: [
        {
          name: 'fs_read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      ],
      skills: [],
      teamRoster: [makeAgent('michael-brown', 'Michael Brown')],
      ctx: {
        agent: makeAgent('michael-brown', 'Michael Brown'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
      emitService,
      llmService: llmService as any,
      toolDispatcher: { dispatch: vi.fn() } as any,
    });

    expect(result.fullResponse).toBe('Hello world');
    expect(emittedTokens.join('')).toBe('Hello world');
  });
});
