/**
 * Chat command — entry point for `ait chat`.
 *
 * This file is intentionally thin. Each cross-cutting service concern lives
 * in its own module inside this folder:
 *
 *   hooks.ts            — ChatRuntimeHooks interface (the caller's contract)
 *   async-utils.ts      — withTimeout / withAbortSignal / isAbortError
 *   emit.ts             — emitRuntimeEvent / writeInfo / writeWarn / writeError
 *   questions.ts        — requestInput / requestSelect
 *   forward-detection.ts — natural-language agent-switch detection
 *   agent-selection.ts  — selectDefaultTopAgent / formatUserPrompt
 */

import ora from 'ora';
import {
  AgentManager,
  ChatMessage,
  Agent,
  LlmService,
  SkillManager,
  loadSkill,
  loadEffectiveConfig,
  loadAllInstructionFiles,
} from '@ai-team/infrastructure';
import { ToolManager } from '../../tools/tool-manager.js';
import type { ChatOptions } from '@ai-team/api-client';
import { getGitUserName, developerNameToId } from '../../utils/git.js';
import { ensureUserEnvVars as ensureServiceUserEnvVars } from '../../utils/user-env.js';
import { SessionManager } from '../../session-manager.js';
import { createSqliteStorage } from '../../storage/index.js';
import { XStateChatOrchestrator } from '../../orchestrator/xstate-chat-orchestrator.js';
import { tryIntroduceUser as tryIntroduceUserNew } from '../../orchestrator/introduction.js';
import type { ResolvedPlugins } from '../../orchestrator/pipeline.js';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { createToolManager } from '../../tools/create-tool-manager.js';
import type { OrchestrationDeps } from '../../tools/create-tool-manager.js';
import { NoOpCompressor } from '../../orchestrator/defaults/context-compressor.js';
import { DefaultContextBuilder } from '../../orchestrator/defaults/context-builder.js';
import {
  WorkspaceOverviewEnricher,
  TeamRosterEnricher,
} from '../../orchestrator/defaults/context-enrichers.js';
import { NoOpRagProvider } from '../../orchestrator/defaults/rag-provider.js';
import { DefaultToolResolver } from '../../orchestrator/defaults/tool-resolver.js';
import { NoOpMcpGateway } from '../../orchestrator/defaults/mcp-gateway.js';
import { DefaultLlmSelector } from '../../orchestrator/defaults/llm-selector.js';
import { DefaultOutputHandler } from '../../orchestrator/defaults/output-handler.js';
import { buildDefaultHookPlugins } from '../../orchestrator/defaults/hook-plugins.js';
import { buildDefaultTurnResultParsers } from '../../orchestrator/defaults/turn-result-parsers.js';
import { buildDefaultSlashCommands } from '../../orchestrator/slash-commands.js';

// ── Service modules ───────────────────────────────────────────────────────────
export type { ChatRuntimeHooks } from './hooks.js';
export {
  emitRuntimeEvent,
  formatConsoleArgs,
  writeInfo,
  writeWarn,
  writeError,
  printSessionResume,
} from './emit.js';
export { requestInput, requestSelect } from './questions.js';

// ── Internal service imports (used by chatCommand but not re-exported) ────────
import type { ChatRuntimeHooks } from './hooks.js';
import {
  emitRuntimeEvent,
  formatConsoleArgs,
  writeInfo,
  writeWarn,
  writeError,
  printSessionResume,
} from './emit.js';
import {
  withTimeout,
  withAbortSignal,
  isAbortError,
  throwIfAborted,
} from '../../orchestrator/async-utils.js';
import { requestInput, requestSelect } from './questions.js';
import {
  selectDefaultTopAgent,
  formatUserPrompt,
  resolveDeveloperName,
} from '../../utils/agent-selection.js';

// ─────────────────────────────────────────────────────────────────────────────

const CHAT_CONNECT_TIMEOUT_MS = 20_000;
const PREFLIGHT_STEP_TIMEOUT_MS = 15_000;

