/**
 * send-turn.test.ts
 *
 * Tests for spec paths 1, 2 and 4 (text-directive handoffs) plus
 * parseHandoffDirective / stripHandoffDirective behavior.
 *
 * Spec reference: docs/implementation/handoff-system.md
 *   Path 1  — agent directive in LLM response (HANDOFF: line)
 *   Path 2  — agent stream contains FORWARD_TO: inline
 *   Path 4  — inline HANDOFF: directive from non-streaming response
 *
 * The regression that triggered this test: when an agent wrote
 *   HANDOFF: michael-brown | Clemens would like to talk with you directly.
 * the directive was stripped from the visible output (stripHandoffDirective) but
 * the TurnResult.handedOff flag was never set, so the orchestrator never acted
 * on the handoff. The fix adds parseHandoffDirective() and calls it in step 9
 * of send-turn.ts after fullResponse is known.
 */

import { describe, expect, it, vi } from 'vitest';
import { ChatCommand } from '../commands/chat/chat.command.js';
import { buildRetryableFailureMessage, sendTurn } from './send-turn.js';
import { buildDefaultHookPlugins } from './defaults/hook-plugins.js';
import { buildDefaultTurnResultParsers } from './defaults/turn-result-parsers.js';
import type { ResolvedPlugins } from './pipeline.js';
import type { Agent, ChatMessage, ExecutionContext } from '@ai-team/core';
import { EmitService } from './services/emit-service.js';
import type { SendTurnDeps } from './send-turn-steps.js';
import type { IQuestionService } from '../questions/question-service.js';
import { ToolDispatcher } from './tool-dispatch.js';
import { ToolDispatchSupportService } from './services/tool-dispatch-support-service.js';
import { ToolSerializationService } from './services/tool-serialization-service.js';

// ────────────────────────────────────────────────────────────────────────────
// parseHandoffDirective — unit tests covering every directive variant
// ────────────────────────────────────────────────────────────────────────────

