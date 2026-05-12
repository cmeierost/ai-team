import path from 'node:path';
import { inspect } from 'node:util';
import type {
  Agent,
  AgentSkillFile,
  ICommand,
  ChatMessage,
  ILlmChatMessageParam,
  Skill,
  StructuredToolResult,
  ExecutionContext,
} from '@ai-team/core';
import type { ChatRuntimeHooks } from '../commands/chat/index.js';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import { toolKey } from '../tools/tool-manager.js';
import type {
  BeforePersistAssistantMessageHookPayload,
  IOrchestratorHookPlugin,
  ResolvedPlugins,
  TurnResult,
} from './pipeline.js';
import { invokeLlm } from './llm-invoke.js';
import { emitLog, emitStatus } from './stream-events.js';
import type { SendTurnOptions } from './send-turn.js';

const TOOL_SCHEMA_CACHE = new WeakMap<object, Map<string, LlmToolDefinition>>();

function zodSchemaToJsonSchema(schema: unknown): Record<string, unknown> {
  if (
    schema &&
    typeof schema === 'object' &&
    typeof (schema as { toJSONSchema?: unknown }).toJSONSchema === 'function'
  ) {
    return (schema as { toJSONSchema: () => Record<string, unknown> }).toJSONSchema();
  }
  return { type: 'object', properties: {}, additionalProperties: true };
}

function getCachedToolSchema(ctx: ExecutionContext, tool: ICommand): LlmToolDefinition {
  const toolName = toolKey(tool);
  const managerKey = (ctx as any).toolManager as unknown as object;
  const cacheForManager = TOOL_SCHEMA_CACHE.get(managerKey) ?? new Map<string, LlmToolDefinition>();

  if (!TOOL_SCHEMA_CACHE.has(managerKey)) {
    TOOL_SCHEMA_CACHE.set(managerKey, cacheForManager);
  }

  const cached = cacheForManager.get(toolName);
  if (cached) {
    return cached;
  }

  const schema = (ctx as any).toolManager.toSchema(toolName) ?? {
    name: toolName,
    description: tool.description,
    parameters: zodSchemaToJsonSchema(tool.parameters),
  };

  cacheForManager.set(toolName, schema);
  return schema;
}

function buildToolDefinitions(ctx: ExecutionContext, tools: ICommand[]): LlmToolDefinition[] {
  const defs: LlmToolDefinition[] = [];
  for (const tool of tools) {
    defs.push(getCachedToolSchema(ctx, tool));
  }
  return defs;
}

export interface SendTurnResolvedSkillsAndTools {
  skills: Skill[];
  teamRoster: Agent[];
  allTools: ICommand[];
  toolDefs: LlmToolDefinition[];
}

export interface SendTurnLlmInvocationResult {
  fullResponse: string;
  structuredResults: StructuredToolResult[];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'string') {
    return error;
  }

  try {
    const serialized = JSON.stringify(error);
    if (serialized) {
      return serialized;
    }
  } catch {
    // no-op; fall through to inspect
  }

  return inspect(error, { depth: 1, breakLength: Infinity });
}

export async function ensureTurnStartAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options?: SendTurnOptions
): Promise<void> {
  if ((ctx as any).hooks?.signal?.aborted) {
    throw new DOMException('Chat request aborted by user.', 'AbortError');
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onTurnStart',
    {
      userMessage,
      options: options ? { skipPersist: options.skipPersist } : undefined,
      ctx,
    },
    (ctx as any).hooks
  );
}

export async function persistUserMessageAsync(
  userMessage: string,
  ctx: ExecutionContext,
  options?: SendTurnOptions
): Promise<ChatMessage> {
  const userMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    to: (ctx as any).agent.id,
    isHuman: true,
    content: userMessage,
  };

  if (!options?.skipPersist) {
    const generatedTitle = await (ctx as any).sessionManager.appendMessage(
      ctx.sessionId!,
      userMsg,
      (ctx as any).llmService
    );
    if (generatedTitle) {
      (ctx as any).hooks?.emit?.({
        kind: 'session_title_updated',
        sessionId: ctx.sessionId!,
        title: generatedTitle,
      });
    }
  }

  ctx.history.push(userMsg);
  emitStatus((ctx as any).hooks, 'thinking');
  return userMsg;
}

export async function prepareMessagesAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext
): Promise<ILlmChatMessageParam[]> {
  const compressed = await plugins.compressor.compress(ctx.history, ctx);
  const messages = await plugins.contextBuilder.build(compressed, ctx);

  for (const enricher of plugins.enrichers) {
    const extra = await enricher.enrich(ctx);
    if (extra) {
      messages.unshift({ role: 'system', content: extra });
    }
  }

  const ragSnippet = await plugins.ragProvider.retrieve(userMessage, ctx);
  if (ragSnippet) {
    messages.push({ role: 'system', content: `## Relevant context\n${ragSnippet}` });
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onMessagesPrepared',
    { messages, ctx },
    (ctx as any).hooks
  );

  return messages;
}

export async function resolveSkillsAndToolsAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext
): Promise<SendTurnResolvedSkillsAndTools> {
  const resolvedSkills = await (ctx as any).skillManager.resolveSkillsForAgent((ctx as any).agent);

  if (resolvedSkills.roleSkill) {
    emitLog(
      (ctx as any).hooks,
      'info',
      `[skills] Loaded role skill: ${resolvedSkills.roleSkill.name}`
    );
  }

  for (const skill of resolvedSkills.specializationSkills) {
    emitLog((ctx as any).hooks, 'info', `[skills] Loaded specialization skill: ${skill.name}`);
  }

  for (const missing of resolvedSkills.missingSkillNames) {
    emitLog((ctx as any).hooks, 'warn', `[skills] Skill not found: ${missing}`);
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onSkillsResolved',
    {
      skills: resolvedSkills.skills,
      missingSkillNames: resolvedSkills.missingSkillNames,
      ctx,
    },
    (ctx as any).hooks
  );

  const allowedSkillIds = ((ctx as any).agent.skills ?? []).map(
    (skill: { id: string }) => skill.id
  );
  let sessionSkillFiles: AgentSkillFile[] = [];

  if (allowedSkillIds.length > 0) {
    const existingSessionSkills = await (ctx as any).sessionManager.getSessionSkills(
      ctx.sessionId!
    );
    const loadedRecords = existingSessionSkills.map((record: any) => ({
      skillPath: record.skillPath,
      paused: record.paused,
    }));

    const { newlyLoaded, activeSkills } = await (ctx as any).skillManager.resolveSessionSkills(
      allowedSkillIds,
      loadedRecords,
      userMessage
    );

    for (const skill of newlyLoaded) {
      const relPath = path.relative(ctx.workspaceRoot, skill.filePath).replaceAll('\\', '/');
      await (ctx as any).sessionManager.addSessionSkill(ctx.sessionId!, relPath);
      emitLog((ctx as any).hooks, 'info', `[session-skills] Triggered: ${skill.name}`);
    }

    for (const skill of activeSkills) {
      if (!newlyLoaded.includes(skill)) {
        emitLog((ctx as any).hooks, 'info', `[session-skills] Active: ${skill.name}`);
      }
    }

    sessionSkillFiles = activeSkills;
  }

  const skills: Skill[] = [...resolvedSkills.skills, ...(sessionSkillFiles as unknown as Skill[])];
  const teamRoster = await (ctx as any).agentManager.getAllAgentsAsync();

  const discoverMcpTools = (plugins.mcpGateway as { discover?: () => Promise<ICommand[]> })
    .discover;
  const [tools, mcpTools] = await Promise.all([
    plugins.toolResolver.resolve(ctx),
    typeof discoverMcpTools === 'function'
      ? discoverMcpTools.call(plugins.mcpGateway)
      : Promise.resolve([] as ICommand[]),
  ]);

  const allTools = [...tools, ...mcpTools];

  await plugins.llmSelector.select(ctx);

  const toolDefs = buildToolDefinitions(ctx, allTools);

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onToolsResolved',
    {
      tools: allTools,
      toolDefs,
      ctx,
    },
    (ctx as any).hooks
  );

  return {
    skills,
    teamRoster,
    allTools,
    toolDefs,
  };
}

export async function invokeTurnLlmAsync(
  messages: ILlmChatMessageParam[],
  resolved: SendTurnResolvedSkillsAndTools,
  ctx: ExecutionContext
): Promise<SendTurnLlmInvocationResult> {
  const invoked = await invokeLlm({
    messages,
    tools: resolved.allTools,
    toolDefs: resolved.toolDefs,
    skills: resolved.skills,
    teamRoster: resolved.teamRoster,
    ctx,
  });

  return {
    fullResponse: invoked.fullResponse,
    structuredResults: invoked.structuredResults,
  };
}

export async function handleLlmFailureAsync(
  error: unknown,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  structuredResults: StructuredToolResult[] = []
): Promise<TurnResult> {
  if (isAbortError(error)) {
    throw error;
  }

  const message = toErrorMessage(error);
  process.stderr.write(`\n[LLM error] ${message}\n`);
  emitStatus((ctx as any).hooks, 'error', message);

  const fallbackContent = buildRetryableFailureMessage(message);
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse: '',
      persistedContent: fallbackContent,
      ctx,
    },
    (ctx as any).hooks
  );

  const failedAgentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: (ctx as any).agent.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
    archived: true,
  };

  if (!options?.skipPersist) {
    await (ctx as any).sessionManager.appendMessage(ctx.sessionId!, failedAgentMsg);
  }

  ctx.history.push(failedAgentMsg);

  const failedTurnResult: TurnResult = { text: persistedContent, done: true };
  await plugins.outputHandler.handle(failedTurnResult, ctx);

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onTurnCompleted',
    {
      fullResponse: '',
      persistedContent,
      structuredResults,
      turnResult: failedTurnResult,
      ctx,
    },
    (ctx as any).hooks
  );

  return failedTurnResult;
}

