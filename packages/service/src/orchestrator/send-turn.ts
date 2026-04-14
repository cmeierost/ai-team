/**
 * send-turn.ts — executes one LLM turn through the full pipeline.
 *
 * Responsibilities:
 *   1. Persist the user message to session history.
 *   2. Build the message list via IContextCompressor + IContextBuilder.
 *   3. Collect tool definitions via IToolResolver.
 *   4. Delegate the LLM call to llm-invoke.ts (streaming filter, tool dispatch).
 *   5. Run structured results + response text through the ITurnResultParser chain.
 *   6. Return a TurnResult for the chat loop.
 */

import path from 'node:path';
import type { ChatMessage, Skill, StructuredToolResult, AgentTool } from '@ai-team/infrastructure';
import type { LlmToolDefinition } from '../tools/tool-manager.js';
import { toolKey } from '../tools/tool-manager.js';
import type { OrchestratorContext } from './pipeline-context.js';
import type {
  BeforePersistAssistantMessageHookPayload,
  IOrchestratorHookPlugin,
  ResolvedPlugins,
  TurnResult,
} from './pipeline.js';
import { emitLog, emitStatus } from './stream-events.js';
import { invokeLlm } from './llm-invoke.js';

const TOOL_SCHEMA_CACHE = new WeakMap<object, Map<string, LlmToolDefinition>>();

function getCachedToolSchema(
  ctx: OrchestratorContext,
  toolName: string
): LlmToolDefinition | undefined {
  const managerKey = ctx.toolManager as unknown as object;
  const cacheForManager = TOOL_SCHEMA_CACHE.get(managerKey) ?? new Map<string, LlmToolDefinition>();
  if (!TOOL_SCHEMA_CACHE.has(managerKey)) {
    TOOL_SCHEMA_CACHE.set(managerKey, cacheForManager);
  }

  const cached = cacheForManager.get(toolName);
  if (cached) return cached;

  const schema = ctx.toolManager.toSchema(toolName);
  if (schema) {
    cacheForManager.set(toolName, schema);
  }
  return schema;
}

function buildToolDefinitions(ctx: OrchestratorContext, tools: AgentTool[]): LlmToolDefinition[] {
  const defs: LlmToolDefinition[] = [];
  for (const tool of tools) {
    const schema = getCachedToolSchema(ctx, toolKey(tool));
    if (schema) defs.push(schema);
  }
  return defs;
}

export interface SendTurnOptions {
  /**
   * When true the user message is injected into the LLM context but NOT
   * persisted to the session store.  Used for synthetic / system-generated
   * prompts (e.g. post-handoff auto-react) that should never appear in the DB.
   */
  skipPersist?: boolean;
}

