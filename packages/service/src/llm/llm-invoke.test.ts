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
  it('lists the canonical names from the provider tool definitions, not command implementation names', async () => {
    const capturedMessages: any[] = [];
    const llmService = {
      chatWithTools: vi.fn(async (...args: unknown[]) => {
        capturedMessages.push(args[1]);
        return { text: '' };
      }),
      streamChat: vi.fn(),
    };

    const service = createService(llmService, new EmitService(() => {}));
    await service.invokeAsync({
      messages: [{ role: 'user', content: 'Find the prompt builder.' } as any],
      tools: [makeTool('grep'), makeTool('handoff')],
      toolDefs: [
        { name: 'search_grep', description: 'Search workspace text', parameters: { type: 'object' } },
        { name: 'com_handoff', description: 'Hand off to another agent', parameters: { type: 'object' } },
      ],
      skills: [],
      teamRoster: [makeAgent('michael-brown', 'Michael Brown')],
      ctx: { agent: makeAgent('michael-brown', 'Michael Brown'), workspaceRoot: '/workspace', history: [] } as any,
    });

    const policy = String(capturedMessages[0]?.[0]?.content);
    expect(policy).toContain('search_grep, com_handoff');
    expect(policy).not.toContain('callable tool names for this turn are: grep, handoff');
    expect(policy).toContain('com_handoff is available for this turn');
    expect(policy).not.toContain('fs_tree on path');
  });

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

  it('limits session_return to an explicit developer signal', async () => {
    const capturedMessages: any[] = [];
    const llmService = {
      chatWithTools: vi.fn(async (...args: unknown[]) => {
        capturedMessages.push(args[1]);
        return { text: '' };
      }),
      streamChat: vi.fn(),
    };

    const service = createService(llmService, new EmitService(() => {}));
    await service.invokeAsync({
      messages: [{ role: 'user', content: 'That covers it. Please return to Emily.' } as any],
      tools: [makeTool('session_return')],
      toolDefs: [
        {
          name: 'session_return',
          description: 'Return to the parent workflow',
          parameters: { type: 'object', properties: {} },
        },
      ],
      skills: [],
      teamRoster: [makeAgent('sarah-lee', 'Sarah Lee')],
      ctx: {
        agent: makeAgent('sarah-lee', 'Sarah Lee'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
    });

    const policy = String(capturedMessages[0]?.[0]?.content);
    expect(policy).toContain(
      'Call it only when the developer clearly asks to return or report back'
    );
    expect(policy).toContain('Do not call it merely because you answered the current question');
    expect(policy).toContain('Do not use com_handoff as a substitute for session_return');
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

  it('collects provider identity, token usage, and invocation timing', async () => {
    const llmService = {
      getInvocationIdentity: () => ({ model: 'gpt-test', provider: 'openai' }),
      streamChat: vi.fn(async function* () {
        yield { choices: [{ delta: { content: 'Hello' } }], model: 'gpt-test' };
        yield {
          choices: [],
          usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
        };
      }),
      chatWithTools: vi.fn(),
    };

    const service = createService(llmService, new EmitService(() => {}));
    const result = await service.invokeAsync({
      messages: [{ role: 'user', content: 'Hello' } as any],
      tools: [],
      toolDefs: [],
      skills: [],
      teamRoster: [],
      ctx: {
        agent: makeAgent('michael-brown', 'Michael Brown'),
        workspaceRoot: '/workspace',
        history: [],
      } as any,
    });

    expect(result.metrics).toMatchObject({
      model: 'gpt-test',
      provider: 'openai',
      promptTokens: 12,
      completionTokens: 3,
      totalTokens: 15,
    });
    expect(result.metrics.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.metrics.timeToFirstTokenMs).toBeGreaterThanOrEqual(0);
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
