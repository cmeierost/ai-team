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
import { requestConfirm } from './question-io.js';
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
      execute: async function(_args, ctx) {
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
      description: 'Show session ID',
      llmCallable: false,
      execute: async (_args, ctx) => write(ctx, ctx.sessionId),
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
          { agentId: ctx.agent.id, workspaceRoot: ctx.workspaceRoot },
        );

        if (!result.ok) {
          write(ctx, `Unable to list team members: ${result.error ?? 'unknown error'}`);
          return;
        }

        const payload = result.result as {
          members?: Array<{ agentId: string; agentName: string; agentRole: string }>;
        };
        const members = payload.members ?? [];
        if (members.length === 0) { write(ctx, 'No agents found.'); return; }

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
        if (!query) { write(ctx, 'Usage: /chat <name|role>'); return; }

        const matches = await ctx.agentManager.resolveAgentAsync(query);
        if (matches.length === 0) { write(ctx, `No agent found matching: "${query}"`); return; }

        const target = matches.find(a => a.id !== ctx.agent.id) ?? matches[0];
        if (target.id === ctx.agent.id) { write(ctx, `Already talking to ${ctx.agent.name}.`); return; }

        const current = await ctx.sessionManager.getSession(ctx.sessionId);
        const devId   = (current as any)?.developerId ?? developerNameToId('developer');
        const ts      = await ctx.sessionManager.getOrCreateLatestSession(target.id, devId);
        const hist    = await ctx.sessionManager.getSessionMessages(ts.id);

        (ctx as any).agent     = target;
        (ctx as any).sessionId = ts.id;
        (ctx as any).history   = hist;
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
        const msgs  = ctx.history.slice(-limit);
        if (msgs.length === 0) { write(ctx, 'No messages in this session.'); return; }
        write(ctx, `\n─── Last ${msgs.length} messages ─────────────────────────────────`);
        for (const m of msgs) {
          const who = m.isHuman ? 'You' : ctx.agent.name;
          const ts  = m.timestamp ? new Date(m.timestamp).toLocaleTimeString() : '?';
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
        if ((a as any).bio)   write(ctx, '\n' + (a as any).bio);
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
        if (!query) { write(ctx, 'Usage: /info <name|role>'); return; }
        const agents = await ctx.agentManager.resolveAgentAsync(query);
        if (agents.length === 0) { write(ctx, `No agent found matching: "${query}"`); return; }
        for (const a of agents) {
          write(ctx, `\n${a.name} (${a.role}) [${a.id}]`);
          if ((a as any).bio)   write(ctx, (a as any).bio);
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
        if (!args.trim()) { write(ctx, 'Usage: /fire <name|id>'); return; }
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
        if (sub !== 'refresh') { write(ctx, 'Usage: /hh refresh'); return; }
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
          const g = await (getTeamGraphCommand as (wr: string, type: string) => Promise<{ nodes: unknown[]; edges: unknown[] }>)
            (ctx.workspaceRoot, 'hierarchy');
          write(ctx, `\nTeam graph — ${g.nodes.length} nodes, ${g.edges.length} edges\n`);
        } catch (err) {
          write(ctx, `Failed to generate graph: ${err instanceof Error ? err.message : String(err)}`);
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
        if (!args.trim()) { write(ctx, 'Usage: /run <command>'); return; }

        const ok = await requestConfirm(ctx.hooks, {
          message: `Run: ${args.trim()}?`,
          default: false,
        });
        if (!ok) { write(ctx, 'Aborted.'); return; }

        write(ctx, `\n$ ${args.trim()}`);
        try {
          const { stdout, stderr } = await execAsync(args.trim(), {
            cwd: ctx.workspaceRoot,
            maxBuffer: 4 * 1024 * 1024,
          });
          const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n') || '(no output)';
          write(ctx, out);

          const sysMsg = {
            timestamp: new Date().toISOString(),
            from: 'system' as const,
            content: `Tool Output (shell: ${args.trim()}):\n${out.slice(0, 4_000)}`,
          };
          await ctx.sessionManager.appendMessage(ctx.sessionId, sysMsg);
          ctx.history.push(sysMsg);
        } catch (err: any) {
          const out = [err.stdout?.trim(), err.stderr?.trim(), err.message].filter(Boolean).join('\n');
          write(ctx, `Command failed:\n${out}`);
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
            write(ctx, `Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`);
            return;
          }
        }

        const result = await ctx.toolManager.execute(
          ctx.agent,
          toolName,
          parsedArgs,
          { agentId: ctx.agent.id, workspaceRoot: ctx.workspaceRoot },
        );

        if (!result.ok) {
          write(ctx, `Tool failed (${toolName}): ${result.error ?? 'unknown error'}`);
          return;
        }

        const pretty = typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2);

        write(ctx, `\nTool result (${toolName}):\n${pretty}`);
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
  const entries: ChatCommandRegistryEntry[] = cmds.map(c => ({
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