export async function sendTurn(
  userMessage: string,
  plugins: ResolvedPlugins,
  ctx: OrchestratorContext,
  options?: SendTurnOptions
): Promise<TurnResult> {
  const { agent, hooks, sessionManager, sessionId } = ctx;
  const hookPlugins = plugins.hookPlugins ?? [];

  // ── Abort guard ────────────────────────────────────────────────────────────
  if (hooks?.signal?.aborted) {
    throw new DOMException('Chat request aborted by user.', 'AbortError');
  }

  await runVoidHook(
    hookPlugins,
    'onTurnStart',
    {
      userMessage,
      options: options ? { skipPersist: options.skipPersist } : undefined,
      ctx,
    },
    hooks
  );

  // ── 1. Persist user message ────────────────────────────────────────────────
  const userMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: 'human',
    to: agent.id,
    isHuman: true,
    content: userMessage,
  };
  if (!options?.skipPersist) {
    await sessionManager.appendMessage(sessionId, userMsg);
  }
  ctx.history.push(userMsg);

  emitStatus(hooks, 'thinking');

  // ── 2. Compress history + build message list ───────────────────────────────
  const compressed = await plugins.compressor.compress(ctx.history, ctx);
  const messages = await plugins.contextBuilder.build(compressed, ctx);

  // ── 3. Inject enrichments ──────────────────────────────────────────────────
  for (const enricher of plugins.enrichers) {
    const extra = await enricher.enrich(ctx);
    if (extra) {
      messages.unshift({ role: 'system', content: extra });
    }
  }

  // ── 4. RAG supplement ──────────────────────────────────────────────────────
  const ragSnippet = await plugins.ragProvider.retrieve(userMessage, ctx);
  if (ragSnippet) {
    messages.push({ role: 'system', content: `## Relevant context\n${ragSnippet}` });
  }

  await runVoidHook(hookPlugins, 'onMessagesPrepared', { messages, ctx }, hooks);

  // ── 5. Configure LLM + collect tools ──────────────────────────────────────
  // Load role template skill and any agent-specific specialization skills via SkillManager
  const resolvedSkills = await ctx.skillManager.resolveSkillsForAgent(ctx.agent);
  if (resolvedSkills.roleSkill) {
    emitLog(hooks, 'info', `[skills] Loaded role skill: ${resolvedSkills.roleSkill.name}`);
  }
  for (const skill of resolvedSkills.specializationSkills) {
    emitLog(hooks, 'info', `[skills] Loaded specialization skill: ${skill.name}`);
  }
  for (const missing of resolvedSkills.missingSkillNames) {
    emitLog(hooks, 'warn', `[skills] Skill not found: ${missing}`);
  }

  await runVoidHook(
    hookPlugins,
    'onSkillsResolved',
    {
      skills: resolvedSkills.skills,
      missingSkillNames: resolvedSkills.missingSkillNames,
      ctx,
    },
    hooks
  );

  // ── 5b. Session skill detection — load SKILL.md files on demand ────────────
  // Allowed skill IDs come from agent.yml → skills[].id
  const allowedSkillIds = (ctx.agent.skills ?? []).map((s: { id: string }) => s.id);
  let sessionSkillFiles: import('@ai-team/infrastructure').AgentSkillFile[] = [];
  if (allowedSkillIds.length > 0) {
    const existingSessionSkills = await sessionManager.getSessionSkills(sessionId);
    const loadedRecords = existingSessionSkills.map((r) => ({
      skillPath: r.skillPath,
      paused: r.paused,
    }));
    const { newlyLoaded, activeSkills } = await ctx.skillManager.resolveSessionSkills(
      allowedSkillIds,
      loadedRecords,
      userMessage
    );
    for (const skill of newlyLoaded) {
      const relPath = path.relative(ctx.workspaceRoot, skill.filePath).replace(/\\/g, '/');
      await sessionManager.addSessionSkill(sessionId, relPath);
      emitLog(hooks, 'info', `[session-skills] Triggered: ${skill.name}`);
    }
    for (const skill of activeSkills) {
      if (!newlyLoaded.includes(skill)) {
        emitLog(hooks, 'info', `[session-skills] Active: ${skill.name}`);
      }
    }
    sessionSkillFiles = activeSkills;
  }

  // Merge role/specialization skills with active session skill files.
  // AgentSkillFile has `instructions` but not the full SkillConfig shape;
  // cast to Skill so buildSystemPrompt can read `.instructions`.
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

  // Select model (may mutate agent's llmOptions in place)
  await plugins.llmSelector.select(ctx);

  const toolDefs = buildToolDefinitions(ctx, allTools);

  await runVoidHook(
    hookPlugins,
    'onToolsResolved',
    {
      tools: allTools,
      toolDefs,
      ctx,
    },
    hooks
  );

  // ── 6 + 7. Invoke LLM (policy message + streaming + tool dispatch) ─────────
  let fullResponse = '';
  const structuredResults: StructuredToolResult[] = [];

  try {
    const invoked = await invokeLlm({
      messages,
      tools: allTools,
      toolDefs,
      skills,
      teamRoster,
      ctx,
    });
    fullResponse = invoked.fullResponse;
    structuredResults.push(...invoked.structuredResults);
  } catch (err: unknown) {
    if (isAbortError(err)) throw err;

    // LLM unavailable — surface useful error
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`\n[LLM error] ${message}\n`);
    emitStatus(hooks, 'error', message);
    return { text: '', done: true };
  }

  process.stdout.write('\n');

  // ── 8. Persist agent reply ─────────────────────────────────────────────────
  const persistedContent = await runBeforePersistMessageHooks(
    hookPlugins,
    {
      fullResponse,
      persistedContent: fullResponse,
      ctx,
    },
    hooks
  );
  const agentMsg: ChatMessage = {
    timestamp: new Date().toISOString(),
    from: agent.id,
    to: 'human',
    content: persistedContent,
    isHuman: false,
  };
  // Pass llmService only once there are ≥ 2 human messages in history (userMsg already pushed).
  const humanCount = ctx.history.filter((m) => m.isHuman).length;
  const llmServiceForTitle = humanCount >= 2 ? ctx.llmService : undefined;
  if (llmServiceForTitle) emitStatus(hooks, 'title', 'Generating title...');
  const generatedTitle = await sessionManager.appendMessage(
    sessionId,
    agentMsg,
    llmServiceForTitle
  );
  ctx.history.push(agentMsg);

  if (generatedTitle) {
    hooks?.emit?.({ kind: 'session_title_updated', sessionId, title: generatedTitle });
  }

  await runVoidHook(
    hookPlugins,
    'onAfterPersistAssistantMessage',
    {
      fullResponse,
      persistedContent,
      persistedMessage: agentMsg,
      ctx,
    },
    hooks
  );

  await ctx.agentManager.recordInteractionAsync(agent.id);

  // ── 9. Interpret turn result via registered parsers ───────────────────────────
  //
  // Parsers are checked in registration order; the first non-null return wins.
  // Handoff (tool) > handoff (text directive) > hire (tool) — see defaults/turn-result-parsers.ts
  //
  for (const parser of plugins.turnResultParsers) {
    const override = parser.parse(structuredResults, fullResponse, persistedContent, ctx);
    if (override !== null) {
      const parsedResult = override as TurnResult;
      await runVoidHook(
        hookPlugins,
        'onTurnCompleted',
        {
          fullResponse,
          persistedContent,
          structuredResults,
          turnResult: parsedResult,
          ctx,
        },
        hooks
      );
      return parsedResult;
    }
  }

  // ── 10. Delegate to IOutputHandler ────────────────────────────────────────
  const turnResult: TurnResult = { text: persistedContent, done: false };
  await plugins.outputHandler.handle(turnResult, ctx);

  await runVoidHook(
    hookPlugins,
    'onTurnCompleted',
    {
      fullResponse,
      persistedContent,
      structuredResults,
      turnResult,
      ctx,
    },
    hooks
  );

  return turnResult;
}

