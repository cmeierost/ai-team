import path from 'node:path';
import { inspect } from 'node:util';
import type {
  Agent,
  IAgentManager,
  AgentSkillFile,
  ICommand,
  ChatMessage,
  ILlmChatMessageParam,
  ILlmService,
  ISkillManager,
  Skill,
  StructuredToolResult,
  ExecutionContext,
} from '@ai-team/core';
import type { ChatRuntimeHooks } from './hooks.js';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import { ToolIdentity } from '../tools/tool-manager.js';
import { ToolSchemaService } from './services/schema-service.js';
import type {
  BeforePersistAssistantMessageHookPayload,
  IOrchestratorHookPlugin,
  ResolvedPlugins,
  TurnResult,
} from './pipeline.js';
import { invokeLlm } from './llm-invoke.js';
import type { IEmitService } from '@ai-team/core';
import type { ToolDispatcher } from './tool-dispatch.js';
import type { SessionManager } from '../session-manager.js';

export interface SendTurnOptions {
  skipPersist?: boolean;
}

/**
 * Runtime dependencies threaded explicitly into send-turn steps.
 * These are NOT on ExecutionContext — they are injected by the orchestrator.
 */
export interface SendTurnDeps {
  sessionManager: Pick<SessionManager, 'appendMessage' | 'getSessionSkills' | 'addSessionSkill'>;
  llmService: ILlmService | undefined;
  skillManager: ISkillManager;
  agentManager: Pick<IAgentManager, 'getAllAgentsAsync' | 'recordInteractionAsync'>;
  runtimeHooks: ChatRuntimeHooks;
  emitService: IEmitService;
  toolDispatcher?: ToolDispatcher;
  toolSchemaService?: ToolSchemaService;
  workspaceRoot?: string;
}

export class SendTurnStepService {
  constructor(private readonly deps: SendTurnDeps) {}

  async ensureTurnStartAsync(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext,
    options?: SendTurnOptions
  ): Promise<void> {
    return ensureTurnStartAsyncInternal(userMessage, plugins, ctx, options, this.deps);
  }

  async persistUserMessageAsync(
    userMessage: string,
    ctx: ExecutionContext,
    options?: SendTurnOptions
  ): Promise<ChatMessage> {
    return persistUserMessageAsyncInternal(userMessage, ctx, options, this.deps);
  }

