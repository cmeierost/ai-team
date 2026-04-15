/**
 * Default slash-command implementations registered via TOKENS.SlashCommands.
 * Each ISlashCommand has access to OrchestratorContext and can mutate ctx fields.
 *
 * /back is intentionally NOT here — it needs the navStack maintained in chat.ts.
 */

import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { ISlashCommand } from './pipeline.js';
import type { OrchestratorContext, NavStackEntry } from './pipeline-context.js';
import { emitLog } from './stream-events.js';

import { developerNameToId } from '../utils/git.js';

const execAsync = promisify(exec);

// ── Helpers ───────────────────────────────────────────────────────────────────

function write(ctx: OrchestratorContext, msg: string): void {
  emitLog(ctx.hooks, 'info', msg);
}

// ── Command implementations ────────────────────────────────────────────────────

/**
 * Registry entry shape used by CLI, API client, and web surfaces.
 * Derived from ISlashCommand objects — descriptions stay next to implementations.
 */
export interface ChatCommandRegistryEntry {
  key: string;
  usage: string;
  description: string;
  llmCallable: boolean;
  aliases?: string[];
}

export function buildDefaultSlashCommands(): ISlashCommand[] {
  return [
    // ── Meta ───────────────────────────────────────────────────────────────────
    {
      key: 'help',
      description: 'Show this help',
      execute: async function (_args, ctx) {
        const cmds = buildDefaultSlashCommands();
        const lines = ['\nAvailable commands:\n'];
        for (const c of cmds) {
          const u = c.usage ?? `/${c.key}`;
          lines.push(`  ${u.padEnd(26)} ${c.description}`);
        }
        // Special entries handled outside the orchestrator
        lines.push(`  ${'#<tool> <json>'.padEnd(26)} Run a direct tool call`);
        lines.push(`  ${'exit'.padEnd(26)} End the session`);
        write(ctx, lines.join('\n'));
      },
    },

    {
      key: 'who',
      description: 'Show current agent name and session',
      llmCallable: false,
      execute: async (_args, ctx) => {
        write(ctx, `\nAgent   : ${ctx.agent.name} (${ctx.agent.role}) [${ctx.agent.id}]`);
        write(ctx, `Session : ${ctx.sessionId}\n`);
      },
    },

    {
      key: 'session',
      usage: '/session [messages|graph|context]',
      description: 'Show session info; subcommands: messages, graph, context',
      llmCallable: false,
      execute: async (args, ctx) => {
        const sub = args.trim().toLowerCase();

        // ── /session messages ─────────────────────────────────────────────
        if (sub === 'messages') {
          const msgs = ctx.history;
          if (msgs.length === 0) {
            write(ctx, 'No messages in this session.');
            return;
          }
          write(ctx, `\n─── Session messages (${msgs.length}) ─────────────────────────────`);
          for (let i = 0; i < msgs.length; i++) {
            const m = msgs[i];
            const who = m.isHuman ? 'You' : (m.from ?? 'agent');
            const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '?';
            const toolSuffix = m.tool_calls?.length ? ` [${m.tool_calls.length} tool call(s)]` : '';
            write(ctx, `[${i + 1}] ${ts}  ${who}${toolSuffix}`);
            write(ctx, `    ${String(m.content).replaceAll('\n', ' ').slice(0, 200)}`);
          }
          write(ctx, '──────────────────────────────────────────────────────────\n');
          return;
        }

        // ── /session graph ────────────────────────────────────────────────
        if (sub === 'graph') {
          let chain: import('@ai-team/core').ChatSession[];
          try {
            chain = await ctx.sessionManager.getSessionChain(ctx.sessionId);
          } catch {
            write(ctx, 'Failed to load session chain.');
            return;
          }

          if (chain.length === 0) {
            write(ctx, 'No session chain found.');
            return;
          }

          write(ctx, '\n─── Session handoff graph ──────────────────────────────────');
          const childrenOf = new Map<string, import('@ai-team/core').ChatSession[]>();
          for (const s of chain) {
            if (s.previousSessionId) {
              const kids = childrenOf.get(s.previousSessionId) ?? [];
              kids.push(s);
              childrenOf.set(s.previousSessionId, kids);
            }
          }

          const roots = chain.filter((s) => !s.previousSessionId);

          function printSessionNode(s: import('@ai-team/core').ChatSession, indent: number): void {
            const prefix = '  '.repeat(indent);
            const marker = s.id === ctx.sessionId ? ' ← current' : '';
            const agentLabel = (s.agentIds?.length ? s.agentIds : [s.agentId])
              .filter(Boolean)
              .join(', ');
            const msgCount = s.messageCount ?? '?';
            const lastActivity = s.lastActivityAt
              ? new Date(s.lastActivityAt).toLocaleString()
              : '?';
            write(
              ctx,
              `${prefix}${s.id.slice(0, 8)}…  agent: ${agentLabel}  msgs: ${msgCount}  last: ${lastActivity}${marker}`
            );
            for (const child of childrenOf.get(s.id) ?? []) {
              printSessionNode(child, indent + 1);
            }
          }

          for (const root of roots) {
            printSessionNode(root, 0);
          }
          write(ctx, '──────────────────────────────────────────────────────────\n');
          return;
        }

        // ── /session context ──────────────────────────────────────────────
        if (sub === 'context') {
          const { MetaService } = await import('../routers/meta-service.js');
          const { loadEffectiveConfig, getEffectiveContextWindow } =
            await import('@ai-team/infrastructure');
          const metaService = new MetaService(
            ctx.agentManager,
            ctx.sessionManager,
            ctx.skillManager,
            ctx.toolManager
          );
          let estimate: import('../routers/meta-service.js').ContextEstimateResponse;
          try {
            estimate = (await metaService.getContextEstimate(ctx.agent.id, {
              sessionId: ctx.sessionId,
            })) as import('../routers/meta-service.js').ContextEstimateResponse;
          } catch (err) {
            write(
              ctx,
              `Failed to estimate context: ${err instanceof Error ? err.message : String(err)}`
            );
            return;
          }

          // Resolve active model name and its context window (in tokens).
          // chars ÷ 4 is the standard approximation for token count.
          let modelName: string | undefined;
          let contextWindowTokens: number | undefined;
          try {
            await ctx.llmService.initializeForChat(ctx.agent);
            modelName = ctx.llmService.modelName;
            const teamConfig = await loadEffectiveConfig(ctx.workspaceRoot);
            if (teamConfig) {
              const registry = (teamConfig as any).providers as
                | Record<
                    string,
                    {
                      contextWindow?: number;
                      models?: Array<{ name: string; contextWindow?: number }>;
                    }
                  >
                | undefined;
              if (registry) {
                for (const providerCfg of Object.values(registry)) {
                  const w = getEffectiveContextWindow(providerCfg, modelName);
                  if (w !== undefined) {
                    contextWindowTokens = w;
                    break;
                  }
                }
              }
            }
          } catch {
            // model info unavailable — show estimate only
          }

          const kb = (n: number) => `${(n / 1000).toFixed(1)}k`;
          const pct = (part: number, total: number) => `${Math.round((part / total) * 100)}%`;

          // Summarise segments into groups
          // Exclude message/tool segments (shown separately) and session_skills (shown on their own line)
          const systemChars = estimate.segments
            .filter((x) => !['messages', 'tool_results', 'session_skills'].includes(x.key))
            .reduce((s, x) => s + x.chars, 0);
          const msgChars = estimate.messages.reduce((s, m) => s + m.chars + m.toolChars, 0);
          const skillChars = estimate.sessionSkills
            .filter((s) => !s.paused)
            .reduce((s, sk) => s + sk.chars, 0);
          const total = estimate.totalChars;

          write(ctx, '\n─── Context estimate ───────────────────────────────────────');
          write(
            ctx,
            `  System prompt   ${kb(systemChars).padStart(7)}  (${pct(systemChars, total)})`
          );
          if (skillChars > 0) {
            write(
              ctx,
              `  Session skills  ${kb(skillChars).padStart(7)}  (${pct(skillChars, total)})`
            );
          }
          if (msgChars > 0) {
            const toolCharsTotal = estimate.messages.reduce((s, m) => s + m.toolChars, 0);
            const msgNote = toolCharsTotal > 0 ? `  incl. ${kb(toolCharsTotal)} tool data` : '';
            write(
              ctx,
              `  Messages        ${kb(msgChars).padStart(7)}  (${pct(msgChars, total)})${msgNote}`
            );
          }
          write(ctx, `  ${'─'.repeat(44)}`);
          write(
            ctx,
            `  Total           ${kb(total).padStart(7)}  (~${Math.round(total / 4).toLocaleString()} tokens)`
          );

          if (contextWindowTokens !== undefined && modelName) {
            const usedTokens = Math.round(total / 4);
            const freeTokens = contextWindowTokens - usedTokens;
            const usedPct = Math.round((usedTokens / contextWindowTokens) * 100);
            const freePct = 100 - usedPct;
            write(ctx, '');
            write(ctx, `  Model           ${modelName}`);
            write(ctx, `  Window          ${(contextWindowTokens / 1000).toFixed(0)}k tokens`);
            write(ctx, `  Used            ${(usedTokens / 1000).toFixed(1)}k  (${usedPct}%)`);
            write(ctx, `  Free            ${(freeTokens / 1000).toFixed(1)}k  (${freePct}%)`);
          }
          write(ctx, '──────────────────────────────────────────────────────────\n');
          return;
        }

        // ── /session (default: info) ──────────────────────────────────────
        const session = await ctx.sessionManager.getSession(ctx.sessionId);
        const msgs = ctx.history;
        const toolCallCount = msgs.reduce((n, m) => n + (m.tool_calls?.length ?? 0), 0);
        const lastMsg = msgs.at(-1);
        const lastMsgTime = lastMsg?.timestamp
          ? new Date(lastMsg.timestamp).toLocaleString()
          : 'none';
        const title = session?.title ?? '(untitled)';

        write(ctx, `\nSession  : ${ctx.sessionId}`);
        write(ctx, `Title    : ${title}`);
        write(ctx, `Messages : ${msgs.length}`);
        write(ctx, `Tool calls: ${toolCallCount}`);
        write(ctx, `Last msg : ${lastMsgTime}\n`);
      },
    },

    // ── Session management ─────────────────────────────────────────────────────
    {
      key: 'new',
      description: 'Start a new session with the current agent',
      llmCallable: false,
      execute: async (_args, ctx) => {
        const developerId = developerNameToId('developer');
        const fresh = await ctx.sessionManager.createSession(ctx.agent.id, developerId);
        (ctx as any).sessionId = fresh.id;
        (ctx as any).history = [];
        write(ctx, `New session started: ${fresh.id}`);
        emitLog(ctx.hooks, 'info', `[session_switched] ${fresh.id}`);
        ctx.hooks?.emit?.({ kind: 'session_switched', sessionId: fresh.id });
      },
    },

    // ── Team ───────────────────────────────────────────────────────────────────
    {
      key: 'list',
      description: 'List all team members',
      llmCallable: true,
      execute: async (_args, ctx) => {
        const result = await ctx.toolManager.execute(
          ctx.agent,
          'team_list',
          {},
          { agentId: ctx.agent.id, workspaceRoot: ctx.workspaceRoot }
        );

        if (!result.ok) {
          write(ctx, `Unable to list team members: ${result.error ?? 'unknown error'}`);
          return;
        }

        const payload = result.result as {
          members?: Array<{ agentId: string; agentName: string; agentRole: string }>;
        };
        const members = payload.members ?? [];
        if (members.length === 0) {
          write(ctx, 'No agents found.');
          return;
        }

        write(ctx, '\nTeam members:');
        for (const member of members) {
          const marker = member.agentId === ctx.agent.id ? '  ← you are here' : '';
          write(ctx, `  ${member.agentName} (${member.agentRole}) [${member.agentId}]${marker}`);
        }
        write(ctx, '');
      },
    },

    {
      key: 'chat',
      usage: '/chat <name|role>',
      description: 'Switch to another team member',
      llmCallable: false,
      execute: async (args, ctx) => {
        const query = args.trim();
        if (!query) {
          write(ctx, 'Usage: /chat <name|role>');
          return;
        }

        const matches = await ctx.agentManager.resolveAgentAsync(query);
        if (matches.length === 0) {
          write(ctx, `No agent found matching: "${query}"`);
          return;
        }

        const target = matches.find((a) => a.id !== ctx.agent.id) ?? matches[0];
        if (target.id === ctx.agent.id) {
          write(ctx, `Already talking to ${ctx.agent.name}.`);
          return;
        }

        const current = await ctx.sessionManager.getSession(ctx.sessionId);
        const devId = (current as any)?.developerId ?? developerNameToId('developer');
        const ts = await ctx.sessionManager.getOrCreateLatestSession(target.id, devId);
        const hist = await ctx.sessionManager.getSessionMessages(ts.id);

        (ctx as any).agent = target;
        (ctx as any).sessionId = ts.id;
        (ctx as any).history = hist;
        write(ctx, `\nSwitched to ${target.name} (${target.role})\n`);
      },
    },

    // ── History ────────────────────────────────────────────────────────────────
    {
      key: 'history',
      usage: '/history [n]',
      description: 'Show recent messages (default: 20)',
      llmCallable: false,
      execute: async (args, ctx) => {
        const limit = parseInt(args.trim(), 10) || 20;
        const msgs = ctx.history.slice(-limit);
        if (msgs.length === 0) {
          write(ctx, 'No messages in this session.');
          return;
        }
        write(ctx, `\n─── Last ${msgs.length} messages ─────────────────────────────────`);
        for (const m of msgs) {
          const who = m.isHuman ? 'You' : ctx.agent.name;
          const ts = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '?';
          write(ctx, `[${ts}] ${who}: ${String(m.content).slice(0, 300)}`);
        }
        write(ctx, '──────────────────────────────────────────────────────────\n');
      },
    },

    // ── Agent info ─────────────────────────────────────────────────────────────
    {
      key: 'portfolio',
      aliases: ['bio'],
      description: "Show current agent's bio and tools",
      llmCallable: false,
      execute: async (_args, ctx) => {
        const a = ctx.agent;
        write(ctx, `\n${a.name} (${a.role}).`);
        if ((a as any).bio) write(ctx, '\n' + (a as any).bio);
        if ((a as any).tools?.length) write(ctx, '\nTools: ' + (a as any).tools.join(', '));
        write(ctx, '');
      },
    },

    {
      key: 'info',
      usage: '/info <employee>',
      description: 'Show team member info',
      llmCallable: true,
      execute: async (args, ctx) => {
        const query = args.trim();
        if (!query) {
          write(ctx, 'Usage: /info <name|role>');
          return;
        }
        const agents = await ctx.agentManager.resolveAgentAsync(query);
        if (agents.length === 0) {
          write(ctx, `No agent found matching: "${query}"`);
          return;
        }
        for (const a of agents) {
          write(ctx, `\n${a.name} (${a.role}) [${a.id}]`);
          if ((a as any).bio) write(ctx, (a as any).bio);
          if ((a as any).tools?.length) write(ctx, 'Tools: ' + (a as any).tools.join(', '));
        }
        write(ctx, '');
      },
    },

    // ── Delegation commands (call the existing service commands) ───────────────
    {
      key: 'hire',
      description: 'Interactive: hire a new team member',
      llmCallable: true,
      execute: async (_args, ctx) => {
        const { hireCommand } = await import('../commands/hire.js');
        await hireCommand(ctx.workspaceRoot, {});
        await ctx.agentManager.refreshAsync();
      },
    },

    {
      key: 'fire',
      usage: '/fire <employee>',
      description: 'Interactive: remove a team member',
      llmCallable: true,
      execute: async (args, ctx) => {
        if (!args.trim()) {
          write(ctx, 'Usage: /fire <name|id>');
          return;
        }
        const { fireCommand } = await import('../commands/fire.js');
        await fireCommand(ctx.workspaceRoot, args.trim(), {});
        await ctx.agentManager.refreshAsync();
      },
    },

    {
      key: 'create',
      usage: '/create [employee|skill]',
      description: 'Interactive: create an agent or skill',
      llmCallable: true,
      execute: async (args, ctx) => {
        const type = (args.trim() || 'agent').split(/\s+/)[0];
        const { createCommand } = await import('../commands/create.js');
        await createCommand(ctx.workspaceRoot, type, { interactive: true });
        await ctx.agentManager.refreshAsync();
      },
    },

    {
      key: 'init',
      description: 'Interactive: (re-)initialize workspace',
      llmCallable: false,
      execute: async (_args, ctx) => {
        const { initCommand } = await import('../commands/init.js');
        await initCommand(ctx.workspaceRoot, {});
        await ctx.agentManager.refreshAsync();
      },
    },

    {
      key: 'hh',
      usage: '/hh refresh',
      description: 'Refresh skill catalog from GitHub',
      llmCallable: true,
      execute: async (args, ctx) => {
        const sub = args.trim().toLowerCase();
        if (sub !== 'refresh') {
          write(ctx, 'Usage: /hh refresh');
          return;
        }
        const { hhRefreshCommand } = await import('../commands/hh.js');
        await (hhRefreshCommand as (wr: string) => Promise<void>)(ctx.workspaceRoot);
      },
    },

    {
      key: 'test-connection',
      description: 'Test LLM provider connectivity',
      llmCallable: true,
      execute: async (_args, ctx) => {
        const { testConnectionCommand } = await import('../commands/test-connection.js');
        await testConnectionCommand(ctx.workspaceRoot, {});
      },
    },

    // ── Workspace ──────────────────────────────────────────────────────────────
    {
      key: 'overview',
      description: 'Workspace file overview → shared with agent',
      llmCallable: false,
      execute: async (_args, ctx) => {
        const { getWorkspaceOverview } = await import('../utils/workspace.js');
        const overview = await getWorkspaceOverview(ctx.workspaceRoot);
        write(ctx, '\n── Workspace Overview ──────────────────────────────────────\n');
        write(ctx, overview);
        const sysMsg = {
          timestamp: new Date().toISOString(),
          from: 'system' as const,
          content: `Tool Output (overview):\n${overview.slice(0, 4_000)}`,
        };
        await ctx.sessionManager.appendMessage(ctx.sessionId, sysMsg);
        ctx.history.push(sysMsg);
        write(ctx, `\n(Overview shared with ${ctx.agent.name}.)\n`);
      },
    },

    {
      key: 'graph',
      description: 'Team hierarchy diagram',
      llmCallable: true,
      execute: async (_args, ctx) => {
        try {
          const { getTeamGraphCommand } = await import('../commands/graph.js');
          const g = await (
            getTeamGraphCommand as (
              wr: string,
              type: string
            ) => Promise<{ nodes: unknown[]; edges: unknown[] }>
          )(ctx.workspaceRoot, 'hierarchy');
          write(ctx, `\nTeam graph — ${g.nodes.length} nodes, ${g.edges.length} edges\n`);
        } catch (err) {
          write(
            ctx,
            `Failed to generate graph: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      },
    },

    // ── Shell ──────────────────────────────────────────────────────────────────
    {
      key: 'run',
      usage: '/run <command>',
      aliases: ['shell'],
      description: 'Run a shell command → shared with agent',
      llmCallable: false,
      execute: async (args, ctx) => {
        if (!args.trim()) {
          write(ctx, 'Usage: /run <command>');
          return;
        }

        write(ctx, `\n$ ${args.trim()}`);
        try {
          const { stdout, stderr } = await execAsync(args.trim(), {
            cwd: ctx.workspaceRoot,
            maxBuffer: 4 * 1024 * 1024,
          });
          const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n') || '(no output)';
          write(ctx, out);
          ctx.lastManualOutput = `Shell: ${args.trim()}\n\n${out}`;
          write(ctx, '\n(Result not in context — use /context add to include it.)');
        } catch (err: any) {
          const out = [err.stdout?.trim(), err.stderr?.trim(), err.message]
            .filter(Boolean)
            .join('\n');
          write(ctx, `Command failed:\n${out}`);
          ctx.lastManualOutput = `Shell: ${args.trim()}\n\nCommand failed:\n${out}`;
          write(ctx, '\n(Result not in context — use /context add to include it.)');
        }
      },
    },

    {
      key: 'tool',
      usage: '/tool <tool-name> [json-args]',
      description: 'Run a direct tool call and print the result',
      llmCallable: false,
      execute: async (args, ctx) => {
        const trimmed = args.trim();
        if (!trimmed) {
          write(ctx, 'Usage: /tool <tool-name> [json-args]');
          return;
        }

        const firstSpace = trimmed.indexOf(' ');
        const toolName = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace).trim();
        const rawJson = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

        if (!toolName) {
          write(ctx, 'Usage: /tool <tool-name> [json-args]');
          return;
        }

        let parsedArgs: unknown = {};
        if (rawJson) {
          try {
            parsedArgs = JSON.parse(rawJson);
          } catch (error) {
            write(
              ctx,
              `Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
          }
        }

        const result = await ctx.toolManager.execute(ctx.agent, toolName, parsedArgs, {
          agentId: ctx.agent.id,
          workspaceRoot: ctx.workspaceRoot,
        });

        if (!result.ok) {
          write(ctx, `Tool failed (${toolName}): ${result.error ?? 'unknown error'}`);
          return;
        }

        const pretty =
          typeof result.result === 'string'
            ? result.result
            : JSON.stringify(result.result, null, 2);

        write(ctx, `\nTool result (${toolName}):\n${pretty}`);
        ctx.lastManualOutput = `Tool: ${toolName}\n\n${pretty}`;
        write(ctx, '\n(Result not in context — use /context add to include it.)');
      },
    },
    // ── Navigation ──────────────────────────────────────────────────────────────
    {
      key: 'back',
      description: 'Return to previous agent in handoff chain',
      llmCallable: false,
      execute: async (_args, ctx) => {
        const navStack: NavStackEntry[] = ctx.navStack ?? [];
        if (navStack.length === 0) {
          write(ctx, 'No previous agent to return to.');
          return;
        }
        const prev = navStack.pop()!;
        const prevAgent = await ctx.agentManager.getAgentAsync(prev.agentId);
        if (!prevAgent) {
          emitLog(ctx.hooks, 'warn', `Previous agent ${prev.agentId} no longer found.`);
          return;
        }
        const prevHistory = await ctx.sessionManager.getSessionMessages(prev.sessionId);
        ctx.agent = prevAgent;
        ctx.sessionId = prev.sessionId;
        ctx.history = prevHistory;
        write(ctx, `\n← Returned to ${prevAgent.name} (${prevAgent.role})\n`);
      },
    },

    // ── Manual context control ────────────────────────────────────────────────
    {
      key: 'context',
      usage: '/context add [label] | /context edit [n] | /context summarize [n]',
      description:
        'Manage tool call context: add last /run result, edit or summarize a stored tool result',
      llmCallable: false,
      execute: async (args, ctx) => {
        const sub = args.trim().split(/\s+/);
        const subCmd = sub[0]?.toLowerCase();

        if (subCmd === 'add' || subCmd === '') {
          if (!ctx.lastManualOutput) {
            write(ctx, 'Nothing to add — run /run or /tool first.');
            return;
          }
          const label = sub.slice(1).join(' ').trim() || ctx.lastManualOutput.split('\n')[0];
          const sysMsg = {
            timestamp: new Date().toISOString(),
            from: 'system' as const,
            content: `User-provided context (${label}):\n${ctx.lastManualOutput.slice(0, 8_000)}`,
          };
          await ctx.sessionManager.appendMessage(ctx.sessionId, sysMsg);
          ctx.history.push(sysMsg);
          ctx.lastManualOutput = undefined;
          write(ctx, 'Added to context.');
          return;
        }

        if (subCmd === 'edit' || subCmd === 'summarize') {
          // Collect tool calls from history that have an id
          const allCalls: Array<{
            tc: import('@ai-team/core').ToolCall;
            msgIdx: number;
            tcIdx: number;
          }> = [];
          for (let mi = 0; mi < ctx.history.length; mi++) {
            const msg = ctx.history[mi];
            if (!msg.tool_calls?.length) continue;
            for (let ti = 0; ti < msg.tool_calls.length; ti++) {
              const tc = msg.tool_calls[ti];
              if (tc.id != null) allCalls.push({ tc, msgIdx: mi, tcIdx: ti });
            }
          }

          if (allCalls.length === 0) {
            write(ctx, 'No tool calls with stored results found in this session.');
            return;
          }

          // Resolve which call to target — numeric arg or interactive pick
          const argNum = parseInt(sub[1] ?? '', 10);
          let entry: (typeof allCalls)[number];

          if (!isNaN(argNum) && argNum >= 1 && argNum <= allCalls.length) {
            entry = allCalls[argNum - 1];
          } else if (ctx.hooks.questionSelect) {
            const choices = allCalls.map((e, i) => ({
              name: `${i + 1}) ${e.tc.tool}`,
              value: String(i),
            }));
            const picked = await ctx.hooks.questionSelect({
              message: `Select a tool call to ${subCmd} (${allCalls.length} total):`,
              choices,
              default: '0',
            });
            entry = allCalls[parseInt(picked, 10)];
          } else {
            entry = allCalls[allCalls.length - 1];
          }

          if (!entry) {
            write(ctx, 'No tool call selected.');
            return;
          }

          const currentText =
            entry.tc.resultLlm != null
              ? entry.tc.resultLlm
              : entry.tc.result != null
                ? JSON.stringify(entry.tc.result, null, 2)
                : '';

          if (subCmd === 'edit') {
            if (!ctx.hooks.questionInput) {
              write(ctx, 'Interactive input not available in this surface.');
              return;
            }
            const newText = await ctx.hooks.questionInput({
              message: `Edit result for tool "${entry.tc.tool}" (tool call id=${entry.tc.id}):`,
            });
            if (!newText.trim()) {
              write(ctx, 'Edit cancelled — empty input.');
              return;
            }
            await ctx.sessionManager.updateToolCallLlmResult(entry.tc.id!, newText.trim());
            ctx.history[entry.msgIdx].tool_calls![entry.tcIdx].resultLlm = newText.trim();
            write(ctx, `Tool call ${entry.tc.id} updated.`);
            return;
          }

          // subCmd === 'summarize'
          write(ctx, `Summarizing result for tool "${entry.tc.tool}"…`);
          const llm = ctx.llmService as {
            rawChat?: (
              systemPrompt: string,
              messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
              options?: { maxTokens?: number; temperature?: number }
            ) => Promise<string>;
          };

          if (typeof llm.rawChat !== 'function') {
            write(ctx, 'LLM not available for summarization.');
            return;
          }

          const clipped =
            currentText.length > 20_000
              ? `${currentText.slice(0, 20_000)}\n...[clipped]`
              : currentText;

          let summary: string;
          try {
            summary = await llm.rawChat(
              'Summarize this tool output faithfully and concisely. Keep key facts, counts, errors, and file paths. Do not invent details. Max 12 bullets.',
              [{ role: 'user', content: `Tool: ${entry.tc.tool}\n\n${clipped}` }],
              { maxTokens: 450, temperature: 0.1 }
            );
          } catch (err: unknown) {
            write(ctx, `Summarization failed: ${err instanceof Error ? err.message : String(err)}`);
            return;
          }

          summary = summary.trim();
          await ctx.sessionManager.updateToolCallLlmResult(entry.tc.id!, summary);
          ctx.history[entry.msgIdx].tool_calls![entry.tcIdx].resultLlm = summary;
          write(ctx, `Summary stored for tool call ${entry.tc.id}:\n\n${summary}`);
          return;
        }

        write(ctx, 'Usage: /context add [label] | /context edit [n] | /context summarize [n]');
      },
    },

    // ── Tool inspection ────────────────────────────────────────────────────────
    {
      key: 'inspect',
      usage: '/inspect [n]',
      description: 'Inspect raw tool-call results from this session (select from list)',
      llmCallable: false,
      execute: async (args, ctx) => {
        // Collect all tool calls from session history, oldest-first
        type IndexedToolCall = {
          msgTimestamp: string;
          toolName: string;
          params: Record<string, unknown>;
          result: unknown;
          resultLlm: string | undefined;
          idx: number;
        };

        const allCalls: IndexedToolCall[] = [];
        for (const msg of ctx.history) {
          if (!msg.tool_calls?.length) continue;
          for (const tc of msg.tool_calls) {
            allCalls.push({
              msgTimestamp: msg.timestamp,
              toolName: tc.tool,
              params: tc.params,
              result: tc.result,
              resultLlm: tc.resultLlm,
              idx: allCalls.length,
            });
          }
        }

        if (allCalls.length === 0) {
          write(ctx, 'No tool calls found in this session.');
          return;
        }

        // If a numeric index was provided, skip the selection step
        const argNum = parseInt(args.trim(), 10);
        let selected: IndexedToolCall;

        if (!isNaN(argNum) && argNum >= 1 && argNum <= allCalls.length) {
          selected = allCalls[argNum - 1];
        } else if (ctx.hooks.questionSelect) {
          const choices = allCalls.map((tc, i) => ({
            name: `${i + 1}) ${tc.toolName}  [${new Date(tc.msgTimestamp).toLocaleTimeString()}]`,
            value: String(i),
          }));

          const picked = await ctx.hooks.questionSelect({
            message: `Select a tool call to inspect (${allCalls.length} total):`,
            choices,
            default: '0',
          });
          selected = allCalls[parseInt(picked, 10)];
        } else {
          // fallback: show the latest one
          selected = allCalls[allCalls.length - 1];
        }

        if (!selected) {
          write(ctx, 'Invalid selection.');
          return;
        }

        const formatJson = (v: unknown): string => {
          try {
            return JSON.stringify(v, null, 2);
          } catch {
            return String(v);
          }
        };

        write(
          ctx,
          `\n─── Tool call #${selected.idx + 1}: ${selected.toolName} ────────────────────`
        );
        write(ctx, `Params:\n${formatJson(selected.params)}`);
        write(ctx, `\nResult (LLM context):\n${formatJson(selected.resultLlm ?? selected.result)}`);
        write(ctx, `\nResult (raw):\n${formatJson(selected.result)}`);
        write(ctx, '─────────────────────────────────────────────────────────────\n');
      },
    },
  ];
}

// ── Derived registry builders ─────────────────────────────────────────────────
// These let command-registry.ts (and downstream consumers) derive their
// flat registry lists from the single source of truth: the command objects above.

/**
 * Build the flat registry consumed by CLI, API client, and web.
 * Entries for /back and #tool (handled outside the orchestrator) are appended.
 */
export function buildChatCommandRegistry(): ChatCommandRegistryEntry[] {
  const cmds = buildDefaultSlashCommands();
  const entries: ChatCommandRegistryEntry[] = cmds.map((c) => ({
    key: c.key,
    usage: c.usage ?? `/${c.key}`,
    description: c.description,
    llmCallable: c.llmCallable ?? false,
    aliases: c.aliases,
  }));
  return entries;
}

/**
 * Build the alias → canonical-key map from registered command objects.
 */
export function buildChatCommandAliases(): Record<string, string> {
  const result: Record<string, string> = {};
  for (const cmd of buildDefaultSlashCommands()) {
    if (cmd.aliases) {
      for (const alias of cmd.aliases) {
        result[alias] = cmd.key;
      }
    }
  }
  return result;
}
