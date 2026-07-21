import { describe, expect, it, vi } from 'vitest';
import type { Agent, ICommand } from '@ai-team/core';
import { EmitService } from '../interaction/emit-service.js';
import { LlmInvokeService } from './llm-invoke.js';

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

function createService(llmService: unknown, emitService: EmitService): LlmInvokeService {
  return new LlmInvokeService(llmService as any, emitService as any, { dispatch: vi.fn() } as any);
}

describe('LlmInvokeService', () => {
  it('injects mandatory com_handoff guidance when handoff tool is available', async () => {
    const capturedMessages: any[] = [];
    const llmService = {
      chatWithTools: vi.fn(async (...args: unknown[]) => {
        capturedMessages.push(args[1]);
        return { text: '' };
      }),
      streamChat: vi.fn(),
    };

    const emitService = new EmitService(() => {});
    const service = createService(llmService, emitService);
    await service.invokeAsync({
      messages: [{ role: 'user', content: 'Please route me to Emily.' } as any],
      tools: [makeTool('com_handoff')],
      toolDefs: [
        {
          name: 'com_handoff',
          description: 'Handoff to another agent',
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
    });

    const policy = capturedMessages[0]?.[0];
    expect(policy?.role).toBe('system');
    expect(String(policy?.content)).toContain('must call com_handoff in this turn');
    expect(String(policy?.content)).toContain('Do not tell the developer to run /agent');
    expect(String(policy?.content)).toContain(
      'call com_handoff directly and do not gate it behind a confirm-style com_ask question'
    );
  });

  it('does not inject handoff mandate when com_handoff tool is unavailable', async () => {
    const capturedMessages: any[] = [];
    const llmService = {
      chatWithTools: vi.fn(async (...args: unknown[]) => {
        capturedMessages.push(args[1]);
        return { text: '' };
      }),
      streamChat: vi.fn(),
    };

    const emitService = new EmitService(() => {});
    const service = createService(llmService, emitService);
    await service.invokeAsync({
      messages: [{ role: 'user', content: 'Please route me to Emily.' } as any],
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
    });

    const policy = capturedMessages[0]?.[0];
    expect(String(policy?.content)).not.toContain('must call com_handoff in this turn');
  });

  it('emits fallback token text when tool loop returns final text without streamed deltas', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && typeof event.text === 'string') {
        emittedTokens.push(event.text);
      }
    });

    const chatWithTools = vi.fn(async () => ({ text: 'Final answer from model.' }));

    const llmService = {
      chatWithTools,
      streamChat: vi.fn(),
    };

    const service = createService(llmService, emitService);
    const result = await service.invokeAsync({
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
    });

    expect(result.fullResponse).toBe('Final answer from model.');
    expect(emittedTokens.join('')).toBe('Final answer from model.');
  });

  it('does not duplicate text when deltas are already streamed through onToken', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && typeof event.text === 'string') {
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

    const service = createService(llmService, emitService);
    const result = await service.invokeAsync({
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
    });

    expect(result.fullResponse).toBe('Hello world');
    expect(emittedTokens.join('')).toBe('Hello world');
  });

  it('emits thought tokens with prefix while keeping fullResponse content-only', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && typeof event.text === 'string') {
        emittedTokens.push(event.text);
      }
    });

    const llmService = {
      streamChat: vi.fn(async function* () {
        yield {
          choices: [
            {
              delta: {
                reasoning_content: 'Planning best response',
              },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: {
                content: 'Here is the answer.',
              },
            },
          ],
        };
      }),
      chatWithTools: vi.fn(),
    };

    const service = createService(llmService, emitService);
    const result = await service.invokeAsync({
      messages: [{ role: 'user', content: 'Hello' } as any],
      tools: [],
      toolDefs: [],
      skills: [],
      teamRoster: [makeAgent('michael-brown', 'Michael Brown')],
      ctx: {
        agent: makeAgent('michael-brown', 'Michael Brown'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
    });

    expect(result.fullResponse).toBe('Here is the answer.');
    expect(emittedTokens.join('')).toContain('💭 Planning best response');
    expect(emittedTokens.join('')).toContain('Here is the answer.');
  });

  it('passes transcript-style speaker-label lines through unchanged', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && typeof event.text === 'string') {
        emittedTokens.push(event.text);
      }
    });

    const llmService = {
      streamChat: vi.fn(async function* () {
        yield {
          choices: [
            {
              delta: {
                content: 'Clemens Meier -> Sarah Lee: Retrying — let me push it through cleanly.\n',
              },
            },
          ],
        };
      }),
      chatWithTools: vi.fn(),
    };

    const service = createService(llmService, emitService);
    const result = await service.invokeAsync({
      messages: [{ role: 'user', content: 'Hello' } as any],
      tools: [],
      toolDefs: [],
      skills: [],
      teamRoster: [makeAgent('sarah-lee', 'Sarah Lee')],
      ctx: {
        agent: makeAgent('sarah-lee', 'Sarah Lee'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
    });

    expect(result.fullResponse).toBe(
      'Clemens Meier -> Sarah Lee: Retrying — let me push it through cleanly.\n'
    );
    expect(emittedTokens.join('')).toBe(
      'Clemens Meier -> Sarah Lee: Retrying — let me push it through cleanly.\n'
    );
  });

  it('keeps non-transcript content unchanged', async () => {
    const emittedTokens: string[] = [];
    const emitService = new EmitService((event) => {
      if (event.kind === 'token' && typeof event.text === 'string') {
        emittedTokens.push(event.text);
      }
    });

    const llmService = {
      streamChat: vi.fn(async function* () {
        yield {
          choices: [
            {
              delta: {
                content: 'Normal response line.\n',
              },
            },
          ],
        };
      }),
      chatWithTools: vi.fn(),
    };

    const service = createService(llmService, emitService);
    const result = await service.invokeAsync({
      messages: [{ role: 'user', content: 'Hello' } as any],
      tools: [],
      toolDefs: [],
      skills: [],
      teamRoster: [makeAgent('sarah-lee', 'Sarah Lee')],
      ctx: {
        agent: makeAgent('sarah-lee', 'Sarah Lee'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
    });

    expect(result.fullResponse).toBe('Normal response line.\n');
    expect(emittedTokens.join('')).toBe('Normal response line.\n');
  });
});