  async prepareMessagesAsync(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<ILlmChatMessageParam[]> {
    return prepareMessagesAsyncInternal(userMessage, plugins, ctx, this.deps);
  }

  async resolveSkillsAndToolsAsync(
    userMessage: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<SendTurnResolvedSkillsAndTools> {
    return resolveSkillsAndToolsAsyncInternal(userMessage, plugins, ctx, this.deps);
  }

  async invokeTurnLlmAsync(
    messages: ILlmChatMessageParam[],
    resolved: SendTurnResolvedSkillsAndTools,
    ctx: ExecutionContext
  ): Promise<SendTurnLlmInvocationResult> {
    return invokeTurnLlmAsyncInternal(messages, resolved, ctx, this.deps);
  }

  async handleLlmFailureAsync(
    error: unknown,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext,
    options?: SendTurnOptions,
    structuredResults: StructuredToolResult[] = []
  ): Promise<TurnResult> {
    return handleLlmFailureAsyncInternal(
      error,
      plugins,
      ctx,
      options,
      structuredResults,
      this.deps
    );
  }

  async persistAssistantMessageAsync(
    fullResponse: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
    return persistAssistantMessageAsyncInternal(fullResponse, plugins, ctx, this.deps);
  }

  async parseTurnResultAsync(
    structuredResults: StructuredToolResult[],
    fullResponse: string,
    persistedContent: string,
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<TurnResult | null> {
    return parseTurnResultAsyncInternal(
      structuredResults,
      fullResponse,
      persistedContent,
      plugins,
      ctx,
      this.deps
    );
  }

  async finalizeTurnResultAsync(
    turnResult: TurnResult,
    fullResponse: string,
    persistedContent: string,
    structuredResults: StructuredToolResult[],
    plugins: ResolvedPlugins,
    ctx: ExecutionContext
  ): Promise<TurnResult> {
    return finalizeTurnResultAsyncInternal(
      turnResult,
      fullResponse,
      persistedContent,
      structuredResults,
      plugins,
      ctx,
      this.deps
    );
  }
}

export async function ensureTurnStartAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options: SendTurnOptions | undefined,
  deps: SendTurnDeps
): Promise<void> {
  return ensureTurnStartAsyncInternal(userMessage, plugins, ctx, options, deps);
}

export async function persistUserMessageAsync(
  userMessage: string,
  ctx: ExecutionContext,
  options: SendTurnOptions | undefined,
  deps: SendTurnDeps
): Promise<ChatMessage> {
  return persistUserMessageAsyncInternal(userMessage, ctx, options, deps);
}

export async function prepareMessagesAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<ILlmChatMessageParam[]> {
  return prepareMessagesAsyncInternal(userMessage, plugins, ctx, deps);
}

export async function resolveSkillsAndToolsAsync(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<SendTurnResolvedSkillsAndTools> {
  return resolveSkillsAndToolsAsyncInternal(userMessage, plugins, ctx, deps);
}

export async function invokeTurnLlmAsync(
  messages: ILlmChatMessageParam[],
  resolved: SendTurnResolvedSkillsAndTools,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<SendTurnLlmInvocationResult> {
  return invokeTurnLlmAsyncInternal(messages, resolved, ctx, deps);
}

export async function handleLlmFailureAsync(
  error: unknown,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options: SendTurnOptions | undefined,
  structuredResults: StructuredToolResult[],
  deps: SendTurnDeps
): Promise<TurnResult> {
  return handleLlmFailureAsyncInternal(error, plugins, ctx, options, structuredResults, deps);
}

export async function persistAssistantMessageAsync(
  fullResponse: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
  return persistAssistantMessageAsyncInternal(fullResponse, plugins, ctx, deps);
}

export async function parseTurnResultAsync(
  structuredResults: StructuredToolResult[],
  fullResponse: string,
  persistedContent: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<TurnResult | null> {
  return parseTurnResultAsyncInternal(
    structuredResults,
    fullResponse,
    persistedContent,
    plugins,
    ctx,
    deps
  );
}

export async function finalizeTurnResultAsync(
  turnResult: TurnResult,
  fullResponse: string,
  persistedContent: string,
  structuredResults: StructuredToolResult[],
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps: SendTurnDeps
): Promise<TurnResult> {
  return finalizeTurnResultAsyncInternal(
    turnResult,
    fullResponse,
    persistedContent,
    structuredResults,
    plugins,
    ctx,
    deps
  );
}

function buildToolDefinitions(tools: ICommand[], deps: SendTurnDeps): LlmToolDefinition[] {
  if (!deps.toolSchemaService) {
    return tools.map((tool) => ({
      name: ToolIdentity.key(tool.metadata),
      description: tool.metadata.summary ?? tool.metadata.description,
      parameters: undefined,
      group: tool.metadata.group,
    }));
  }

  return deps.toolSchemaService.buildToolDefinitions(tools);
}

function filterDiscoveredToolsForAgent(agent: Agent, discoveredTools: ICommand[]): ICommand[] {
  const allowedSelectors = (agent.tools ?? []).map((selector) => selector.trim()).filter(Boolean);
  if (allowedSelectors.length === 0) {
    return [];
  }

  const deniedSelectors = (agent.disallowedTools ?? [])
    .map((selector) => selector.trim())
    .filter(Boolean);

  return discoveredTools.filter((tool) => {
    if (!tool.metadata.availableIn?.tool) {
      return false;
    }

    if (deniedSelectors.some((selector) => ToolIdentity.matchesSelector(selector, tool.metadata))) {
      return false;
    }

    return allowedSelectors.some((selector) =>
      ToolIdentity.matchesSelector(selector, tool.metadata)
    );
  });
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

async function ensureTurnStartAsyncInternal(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  deps?: SendTurnDeps
): Promise<void> {
  if (deps?.runtimeHooks?.signal?.aborted) {
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
    deps!.emitService
  );
}

async function persistUserMessageAsyncInternal(
  userMessage: string,
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  deps?: SendTurnDeps
): Promise<ChatMessage> {
  const userMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    to: ctx.agent!.id,
    isHuman: true,
    content: userMessage,
  };

  if (!options?.skipPersist) {
    const generatedTitle = await deps!.sessionManager.appendMessage(
      ctx.sessionId!,
      userMsg,
      deps!.llmService
    );
    if (generatedTitle) {
      deps!.emitService.emit({
        kind: 'session_title_updated',
        sessionId: ctx.sessionId!,
        title: generatedTitle,
      });
    }
  }

  ctx.history.push(userMsg);
  deps!.emitService.status('thinking');
  return userMsg;
}

async function prepareMessagesAsyncInternal(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
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
    deps!.emitService
  );

  return messages;
}

async function resolveSkillsAndToolsAsyncInternal(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
): Promise<SendTurnResolvedSkillsAndTools> {
  const resolvedSkills = await deps!.skillManager.resolveSkillsForAgent(ctx.agent!);

  if (resolvedSkills.roleSkill) {
    deps!.emitService.log('info', `[skills] Loaded role skill: ${resolvedSkills.roleSkill.name}`);
  }

  for (const skill of resolvedSkills.specializationSkills) {
    deps!.emitService.log('info', `[skills] Loaded specialization skill: ${skill.name}`);
  }

  for (const missing of resolvedSkills.missingSkillNames) {
    deps!.emitService.log('warn', `[skills] Skill not found: ${missing}`);
  }

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onSkillsResolved',
    {
      skills: resolvedSkills.skills,
      missingSkillNames: resolvedSkills.missingSkillNames,
      ctx,
    },
    deps!.emitService
  );

  const allowedSkillIds = (ctx.agent!.skills ?? []).map((skill: { id: string }) => skill.id);
  let sessionSkillFiles: AgentSkillFile[] = [];

  if (allowedSkillIds.length > 0) {
    const existingSessionSkills = await deps!.sessionManager.getSessionSkills(ctx.sessionId!);
    const loadedRecords = existingSessionSkills.map((record: any) => ({
      skillPath: record.skillPath,
      paused: record.paused,
    }));

    const { newlyLoaded, activeSkills } = await deps!.skillManager.resolveSessionSkills(
      allowedSkillIds,
      loadedRecords,
      userMessage
    );

    for (const skill of newlyLoaded) {
      const runtimeWorkspaceRoot = deps!.workspaceRoot;
      const relPath = path
        .relative(runtimeWorkspaceRoot ?? process.cwd(), skill.filePath)
        .replaceAll('\\', '/');
      await deps!.sessionManager.addSessionSkill(ctx.sessionId!, relPath);
      deps!.emitService.log('info', `[session-skills] Triggered: ${skill.name}`);
    }

    for (const skill of activeSkills) {
      if (!newlyLoaded.includes(skill)) {
        deps!.emitService.log('info', `[session-skills] Active: ${skill.name}`);
      }
    }

    sessionSkillFiles = activeSkills;
  }

  const skills: Skill[] = [...resolvedSkills.skills, ...(sessionSkillFiles as unknown as Skill[])];
  let teamRoster: Agent[] = [];
  teamRoster = await deps!.agentManager.getAllAgentsAsync();

  const discoverMcpTools = (plugins.mcpGateway as { discover?: () => Promise<ICommand[]> })
    .discover;
  const [tools, mcpTools] = await Promise.all([
    plugins.toolResolver.resolve(ctx),
    typeof discoverMcpTools === 'function'
      ? discoverMcpTools.call(plugins.mcpGateway)
      : Promise.resolve([] as ICommand[]),
  ]);

  const allowedMcpTools = filterDiscoveredToolsForAgent(ctx.agent!, mcpTools);
  const allTools = [...tools, ...allowedMcpTools];

  await plugins.llmSelector.select(ctx);

  const toolDefs = buildToolDefinitions(allTools, deps!);

  await runVoidHookAsync(
    plugins.hookPlugins ?? [],
    'onToolsResolved',
    {
      tools: allTools,
      toolDefs,
      ctx,
    },
    deps!.emitService
  );

  return {
    skills,
    teamRoster,
    allTools,
    toolDefs,
  };
}

async function invokeTurnLlmAsyncInternal(
  messages: ILlmChatMessageParam[],
  resolved: SendTurnResolvedSkillsAndTools,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
): Promise<SendTurnLlmInvocationResult> {
  const invoked = await invokeLlm({
    messages,
    tools: resolved.allTools,
    toolDefs: resolved.toolDefs,
    skills: resolved.skills,
    teamRoster: resolved.teamRoster,
    ctx,
    emitService: deps!.emitService,
    llmService: deps!.llmService!,
    hooks: deps!.runtimeHooks,
    toolDispatcher: deps!.toolDispatcher,
  });

  return {
    fullResponse: invoked.fullResponse,
    structuredResults: invoked.structuredResults,
  };
}

async function handleLlmFailureAsyncInternal(
  error: unknown,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  options?: SendTurnOptions,
  structuredResults: StructuredToolResult[] = [],
  deps?: SendTurnDeps
): Promise<TurnResult> {
  if (isAbortError(error)) {
    throw error;
  }

  const message = toErrorMessage(error);
  process.stderr.write(`\n[LLM error] ${message}\n`);
  deps!.emitService.status('error', message);

  const fallbackContent = buildRetryableFailureMessage(message);
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse: '',
      persistedContent: fallbackContent,
      ctx,
    },
    deps!.emitService
  );

  const failedAgentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: ctx.agent!.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
    archived: true,
  };