export async function persistAssistantMessageAsync(
  fullResponse: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext
): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse,
      persistedContent: fullResponse,
      ctx,
    },
    (ctx as any).hooks
  );

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: (ctx as any).agent.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
  };

  const generatedTitle = await (ctx as any).sessionManager.appendMessage(
    ctx.sessionId!,
    agentMsg,
    (ctx as any).llmService
  );
  ctx.history.push(agentMsg);

  if (generatedTitle) {
    (ctx as any).hooks?.emit?.({
      kind: 'session_title_updated',
      sessionId: ctx.sessionId!,
      title: generatedTitle,
    });
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onAfterPersistAssistantMessage',
    {
      fullResponse,
      persistedContent,
      persistedMessage: agentMsg,
      ctx,
    },
    (ctx as any).hooks
  );

  await (ctx as any).agentManager.recordInteractionAsync((ctx as any).agent.id);

  return {
    persistedContent,
    persistedMessage: agentMsg,
  };
}

export async function parseTurnResultAsync(
  structuredResults: StructuredToolResult[],
  fullResponse: string,
  persistedContent: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext
): Promise<TurnResult | null> {
  for (const parser of plugins.turnResultParsers) {
    const override = parser.parse(structuredResults, fullResponse, persistedContent, ctx);
    if (override !== null) {
      const parsedResult = override as TurnResult;

      await runVoidHookAsync(
        plugins.hookPlugins ?? [],
        'onTurnCompleted',
        {
          fullResponse,
          persistedContent,
          structuredResults,
          turnResult: parsedResult,
          ctx,
        },
        (ctx as any).hooks
      );

      return parsedResult;
    }
  }

  return null;
}

export async function finalizeTurnResultAsync(
  turnResult: TurnResult,
  fullResponse: string,
  persistedContent: string,
  structuredResults: StructuredToolResult[],
  plugins: ResolvedPlugins,
  ctx: ExecutionContext
): Promise<TurnResult> {
  await plugins.outputHandler.handle(turnResult, ctx);

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onTurnCompleted',
    {
      fullResponse,
      persistedContent,
      structuredResults,
      turnResult,
      ctx,
    },
    (ctx as any).hooks
  );

  return turnResult;
}

export function buildRetryableFailureMessage(rawMessage: string): string {
  const normalized = rawMessage.toLowerCase();

  if (normalized.includes('timed out') || normalized.includes('timeout')) {
    return "Sorry — I couldn't complete that request in time. Please try again.";
  }

  return 'Sorry — I ran into a temporary issue while processing your request. Please try again.';
}

export function isAbortError(error: unknown): boolean {
  if (error instanceof Error) {
    return error.name === 'AbortError' || error.message.includes('aborted');
  }
  return false;
}

export async function runVoidHookAsync<T extends keyof IOrchestratorHookPlugin>(
  hookPlugins: IOrchestratorHookPlugin[],
  hookName: T,
  payload: unknown,
  hooks: ChatRuntimeHooks | undefined
): Promise<void> {
  for (const plugin of hookPlugins) {
    const hook = plugin[hookName];
    if (typeof hook !== 'function') {
      continue;
    }

    try {
      await (hook as (hookPayload: typeof payload) => Promise<void> | void)(payload);
    } catch (error) {
      const message = toErrorMessage(error);
      emitLog(hooks, 'warn', `[plugin:${plugin.name}] Hook ${String(hookName)} failed: ${message}`);
    }
  }
}

export async function runBeforePersistMessageHooksAsync(
  hookPlugins: IOrchestratorHookPlugin[],
  payload: BeforePersistAssistantMessageHookPayload,
  hooks: ChatRuntimeHooks | undefined
): Promise<string> {
  let persistedContent = payload.persistedContent;

  for (const plugin of hookPlugins) {
    const hook = plugin.onBeforePersistAssistantMessage;
    if (typeof hook !== 'function') {
      continue;
    }

    try {
      const maybeNext = await hook({ ...payload, persistedContent });
      if (typeof maybeNext === 'string') {
        persistedContent = maybeNext;
      }
    } catch (error) {
      const message = toErrorMessage(error);
      emitLog(
        hooks,
        'warn',
        `[plugin:${plugin.name}] Hook onBeforePersistAssistantMessage failed: ${message}`
      );
    }
  }

  return persistedContent;
}
