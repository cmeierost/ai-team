import path from 'node:path';
import { inspect } from 'node:util';
import type {
  Agent,
  AgentSkillFile,
  AgentTool,
  ChatCompletionMessageParam,
  ChatMessage,
  Skill,
  StructuredToolResult,
} from '@ai-team/infrastructure';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import { toolKey } from '../tools/tool-manager.js';
import type { OrchestratorContext } from './pipeline-context.js';
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

function getCachedToolSchema(ctx: OrchestratorContext, tool: AgentTool): LlmToolDefinition {
  const toolName = toolKey(tool);
  const managerKey = ctx.toolManager as unknown as object;
  const cacheForManager = TOOL_SCHEMA_CACHE.get(managerKey) ?? new Map<string, LlmToolDefinition>();

  if (!TOOL_SCHEMA_CACHE.has(managerKey)) {
    TOOL_SCHEMA_CACHE.set(managerKey, cacheForManager);
  }

  const cached = cacheForManager.get(toolName);
  if (cached) {
    return cached;
  }

  const schema = ctx.toolManager.toSchema(toolName) ?? {
    name: toolName,
    description: tool.description,
    parameters: zodSchemaToJsonSchema(tool.parameters),
  };

  cacheForManager.set(toolName, schema);
  return schema;
}

function buildToolDefinitions(ctx: OrchestratorContext, tools: AgentTool[]): LlmToolDefinition[] {
  const defs: LlmToolDefinition[] = [];
  for (const tool of tools) {
    defs.push(getCachedToolSchema(ctx, tool));
  }
  return defs;
}

export interface SendTurnResolvedSkillsAndTools {
  skills: Skill[];
  teamRoster: Agent[];
  allTools: AgentTool[];
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
  ctx: OrchestratorContext,
  options?: SendTurnOptions
): Promise<void> {
  if (ctx.hooks?.signal?.aborted) {
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
    ctx.hooks
  );
}

export async function persistUserMessageAsync(
  userMessage: string,
  ctx: OrchestratorContext,
  options?: SendTurnOptions
): Promise<ChatMessage> {
  const userMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    to: ctx.agent.id,
    isHuman: true,
    content: userMessage,
  };

  if (!options?.skipPersist) {
    const generatedTitle = await ctx.sessionManager.appendMessage(
      ctx.sessionId,
      userMsg,
      ctx.llmService
    );
    if (generatedTitle) {
      ctx.hooks?.emit?.({
        kind: 'session_title_updated',
        sessionId: ctx.sessionId,
        title: generatedTitle,
      });
    }
  }

  ctx.history.push(userMsg);
  emitStatus(ctx.hooks, 'thinking');
  return userMsg;
}

export async function prepareMessagesAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext
): Promise<ChatCompletionMessageParam[]> {
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
    ctx.hooks
  );

  return messages;
}

export async function resolveSkillsAndToolsAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext
): Promise<SendTurnResolvedSkillsAndTools> {
  const resolvedSkills = await ctx.skillManager.resolveSkillsForAgent(ctx.agent);

  if (resolvedSkills.roleSkill) {
    emitLog(ctx.hooks, 'info', `[skills] Loaded role skill: ${resolvedSkills.roleSkill.name}`);
  }

  for (const skill of resolvedSkills.specializationSkills) {
    emitLog(ctx.hooks, 'info', `[skills] Loaded specialization skill: ${skill.name}`);
  }

  for (const missing of resolvedSkills.missingSkillNames) {
    emitLog(ctx.hooks, 'warn', `[skills] Skill not found: ${missing}`);
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onSkillsResolved',
    {
      skills: resolvedSkills.skills,
      missingSkillNames: resolvedSkills.missingSkillNames,
      ctx,
    },
    ctx.hooks
  );

  const allowedSkillIds = (ctx.agent.skills ?? []).map((skill: { id: string }) => skill.id);
  let sessionSkillFiles: AgentSkillFile[] = [];

  if (allowedSkillIds.length > 0) {
    const existingSessionSkills = await ctx.sessionManager.getSessionSkills(ctx.sessionId);
    const loadedRecords = existingSessionSkills.map((record) => ({
      skillPath: record.skillPath,
      paused: record.paused,
    }));

    const { newlyLoaded, activeSkills } = await ctx.skillManager.resolveSessionSkills(
      allowedSkillIds,
      loadedRecords,
      userMessage
    );

    for (const skill of newlyLoaded) {
      const relPath = path.relative(ctx.workspaceRoot, skill.filePath).replaceAll('\\', '/');
      await ctx.sessionManager.addSessionSkill(ctx.sessionId, relPath);
      emitLog(ctx.hooks, 'info', `[session-skills] Triggered: ${skill.name}`);
    }

    for (const skill of activeSkills) {
      if (!newlyLoaded.includes(skill)) {
        emitLog(ctx.hooks, 'info', `[session-skills] Active: ${skill.name}`);
      }
    }

    sessionSkillFiles = activeSkills;
  }

  const skills: Skill[] = [...resolvedSkills.skills, ...(sessionSkillFiles as unknown as Skill[])];
  const teamRoster = await ctx.agentManager.getAllAgentsAsync();

  const discoverMcpTools = (plugins.mcpGateway as { discover?: () => Promise<AgentTool[]> })
    .discover;
  const [tools, mcpTools] = await Promise.all([
    plugins.toolResolver.resolve(ctx),
    typeof discoverMcpTools === 'function'
      ? discoverMcpTools.call(plugins.mcpGateway)
      : Promise.resolve([] as AgentTool[]),
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
    ctx.hooks
  );

  return {
    skills,
    teamRoster,
    allTools,
    toolDefs,
  };
}

export async function invokeTurnLlmAsync(
  messages: ChatCompletionMessageParam[],
  resolved: SendTurnResolvedSkillsAndTools,
  ctx: OrchestratorContext
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
  ctx: OrchestratorContext,
  options?: SendTurnOptions,
  structuredResults: StructuredToolResult[] = []
): Promise<TurnResult> {
  if (isAbortError(error)) {
    throw error;
  }

  const message = toErrorMessage(error);
  process.stderr.write(`\n[LLM error] ${message}\n`);
  emitStatus(ctx.hooks, 'error', message);

  const fallbackContent = buildRetryableFailureMessage(message);
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse: '',
      persistedContent: fallbackContent,
      ctx,
    },
    ctx.hooks
  );

  const failedAgentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: ctx.agent.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
    archived: true,
  };

  if (!options?.skipPersist) {
    await ctx.sessionManager.appendMessage(ctx.sessionId, failedAgentMsg);
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
    ctx.hooks
  );

  return failedTurnResult;
}

export async function persistAssistantMessageAsync(
  fullResponse: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext
): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse,
      persistedContent: fullResponse,
      ctx,
    },
    ctx.hooks
  );

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: ctx.agent.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
  };

  const generatedTitle = await ctx.sessionManager.appendMessage(
    ctx.sessionId,
    agentMsg,
    ctx.llmService
  );
  ctx.history.push(agentMsg);

  if (generatedTitle) {
    ctx.hooks?.emit?.({
      kind: 'session_title_updated',
      sessionId: ctx.sessionId,
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
    ctx.hooks
  );

  await ctx.agentManager.recordInteractionAsync(ctx.agent.id);

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
  ctx: OrchestratorContext
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
        ctx.hooks
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
  ctx: OrchestratorContext
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
    ctx.hooks
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
  hooks: OrchestratorContext['hooks']
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
  hooks: OrchestratorContext['hooks']
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