/** Strip HANDOFF:/FORWARD_TO: directive lines from agent text before persisting. */
export function stripHandoffDirective(text: string): string {
  let cleaned = text.replaceAll(/\s*(?:HANDOFF|FORWARD_TO):\s*[^|\n]+(?:\s*\|\s*[^\n]*)?/gim, '');
  cleaned = cleaned.replaceAll(/\n{3,}/g, '\n\n').trim();
  return cleaned;
}

/**
 * Parse a HANDOFF: directive from agent response text.
 *
 * Matches: `HANDOFF: <agentId> | <optional note>`
 *          `FORWARD_TO: <agentId> | <optional note>`
 *
 * Returns the parsed fields, or null if no directive is present.
 */
export function parseHandoffDirective(
  text: string
): { targetAgentId: string; note: string } | null {
  // Allow spaces in the agent name — LLMs write "Emily Davis", not "emily-davis".
  const re =
    /(?:^|\n)\s*(?:HANDOFF|FORWARD_TO):\s*([^|\n]+?)\s*(?:\|\s*([^\n]*?))?\s*(?:$|\n)|\s+(?:HANDOFF|FORWARD_TO):\s*([^|\n]+?)\s*(?:\|\s*([^\n]*?))?\s*$/im;
  const match = re.exec(text);
  if (!match) return null;
  const target = (match[1] ?? match[3] ?? '').trim();
  const note = (match[2] ?? match[4] ?? '').trim();
  if (!target) return null;
  return {
    targetAgentId: target,
    note,
  };
}

export const CHAT_COMMAND_META = {
  description: 'Start a chat session with an agent (defaults to top-level manager if omitted)',
  llmCallable: false,
};

// ── Preflight helper (only used by chatCommand) ───────────────────────────────