describe('parseHandoffDirective', () => {
  // Spec path 1 & 4: HANDOFF: agentId | note
  it('parses HANDOFF: with note', () => {
    const result = ChatCommand.parseHandoffDirective(
      'HANDOFF: michael-brown | Clemens wants to chat.'
    );
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'Clemens wants to chat.' });
  });

  it('parses HANDOFF: without note', () => {
    const result = ChatCommand.parseHandoffDirective('HANDOFF: michael-brown');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: '' });
  });

  it('parses HANDOFF: with extra whitespace', () => {
    const result = ChatCommand.parseHandoffDirective('  HANDOFF:  michael-brown  |  some note  ');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'some note' });
  });

  it('parses HANDOFF: at end of multi-line agent response', () => {
    const text = `Sure, I'll connect you to Michael.\n\nHANDOFF: michael-brown | Clemens would like to talk with you.`;
    const result = ChatCommand.parseHandoffDirective(text);
    expect(result).toEqual({
      targetAgentId: 'michael-brown',
      note: 'Clemens would like to talk with you.',
    });
  });

  // Spec path 2: FORWARD_TO: variant
  it('parses FORWARD_TO: with note', () => {
    const result = ChatCommand.parseHandoffDirective(
      'FORWARD_TO: sarah-morgan | Please help Clemens with the UI.'
    );
    expect(result).toEqual({
      targetAgentId: 'sarah-morgan',
      note: 'Please help Clemens with the UI.',
    });
  });

  it('parses FORWARD_TO: without note', () => {
    const result = ChatCommand.parseHandoffDirective('FORWARD_TO: sarah-morgan');
    expect(result).toEqual({ targetAgentId: 'sarah-morgan', note: '' });
  });

  it('is case-insensitive (handoff: lowercase)', () => {
    const result = ChatCommand.parseHandoffDirective('handoff: michael-brown | note');
    expect(result).toEqual({ targetAgentId: 'michael-brown', note: 'note' });
  });

  it('returns null when no directive present', () => {
    expect(ChatCommand.parseHandoffDirective('Sure, I can help with that!')).toBeNull();
    expect(ChatCommand.parseHandoffDirective('')).toBeNull();
    expect(ChatCommand.parseHandoffDirective('HANDOFFNOTE: something')).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// stripHandoffDirective — must also strip FORWARD_TO:
// ────────────────────────────────────────────────────────────────────────────

describe('stripHandoffDirective', () => {
  it('removes HANDOFF: line, leaving the visible text', () => {
    const input = "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | note";
    expect(ChatCommand.stripHandoffDirective(input)).toBe(
      "Absolutely, I'll hand you over to Michael."
    );
  });

  it('removes FORWARD_TO: line', () => {
    const input = 'Let me connect you to Sarah.\n\nFORWARD_TO: sarah-morgan | note';
    expect(ChatCommand.stripHandoffDirective(input)).toBe('Let me connect you to Sarah.');
  });

  it('leaves text unchanged when no directive present', () => {
    const input = 'Hello, how can I help?';
    expect(ChatCommand.stripHandoffDirective(input)).toBe(input);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendTurn — integration tests for text-directive handoffs (paths 1, 2, 4)
//
// The regression that was broken: returning TurnResult without handedOff:true
// ────────────────────────────────────────────────────────────────────────────

function makeAgent(id: string, name: string): Agent {
  return { id, name, role: 'assistant', systemPrompt: '' } as unknown as Agent;
}

function makeCtx(llmResponse: string): {
  ctx: ExecutionContext;
  deps: SendTurnDeps;
  emit: ReturnType<typeof vi.fn>;
  appendMessage: ReturnType<typeof vi.fn>;
} {
  const appendMessage = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn();
  const emitService = new EmitService(emit);
  const agent = makeAgent('emily-davis', 'Emily Davis');
  const michael = makeAgent('michael-brown', 'Michael Brown');
  const sarah = makeAgent('sarah-morgan', 'Sarah Morgan');
  const knownAgents = [agent, michael, sarah];

  const sessionManager = {
    appendMessage,
    getSession: vi.fn().mockResolvedValue({ id: 'sess-emily-1', developerId: 'clemens' }),
  };
  const agentManager = {
    recordInteractionAsync: vi.fn().mockResolvedValue(undefined),
    getAllAgentsAsync: vi.fn(async () => knownAgents),
    getAgent: (id: string) => knownAgents.find((candidate) => candidate.id === id),
    getAgentAsync: vi.fn(
      async (id: string) => knownAgents.find((candidate) => candidate.id === id) ?? null
    ),
    resolveAgent: (query: string) => {
      const normalized = query.trim().toLowerCase();
      return knownAgents.filter(
        (candidate) =>
          candidate.id.toLowerCase() === normalized || candidate.name.toLowerCase() === normalized
      );
    },
    resolveAgentAsync: vi.fn(async (query: string) => {
      const normalized = query.trim().toLowerCase();
      return knownAgents.filter(
        (candidate) =>
          candidate.id.toLowerCase() === normalized || candidate.name.toLowerCase() === normalized
      );
    }),
  };
  const skillManager = {
    resolveSkillsForAgent: vi.fn(() => ({
      roleSkill: undefined,
      specializationSkills: [],
      skills: [],
      missingSkillNames: [],
    })),
  };
  const llmService = {
    streamChat: vi.fn(async function* (_agent: any, _msgs: any) {
      yield { choices: [{ delta: { content: llmResponse } }] } as any;
    }),
    chatWithTools: vi.fn(),
  };

  const ctx: ExecutionContext = {
    agent,
    workspaceRoot: '/workspace',
    sessionId: 'sess-emily-1',
    history: [],
  };

  const deps: SendTurnDeps = {
    sessionManager: sessionManager as any,
    llmService: llmService as any,
    skillManager: skillManager as any,
    agentManager: agentManager as any,
    hooks: {},
    emitService,
    toolDispatcher: undefined,
  };

  return { ctx, deps, emit, appendMessage, llmService, skillManager, agentManager };
}

function makePlugins(agentManager?: any): ResolvedPlugins {
  return {
    compressor: { compress: (_h: ChatMessage[]) => Promise.resolve(_h) } as any,
    contextBuilder: {
      build: (_h: ChatMessage[]) => Promise.resolve([{ role: 'user', content: 'hi' }]),
    } as any,
    enrichers: [],
    ragProvider: { retrieve: vi.fn().mockResolvedValue(null) } as any,
    toolResolver: { resolve: vi.fn().mockReturnValue([]) } as any,
    mcpGateway: { listTools: vi.fn().mockResolvedValue([]) } as any,
    llmSelector: { select: vi.fn().mockResolvedValue(undefined) } as any,
    outputHandler: {
      handle: async (_result: any, _ctx: any) => {},
    } as any,
    commandDispatcher: {
      dispatch: vi.fn(async () => ({ status: 'ok' as const, message: '' })),
      getCommands: vi.fn(() => []),
      getCommand: vi.fn(() => undefined),
    },
    hookPlugins: buildDefaultHookPlugins(),
    turnResultParsers: buildDefaultTurnResultParsers(agentManager),
  };
}

// Path 1 / 4 — HANDOFF: directive in text response
describe('sendTurn — spec path 1 / 4 (HANDOFF: text directive)', () => {
  it('sets handedOff:true and handoffTargetId when response contains HANDOFF: agentId | note', async () => {
    const llmResponse =
      "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | Clemens would like to talk with you directly.";
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins();
    plugins.turnResultParsers = buildDefaultTurnResultParsers(agentManager as any);

    const result = await sendTurn('can i talk to michael?', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('michael-brown');
    expect(result.handoffNote).toBe('Clemens would like to talk with you directly.');
  });

  it('sets handedOff:true when response contains HANDOFF: with no note', async () => {
    const llmResponse = 'Sure!\n\nHANDOFF: michael-brown';
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    const result = await sendTurn('can i talk to michael?', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('michael-brown');
    expect(result.handoffNote).toBeUndefined();
  });

  it('strips the HANDOFF: directive from the persisted message (developer never sees it)', async () => {
    const llmResponse =
      "Absolutely, I'll hand you over to Michael.\n\nHANDOFF: michael-brown | note";
    const { ctx, deps, appendMessage, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    await sendTurn('can i talk to michael?', plugins, ctx, undefined, deps);

    const persistedMsg: ChatMessage | undefined = appendMessage.mock.calls.at(-1)?.[1] as
      | ChatMessage
      | undefined;
    expect(persistedMsg).toBeDefined();
    if (!persistedMsg) {
      throw new Error('Expected persisted agent message to be defined.');
    }
    expect(persistedMsg.content).not.toContain('HANDOFF:');
    expect(persistedMsg.content).toContain("I'll hand you over to Michael");
  });
});

// Path 2 — FORWARD_TO: variant
describe('sendTurn — spec path 2 (FORWARD_TO: text directive)', () => {
  it('sets handedOff:true when response contains FORWARD_TO: agentId | note', async () => {
    const llmResponse =
      'Let me bring Sarah in.\n\nFORWARD_TO: sarah-morgan | Please help Clemens with the CSS design system.';
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    const result = await sendTurn('can sarah help?', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBe(true);
    expect(result.handoffTargetId).toBe('sarah-morgan');
    expect(result.handoffNote).toBe('Please help Clemens with the CSS design system.');
  });

  it('strips FORWARD_TO: from persisted message', async () => {
    const llmResponse = 'Let me bring Sarah in.\n\nFORWARD_TO: sarah-morgan | note';
    const { ctx, deps, appendMessage, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    await sendTurn('can sarah help?', plugins, ctx, undefined, deps);

    const persistedMsg = appendMessage.mock.calls.find(
      (call: unknown[]) => !(call[1] as ChatMessage | undefined)?.isHuman
    )?.[1] as ChatMessage | undefined;
    if (!persistedMsg) {
      throw new Error('Expected persisted agent message to be defined.');
    }
    expect(persistedMsg.content).not.toContain('FORWARD_TO:');
  });

  it('emits info events when role/specialization skills are loaded', async () => {
    const { ctx, deps, emit, skillManager, agentManager } = makeCtx('Hello there!');
    skillManager.resolveSkillsForAgent = vi.fn(() => ({
      roleSkill: { name: 'assistant' },
      specializationSkills: [{ name: 'frontend-web-delivery' }],
      skills: [{ name: 'assistant' }, { name: 'frontend-web-delivery' }],
      missingSkillNames: [],
    }));
    deps.skillManager = skillManager as any;

    const plugins = makePlugins(agentManager);

    await sendTurn('hello', plugins, ctx, undefined, deps);

    expect(
      emit.mock.calls.some((call: any[]) => {
        const event = call[0] as { kind?: string; level?: string; message?: string };
        return (
          event.kind === 'log' &&
          event.level === 'info' &&
          event.message?.includes('Loaded role skill: assistant')
        );
      })
    ).toBe(true);
    expect(
      emit.mock.calls.some((call: any[]) => {
        const event = call[0] as { kind?: string; level?: string; message?: string };
        return (
          event.kind === 'log' &&
          event.level === 'info' &&
          event.message?.includes('Loaded specialization skill: frontend-web-delivery')
        );
      })
    ).toBe(true);
  });

  it('supports one plugin hooking multiple lifecycle hooks', async () => {
    const { ctx, deps, appendMessage, agentManager } = makeCtx('Hello plugin world');
    const onTurnStart = vi.fn(async () => {});
    const onMessagesPrepared = vi.fn(async () => {});
    const onBeforePersistAssistantMessage = vi.fn(
      async (payload: { persistedContent: string }) =>
        `${payload.persistedContent} [filtered-by-plugin]`
    );
    const onTurnCompleted = vi.fn(async () => {});

    const plugins = {
      ...makePlugins(agentManager),
      hookPlugins: [
        {
          name: 'multi-hook-plugin',
          onTurnStart,
          onMessagesPrepared,
          onBeforePersistAssistantMessage,
          onTurnCompleted,
        },
      ],
    };

    const result = await sendTurn('hello', plugins, ctx, undefined, deps);

    expect(onTurnStart).toHaveBeenCalledOnce();
    expect(onMessagesPrepared).toHaveBeenCalledOnce();
    expect(onBeforePersistAssistantMessage).toHaveBeenCalledOnce();
    expect(onTurnCompleted).toHaveBeenCalledOnce();
    expect(result.text).toContain('[filtered-by-plugin]');

    const persistedMsg = appendMessage.mock.calls.find((call: unknown[]) => {
      const msg = call[1] as ChatMessage | undefined;
      return !!msg && !msg.isHuman && msg.to === 'human';
    })?.[1] as ChatMessage | undefined;

    expect(persistedMsg?.content).toContain('[filtered-by-plugin]');
  });
});

// No directive — must not handoff
describe('sendTurn — no directive (normal turn)', () => {
  it('does not set handedOff when response has no directive', async () => {
    const llmResponse = 'Hi Clemens! How can I help you today?';
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    const result = await sendTurn('hello', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBeFalsy();
    expect(result.handoffTargetId).toBeUndefined();
    expect(result.text).toBe(llmResponse);
  });

  it('ignores HANDOFF directive that targets current agent (self-handoff)', async () => {
    const llmResponse = 'I can help you with HR workflows.\n\nHANDOFF: emily-davis | staying here';
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    const result = await sendTurn('what can you do?', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBeFalsy();
    expect(result.handoffTargetId).toBeUndefined();
    expect(result.text).toContain('I can help you with HR workflows.');
  });

  it('ignores HANDOFF directive when target agent cannot be resolved', async () => {
    const llmResponse = 'Working on it.\n\nHANDOFF: hr-director | Please continue there';
    const { ctx, deps, agentManager } = makeCtx(llmResponse);
    const plugins = makePlugins(agentManager);

    const result = await sendTurn('what files can you read?', plugins, ctx, undefined, deps);

    expect(result.handedOff).toBeFalsy();
    expect(result.handoffTargetId).toBeUndefined();
    expect(result.text).toContain('Working on it.');
  });
});

describe('sendTurn — llm failure fallback', () => {
  it('returns a retryable timeout message and persists it as archived when LLM invocation fails', async () => {
    const { ctx, deps, appendMessage, llmService, agentManager } = makeCtx('unused');
    llmService.streamChat = vi.fn(async () => {
      throw new Error('LLM request timed out after 30s.');
    });
    deps.llmService = llmService as any;

    const outputHandle = vi.fn(async () => {});
    const plugins = {
      ...makePlugins(agentManager),
      outputHandler: { handle: outputHandle } as any,
    };

    const result = await sendTurn('hello', plugins, ctx, undefined, deps);

    expect(result.done).toBe(true);
    expect(result.text).toBe("Sorry — I couldn't complete that request in time. Please try again.");
    expect(outputHandle).toHaveBeenCalledOnce();

    const persistedAgentMsg = appendMessage.mock.calls.find((call: unknown[]) => {
      const msg = call[1] as ChatMessage | undefined;
      return !!msg && !msg.isHuman && msg.to === 'human';
    })?.[1] as ChatMessage | undefined;

    expect(persistedAgentMsg?.content).toBe(
      "Sorry — I couldn't complete that request in time. Please try again."
    );
    expect(persistedAgentMsg?.archived).toBe(true);
  });
});

describe('buildRetryableFailureMessage', () => {
  it('uses timeout-specific guidance for timeout errors', () => {
    expect(buildRetryableFailureMessage('LLM request timed out after 30s.')).toContain(
      "couldn't complete that request in time"
    );
  });

  it('uses generic retry guidance for non-timeout errors', () => {
    expect(buildRetryableFailureMessage('connection reset')).toContain('temporary issue');
  });
});

// ────────────────────────────────────────────────────────────────────────────
// sendTurn — spec path 3 (tool-calling path)
//
// Proves that when tools are registered:
//   1. chatWithTools is invoked instead of streamChat
//   2. the executeTool callback threads each call through dispatchToolCall
//      → toolManager.execute → real tool result returned to the LLM
//   3. fs_read (silent) runs without confirmation
//   4. fs_apply_patch (write) requires and receives user confirmation
//   5. TurnResult.text holds the LLM's final response
// ────────────────────────────────────────────────────────────────────────────

const FILE_CONTENT = `export function greet(): string {\n  return "Hello World";\n}\n`;
const FILE_CONTENT_FIXED = `export function greet(): string {\n  return "Hello Clemens";\n}\n`;

type ChatWithToolsFn = (
  _agent: any,
  _msgs: any,
  _tools: any,
  executeTool: (tc: { toolCallId: string; toolName: string; args: unknown }) => Promise<any>,
  ...rest: any[]
) => Promise<{ text: string }>;

function makeCtxWithTools(chatWithToolsMock: ReturnType<typeof vi.fn>): {
  ctx: ExecutionContext;
  deps: SendTurnDeps;
  emit: ReturnType<typeof vi.fn>;
  questionService: { confirm: ReturnType<typeof vi.fn> };
  executeToolMock: ReturnType<typeof vi.fn>;
  llmService: {
    chatWithTools: ReturnType<typeof vi.fn>;
    streamChat: ReturnType<typeof vi.fn>;
  };
  toolManager: {
    toSchema: ReturnType<typeof vi.fn>;
  };
  appendMessage: ReturnType<typeof vi.fn>;
} {
  const workspaceRoot = '/workspace';
  const appendMessage = vi.fn().mockResolvedValue(undefined);
  const emit = vi.fn();
  const emitService = new EmitService(emit);
  const agent = makeAgent('victor-alvarez', 'Victor Alvarez');

  const executeToolMock = vi
    .fn()
    .mockImplementation(async (_agent: any, toolName: string, _args: any) => {
      if (toolName === 'fs_read') {
        return {
          ok: true,
          toolName,
          result: {
            content: FILE_CONTENT,
            path: { relative: 'src/greet.ts', absolute: '/workspace/src/greet.ts' },
          },
        };
      }
      if (toolName === 'fs_apply_patch') {
        return {
          ok: true,
          toolName,
          result: {
            status: 'pending_approval',
            proposalId: 'p-001',
            description: 'Fix greeting',
            filesChanged: 1,
            additions: 1,
            deletions: 1,
          },
        };
      }
      return { ok: false, toolName, error: `Unexpected tool in test: ${toolName}` };
    });

  const toolManager = {
    getToolsForAgent: vi.fn().mockReturnValue([]),
    toSchema: vi.fn().mockImplementation((name: string) => ({
      name,
      description: `${name} description`,
      parameters: { type: 'object', properties: {} },
    })),
    execute: executeToolMock,
    get: vi.fn().mockReturnValue(undefined),
  };
  const sessionManager = {
    appendMessage,
    getSession: vi.fn().mockResolvedValue({ id: 'sess-victor-1', developerId: 'clemens' }),
  };
  const agentManager = {
    recordInteractionAsync: vi.fn().mockResolvedValue(undefined),
    getAllAgentsAsync: vi.fn(async () => [agent]),
  };
  const skillManager = {
    resolveSkillsForAgent: vi.fn(() => ({
      roleSkill: undefined,
      specializationSkills: [],
      skills: [],
      missingSkillNames: [],
    })),
  };
  const llmService = {
    chatWithTools: chatWithToolsMock,
    streamChat: vi.fn(), // must NOT be called when tools are in play
  };
  const questionService: IQuestionService = {
    input: vi.fn(async () => ''),
    confirm: vi.fn(async () => true), // auto-approve write tools
    select: vi.fn(async () => ''),
    password: vi.fn(async () => ''),
    checklist: vi.fn(async () => []),
  };

  const ctx: ExecutionContext = {
    agent,
    workspaceRoot,
    sessionId: 'sess-victor-1',
    history: [],
  };

  const support = new ToolDispatchSupportService(
    workspaceRoot,
    new ToolSerializationService(),
    llmService as any,
    {
      create: () => ({ save: vi.fn() }),
    } as any
  );

  const toolDispatcher = new ToolDispatcher(
    toolManager as any,
    sessionManager as any,
    support,
    questionService,
    emitService
  );

  const deps: SendTurnDeps = {
    sessionManager: sessionManager as any,
    llmService: llmService as any,
    skillManager: skillManager as any,
    agentManager: agentManager as any,
    hooks: {},
    emitService,
    toolDispatcher,
  };

  return {
    ctx,
    deps,
    emit,
    questionService: questionService as any,
    executeToolMock,
    llmService,
    toolManager: { toSchema: toolManager.toSchema },
    appendMessage,
  };
}

function makePluginsWithTools(): ResolvedPlugins {
  const fakeTool = (canonicalName: string) => {
    const [group, ...rest] = canonicalName.split('_');
    const key = rest.join('_');
    return {
      metadata: {
        key,
        group,
        availableIn: { tool: true },
        description: `${canonicalName} tool`,
      },
      execute: vi.fn().mockResolvedValue({ status: 'ok', message: '' }),
    };
  };

  return {
    compressor: { compress: (h: ChatMessage[]) => Promise.resolve(h) } as any,
    contextBuilder: { build: () => Promise.resolve([{ role: 'user', content: 'hi' }]) } as any,
    enrichers: [],
    ragProvider: { retrieve: vi.fn().mockResolvedValue(null) } as any,
    toolResolver: {
      resolve: vi.fn().mockResolvedValue([fakeTool('fs_read'), fakeTool('fs_apply_patch')]),
    } as any,
    mcpGateway: {} as any, // no discover → defensive wrapper returns []
    llmSelector: { select: vi.fn().mockResolvedValue(undefined) } as any,
    outputHandler: { handle: async () => {} } as any,
    commandDispatcher: {
      dispatch: vi.fn(async () => ({ status: 'ok' as const, message: '' })),
      getCommands: vi.fn(() => []),
      getCommand: vi.fn(() => undefined),
    },
    hookPlugins: buildDefaultHookPlugins(),
    turnResultParsers: [],
  };
}

describe('sendTurn — spec path 3 (tool-calling path)', () => {
  it('uses chatWithTools (not streamChat) when tools are registered', async () => {
    const chatWithToolsMock = vi.fn<ChatWithToolsFn>(async () => ({
      text: 'All done via tools.',
    }));
    const { ctx, deps, llmService } = makeCtxWithTools(chatWithToolsMock);

    await sendTurn('do something with tools', makePluginsWithTools(), ctx, undefined, deps);

    expect(chatWithToolsMock).toHaveBeenCalledOnce();
    expect(llmService.streamChat).not.toHaveBeenCalled();
  });

  it('reads a file then proposes a line change: proves the full tool-calling path', async () => {
    // Scenario: Victor reads src/greet.ts (fs_read), finds "Hello World" on line 2,
    // then proposes changing it to "Hello Clemens" (fs_apply_patch).
    const FINAL_RESPONSE =
      'Done! I changed "Hello World" to "Hello Clemens" on line 2 of src/greet.ts.';

    const chatWithToolsMock = vi.fn<ChatWithToolsFn>(async (_a, _m, _t, executeTool) => {
      // Round 1: LLM reads the file to inspect current content
      await executeTool({
        toolCallId: 'tc-read',
        toolName: 'fs_read',
        args: { filePath: 'src/greet.ts' },
      });

      // Round 2: LLM proposes the fix after seeing the file content
      await executeTool({
        toolCallId: 'tc-patch',
        toolName: 'fs_apply_patch',
        args: {
          description: 'Fix greeting from "Hello World" to "Hello Clemens"',
          changes: [
            { filePath: 'src/greet.ts', oldContent: FILE_CONTENT, newContent: FILE_CONTENT_FIXED },
          ],
        },
      });

      return { text: FINAL_RESPONSE };
    });

    const { ctx, deps, questionService, executeToolMock, appendMessage } =
      makeCtxWithTools(chatWithToolsMock);

    const result = await sendTurn(
      'fix greet.ts to say Hello Clemens',
      makePluginsWithTools(),
      ctx,
      undefined,
      deps
    );

    // ── Tool execution ──────────────────────────────────────────────────────
    expect(executeToolMock).toHaveBeenCalledTimes(2);

    // fs_read — called first, no confirmation needed (silent tool)
    expect(executeToolMock).toHaveBeenNthCalledWith(
      1,
      ctx.agent,
      'fs_read',
      { filePath: 'src/greet.ts' },
      expect.objectContaining({ workspaceRoot: '/workspace' }),
      expect.any(Object)
    );

    // fs_apply_patch — called second with old/new file contents
    expect(executeToolMock).toHaveBeenNthCalledWith(
      2,
      ctx.agent,
      'fs_apply_patch',
      expect.objectContaining({
        description: 'Fix greeting from "Hello World" to "Hello Clemens"',
        changes: expect.arrayContaining([
          expect.objectContaining({
            filePath: 'src/greet.ts',
            oldContent: FILE_CONTENT,
            newContent: FILE_CONTENT_FIXED,
          }),
        ]),
      }),
      expect.objectContaining({ workspaceRoot: '/workspace' }),
      expect.any(Object)
    );

    // ── Approval ────────────────────────────────────────────────────────────
    // fs_apply_patch is a write tool → must ask for user confirmation
    // fs_read is silent → no confirmation prompt
    expect(questionService.confirm).toHaveBeenCalledOnce();

    // ── Final result ────────────────────────────────────────────────────────
    expect(result.text).toBe(FINAL_RESPONSE);
    expect(result.handedOff).toBeFalsy();

    // Agent reply persisted with the final LLM text (no directives to strip)
    const agentMsg = appendMessage.mock.calls.find((call: unknown[]) => {
      const msg = call[1] as ChatMessage | undefined;
      return !!msg && !msg.isHuman && msg.to === 'human';
    })?.[1] as ChatMessage | undefined;
    expect(agentMsg).toBeDefined();
    if (!agentMsg) {
      throw new Error('Expected persisted agent reply message to be defined.');
    }
    expect(agentMsg.content).toBe(FINAL_RESPONSE);
  });

  it('does not rely on ExecutionContext tool manager schema plumbing', async () => {
    const chatWithToolsMock = vi.fn<ChatWithToolsFn>(async () => ({
      text: 'Done.',
    }));
    const { ctx, deps, toolManager } = makeCtxWithTools(chatWithToolsMock);

    await sendTurn('first turn', makePluginsWithTools(), ctx, undefined, deps);
    await sendTurn('second turn', makePluginsWithTools(), ctx, undefined, deps);

    const toSchema = toolManager.toSchema;
    expect(toSchema).not.toHaveBeenCalled();
  });
});