function isAbortError(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'AbortError' || err.message.includes('aborted');
  }
  return false;
}

async function runVoidHook<T extends keyof IOrchestratorHookPlugin>(
  hookPlugins: IOrchestratorHookPlugin[],
  hookName: T,
  payload: unknown,
  hooks: OrchestratorContext['hooks']
): Promise<void> {
  for (const plugin of hookPlugins) {
    const hook = plugin[hookName];
    if (typeof hook !== 'function') continue;
    try {
      await (hook as (p: typeof payload) => Promise<void> | void)(payload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitLog(hooks, 'warn', `[plugin:${plugin.name}] Hook ${String(hookName)} failed: ${message}`);
    }
  }
}

async function runBeforePersistMessageHooks(
  hookPlugins: IOrchestratorHookPlugin[],
  payload: BeforePersistAssistantMessageHookPayload,
  hooks: OrchestratorContext['hooks']
): Promise<string> {
  let persistedContent = payload.persistedContent;

  for (const plugin of hookPlugins) {
    const hook = plugin.onBeforePersistAssistantMessage;
    if (typeof hook !== 'function') continue;
    try {
      const maybeNext = await hook({ ...payload, persistedContent });
      if (typeof maybeNext === 'string') {
        persistedContent = maybeNext;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      emitLog(
        hooks,
        'warn',
        `[plugin:${plugin.name}] Hook onBeforePersistAssistantMessage failed: ${message}`
      );
    }
  }

  return persistedContent;
}