async function runPreflightStep<T>(
  hooks: ChatRuntimeHooks | undefined,
  message: string,
  task: () => Promise<T>,
  timeoutMs: number = PREFLIGHT_STEP_TIMEOUT_MS
): Promise<T> {
  writeInfo(hooks, message);
  return withAbortSignal(
    withTimeout(task(), timeoutMs, `${message} timed out after ${Math.floor(timeoutMs / 1000)}s.`),
    hooks?.signal,
    `${message} aborted by user.`
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export async function chatCommand(
  workspaceRoot: string,
  agentId: string | undefined,
  options: ChatOptions,
  hooks: ChatRuntimeHooks = {}
) {
  const originalLog = console.log;
  const originalWarn = console.warn;
  const originalError = console.error;

  // Note: process.stdout.write is already patched by the invoke() wrapper in
  // AiTeamService when context.emit is present. Do NOT add a second patch here
  // — that would cause every token and log line to be emitted (and printed)
  // twice in the CLI. console.log/warn/error are safe to override because they
  // go through emitRuntimeEvent → hooks.emit into the same queue, but stdout
  // must only be patched once at the invoke level.
  if (hooks.emit) {
    console.log = (...args: unknown[]) =>
      emitRuntimeEvent(hooks, { kind: 'log', level: 'info', message: formatConsoleArgs(args) });
    console.warn = (...args: unknown[]) =>
      emitRuntimeEvent(hooks, { kind: 'log', level: 'warn', message: formatConsoleArgs(args) });
    console.error = (...args: unknown[]) =>
      emitRuntimeEvent(hooks, { kind: 'log', level: 'error', message: formatConsoleArgs(args) });
  }

  let sessionManager!: SessionManager;
  let currentSessionId!: string;

  try {
    const agentManager = new AgentManager(workspaceRoot);
    // Navigation stack for /back — each entry is the session we came FROM
    const navStack: Array<{ agentId: string; sessionId: string; agentName: string }> = [];

    sessionManager = new SessionManager(
      workspaceRoot,
      createSqliteStorage(workspaceRoot),
      agentManager
    );

    const loadSessionMessagesWithTiming = async (
      sessionId: string,
      reason: 'startup' | 'back-nav'
    ): Promise<ChatMessage[]> => {
      const startedAt = Date.now();
      const messages = await sessionManager.getSessionMessages(sessionId);
      const elapsedMs = Date.now() - startedAt;
      writeInfo(
        hooks,
        `[perf] loaded ${messages.length} message(s) for session ${sessionId} in ${elapsedMs}ms (${reason})`
      );
      return messages;
    };

    const loadHistory = async (currentAgentId: string): Promise<ChatMessage[]> => {
      if (options.sessionId) {
        currentSessionId = options.sessionId;
        return loadSessionMessagesWithTiming(options.sessionId, 'startup');
      }
      if (options.createNewSession) {
        const developerId = developerNameToId(developerName || 'developer');
        const newSession = await sessionManager.createSession(currentAgentId, developerId);
        currentSessionId = newSession.id;
        return [];
      }
      const latestSession = await sessionManager.getLatestSession(currentAgentId);
      if (latestSession) {
        currentSessionId = latestSession.id;
        return loadSessionMessagesWithTiming(latestSession.id, 'startup');
      }
      const developerId = developerNameToId(developerName || 'developer');
      const newSession = await sessionManager.createSession(currentAgentId, developerId);
      currentSessionId = newSession.id;
      return [];
    };

    const teamConfig = await runPreflightStep(hooks, 'Loading team configuration...', () =>
      loadEffectiveConfig(workspaceRoot)
    );
    const registry = teamConfig?.providers;
    const defaultProviderRef = registry
      ? teamConfig?.defaultModel?.provider && registry[teamConfig.defaultModel.provider]
        ? teamConfig.defaultModel.provider
        : (Object.entries(registry).find(([, cfg]) => cfg.defaultModel)?.[0] ??
          Object.keys(registry)[0])
      : undefined;
    const defaultProviderKind = defaultProviderRef
      ? registry?.[defaultProviderRef]?.kind
      : undefined;
    const requiresApiKey = defaultProviderKind
      ? defaultProviderKind === 'openai-compatible'
      : teamConfig?.llm?.provider === 'openai-compatible';
    const env = await runPreflightStep(hooks, 'Validating user environment...', () =>
      ensureServiceUserEnvVars(
        workspaceRoot,
        { developerName: true, apiKey: requiresApiKey },
        { quiet: true }
      )
    );
    const developerName = resolveDeveloperName(env) ?? getGitUserName();

    let resolvedAgent: Agent | undefined;

    if (!agentId || agentId.trim().length === 0) {
      const all = await agentManager.getAllAgentsAsync();
      resolvedAgent = selectDefaultTopAgent(all);
      if (!resolvedAgent) {
        writeError(hooks, 'No agents found in this workspace.');
        writeInfo(hooks, 'Run ait init to initialize your team.');
        throw new Error('No agents found in this workspace. Run ait init to initialize your team.');
      }
      writeInfo(
        hooks,
        `No agent specified; defaulting to ${resolvedAgent.name} (${resolvedAgent.role}).`
      );
    } else {
      const matches = await agentManager.resolveAgentAsync(agentId);
      if (matches.length === 0) {
        writeError(hooks, `Agent not found: "${agentId}"`);
        const all = await agentManager.getAllAgentsAsync();
        if (all.length > 0) {
          writeInfo(hooks, '');
          writeInfo(hooks, 'Available agents:');
          for (const a of all) writeInfo(hooks, `  - ${a.name} (${a.role}) [id: ${a.id}]`);
        }
        writeInfo(hooks, '');
        writeInfo(hooks, 'Run ait list to see all agents.');
        throw new Error(`Agent not found: "${agentId}"`);
      } else if (matches.length === 1) {
        resolvedAgent = matches[0];
      } else {
        const chosen = await requestSelect(hooks, {
          message: `Multiple agents match "${agentId}". Which one?`,
          choices: matches.map((a) => ({ name: `${a.name} — ${a.role} [${a.id}]`, value: a.id })),
        });
        resolvedAgent = await agentManager.getAgentAsync(chosen);
      }
    }

    if (!resolvedAgent) {
      writeError(hooks, 'Could not resolve agent.');
      throw new Error('Could not resolve agent.');
    }

    let agent: Agent = resolvedAgent;

    // Initialize LLM service
    const llm = new LlmService(workspaceRoot);
    const useSpinner = !hooks?.emit && Boolean(process.stderr.isTTY);
    const spinner = useSpinner ? ora('Connecting to LLM...').start() : undefined;
    if (!spinner) writeInfo(hooks, 'Connecting to LLM...');

    try {
      await withAbortSignal(
        withTimeout(
          llm.initialize(),
          CHAT_CONNECT_TIMEOUT_MS,
          `LLM initialization timed out after ${CHAT_CONNECT_TIMEOUT_MS / 1000}s.`
        ),
        hooks?.signal,
        'Chat connection aborted by user.'
      );
      if (spinner) {
        spinner.succeed(`Connected to ${llm.provider} using ${llm.modelName}`);
      } else {
        writeInfo(hooks, `Connected to ${llm.provider} using ${llm.modelName}`);
      }
      sessionManager.setAutoTitleLlmService(llm);
    } catch (error) {
      if (spinner) spinner.fail('Could not connect to configured LLM');
      writeError(hooks, (error as Error).message);
      writeInfo(hooks, 'Run "ait test-connection" to debug, or "ait init" to configure provider.');
      throw new Error((error as Error).message);
    }

    // Load skill instructions for the agent's role
    let skill;
    try {
      skill = await loadSkill(agent.skillPath);
      writeInfo(hooks, `Loaded skill: ${skill.name} (${agent.skillPath})`);
    } catch {
      writeInfo(hooks, `No skill file found for ${agent.role}, using agent portfolio only`);
    }

    // Load workspace instruction files
    const instructions = await loadAllInstructionFiles(workspaceRoot);
    if (instructions.length > 0) {
      writeInfo(hooks, `Loaded ${instructions.length} instruction file(s)`);
    }

    writeInfo(hooks, `\nChat with ${agent.name} (${agent.role})`);
    emitRuntimeEvent(hooks, {
      kind: 'agent_info',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      developerName: developerName ?? undefined,
    });
    writeInfo(hooks, 'Type "exit" to end the conversation');
    writeInfo(hooks, 'Type "/help" to see available in-chat commands');
    writeInfo(hooks, 'Ask to be forwarded or type "/chat <name>" to switch agents');
    writeInfo(hooks, 'Use "#tool_name {json}" or "/tool tool_name {json}" for direct tool calls');

    // Load chat history
    let history = await loadHistory(agent.id);
    if (history.length > 0) {
      printSessionResume(history, agent.name, developerName, hooks);
    }

    // Agent introduces themselves on first contact
    if (history.length === 0 && !options.pendingIntroduction) {
      await tryIntroduceUserNew({
        llm,
        agentManager,
        agent,
        history,
        skill,
        developerName,
        sessionManager,
        sessionId: currentSessionId,
        hooks,
      });
    }

    // Persist a web-client-generated introduction (keeps history ordering correct)
    if (options.pendingIntroduction && history.length === 0) {
      const introMsg: ChatMessage = {
        timestamp: new Date().toISOString(),
        from: agent.id,
        to: 'human',
        content: options.pendingIntroduction,
        importance: 'low',
      };
      if (sessionManager && currentSessionId) {
        await sessionManager.appendMessage(currentSessionId, introMsg);
      }
      history.push(introMsg);
    }

    // ── Build OrchestratorContext + ChatOrchestrator ─────────────────────────

    let chatToolManager: ToolManager;
    const toolDeps: OrchestrationDeps = {
      sessions: sessionManager,
      agents: agentManager,
      tools: {
        whoCanExecute: (toolName, args, agents) =>
          chatToolManager.whoCanExecute(toolName, args, agents),
        catalog: (agent) => chatToolManager.catalog(agent),
      },
    };
    chatToolManager = createToolManager(workspaceRoot, toolDeps);

    const skillManager = new SkillManager(workspaceRoot);
    const _plugins: ResolvedPlugins = {
      compressor: new NoOpCompressor(),
      contextBuilder: new DefaultContextBuilder(),
      enrichers: [new WorkspaceOverviewEnricher(), new TeamRosterEnricher()],
      ragProvider: new NoOpRagProvider(),
      toolResolver: new DefaultToolResolver(),
      mcpGateway: new NoOpMcpGateway(),
      llmSelector: new DefaultLlmSelector(),
      outputHandler: new DefaultOutputHandler(),
      slashCommands: buildDefaultSlashCommands(),
      turnResultParsers: buildDefaultTurnResultParsers(),
      hookPlugins: buildDefaultHookPlugins(),
    };

    const _ctx: OrchestratorContext = {
      agent,
      workspaceRoot,
      sessionId: currentSessionId,
      hooks,
      toolManager: chatToolManager,
      sessionManager,
      agentManager,
      skillManager,
      llmService: llm,
      history,
      instructions,
    };
    const _orchestrator = new XStateChatOrchestrator(_ctx, _plugins);

    // Single message mode
    if (options.message) {
      await withAbortSignal(
        _orchestrator.run({ message: options.message, contextFiles: options.context }),
        hooks.signal,
        'Chat request aborted by user.'
      );
      agent = _ctx.agent;
      currentSessionId = _ctx.sessionId;
      history = _ctx.history;
      if (options.oneShot) return;
    }

    // Interactive chat loop — CLI only; exit if no terminal input hook is available
    if (!hooks.questionInput) return;
    while (true) {
      throwIfAborted(hooks.signal, 'Chat request aborted by user.');

      const message = await withAbortSignal(
        requestInput(hooks, {
          message: formatUserPrompt(_ctx.agent, developerName),
          validate: (val: string) => val.length > 0 || 'Message cannot be empty',
        }),
        hooks.signal,
        'Chat input aborted by user.'
      );

      if (message.toLowerCase() === 'exit') {
        writeInfo(hooks, 'Goodbye!');
        process.exit(0);
      }

      // /back — handled here so it has access to the local navStack
      if (message.trim() === '/back') {
        if (navStack.length === 0) {
          writeWarn(hooks, 'No previous agent to return to.');
          writeInfo(hooks, '');
        } else {
          const prev = navStack.pop()!;
          const prevAgent = await agentManager.getAgentAsync(prev.agentId);
          if (!prevAgent) {
            writeError(hooks, `Previous agent ${prev.agentId} no longer found.`);
          } else {
            const prevHistory = await loadSessionMessagesWithTiming(prev.sessionId, 'back-nav');
            (_ctx as any).agent = prevAgent;
            (_ctx as any).sessionId = prev.sessionId;
            (_ctx as any).history = prevHistory;
            agent = prevAgent;
            currentSessionId = prev.sessionId;
            history = prevHistory;
            writeInfo(hooks, `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
          }
        }
        continue;
      }

      // Regular turn — delegate to ChatOrchestrator
      const prevAgentId = _ctx.agent.id;
      const prevSessionId = _ctx.sessionId;
      await withAbortSignal(
        _orchestrator.run({ message, contextFiles: options.context }),
        hooks.signal,
        'Chat request aborted by user.'
      );
      if (_ctx.agent.id !== prevAgentId) {
        navStack.push({ agentId: prevAgentId, sessionId: prevSessionId, agentName: prevAgentId });
        agent = _ctx.agent;
        currentSessionId = _ctx.sessionId;
        history = _ctx.history;
      }
    }
  } catch (error) {
    if (isAbortError(error)) {
      writeInfo(hooks, 'Chat aborted.');
      return;
    }
    writeError(hooks, `Error in chat: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error(error instanceof Error ? error.message : String(error));
  } finally {
    if (sessionManager) {
      try {
        await sessionManager.close();
      } catch {}
    }
    if (hooks.emit) {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    }
  }
}