  if (!options?.skipPersist) {
    await deps!.sessionManager.appendMessage(ctx.sessionId!, failedAgentMsg);
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
    deps!.emitService
  );

  return failedTurnResult;
}

async function persistAssistantMessageAsyncInternal(
  fullResponse: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
): Promise<{ persistedContent: string; persistedMessage: ChatMessage }> {
  const persistedContent = await runBeforePersistMessageHooksAsync(
    plugins.hookPlugins ?? [],
    {
      fullResponse,
      persistedContent: fullResponse,
      ctx,
    },
    deps!.emitService
  );

  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: ctx.agent!.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
  };

  const generatedTitle = await deps!.sessionManager.appendMessage(
    ctx.sessionId!,
    agentMsg,
    deps!.llmService
  );
  ctx.history.push(agentMsg);

  if (generatedTitle) {
    deps!.emitService.emit({
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
    deps!.emitService
  );

  await deps!.agentManager.recordInteractionAsync(ctx.agent!.id);

  return {
    persistedContent,
    persistedMessage: agentMsg,
  };
}

async function parseTurnResultAsyncInternal(
  structuredResults: StructuredToolResult[],
  fullResponse: string,
  persistedContent: string,
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
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
        deps!.emitService
      );

      return parsedResult;
    }
  }

  return null;
}

async function finalizeTurnResultAsyncInternal(
  turnResult: TurnResult,
  fullResponse: string,
  persistedContent: string,
  structuredResults: StructuredToolResult[],
  plugins: ResolvedPlugins,
  ctx: ExecutionContext,
  deps?: SendTurnDeps
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
    deps!.emitService
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
  emitService: IEmitService
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
      emitService.log('warn', `[plugin:${plugin.name}] Hook ${String(hookName)} failed: ${message}`);
    }
  }
}

export async function runBeforePersistMessageHooksAsync(
  hookPlugins: IOrchestratorHookPlugin[],
  payload: BeforePersistAssistantMessageHookPayload,
  emitService: IEmitService
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
      emitService.log(
        'warn',
        `[plugin:${plugin.name}] Hook onBeforePersistAssistantMessage failed: ${message}`
      );
    }
  }

  return persistedContent;
}
