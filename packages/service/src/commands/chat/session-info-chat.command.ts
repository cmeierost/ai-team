import { getEffectiveContextWindow } from '@ai-team/core';
import type { IContextService } from '@ai-team/api-contracts';
import type { ICommand, ChatSession, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class SessionInfoChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'session';
  readonly usage = '/session [messages|graph|context]';
  readonly description = 'Show session info; subcommands: messages, graph, context';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(
    private readonly contextService: Pick<IContextService, 'getContextEstimate'>
  ) {}

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const sub = args.trim().toLowerCase();

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

    if (sub === 'graph') {
      let chain: ChatSession[];
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
      const childrenOf = new Map<string, ChatSession[]>();
      for (const s of chain) {
        if (s.previousSessionId) {
          const kids = childrenOf.get(s.previousSessionId) ?? [];
          kids.push(s);
          childrenOf.set(s.previousSessionId, kids);
        }
      }

      const roots = chain.filter((s) => !s.previousSessionId);

      const printSessionNode = (s: ChatSession, indent: number): void => {
        const prefix = '  '.repeat(indent);
        const marker = s.id === ctx.sessionId ? ' ← current' : '';
        const agentLabel = (s.agentIds?.length ? s.agentIds : [s.agentId]).filter(Boolean).join(', ');
        const msgCount = s.messageCount ?? '?';
        const lastActivity = s.lastActivityAt ? new Date(s.lastActivityAt).toLocaleString() : '?';
        write(
          ctx,
          `${prefix}${s.id.slice(0, 8)}…  agent: ${agentLabel}  msgs: ${msgCount}  last: ${lastActivity}${marker}`
        );
        for (const child of childrenOf.get(s.id) ?? []) {
          printSessionNode(child, indent + 1);
        }
      };

      for (const root of roots) {
        printSessionNode(root, 0);
      }
      write(ctx, '──────────────────────────────────────────────────────────\n');
      return;
    }

    if (sub === 'context') {
      let estimate: import('../../routers/meta-service.js').ContextEstimateResponse;
      try {
        estimate = (await this.contextService.getContextEstimate(ctx.agent.id, {
          sessionId: ctx.sessionId,
        })) as import('../../routers/meta-service.js').ContextEstimateResponse;
      } catch (err) {
        write(ctx, `Failed to estimate context: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }

      let modelName: string | undefined;
      let contextWindowTokens: number | undefined;
      try {
        await ctx.llmService.initializeForChat(ctx.agent);
        modelName = (ctx.llmService as any).modelName;
        const teamConfig = await ctx.configurationStorage.loadEffectiveConfigAsync(ctx.workspaceRoot);
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

      const systemChars = estimate.segments
        .filter((x) => !['messages', 'tool_results', 'session_skills'].includes(x.key))
        .reduce((s, x) => s + x.chars, 0);
      const msgChars = estimate.messages.reduce((s, m) => s + m.chars + m.toolChars, 0);
      const skillChars = estimate.sessionSkills.filter((s) => !s.paused).reduce((s, sk) => s + sk.chars, 0);
      const total = estimate.totalChars;

      write(ctx, '\n─── Context estimate ───────────────────────────────────────');
      write(ctx, `  System prompt   ${kb(systemChars).padStart(7)}  (${pct(systemChars, total)})`);
      if (skillChars > 0) {
        write(ctx, `  Session skills  ${kb(skillChars).padStart(7)}  (${pct(skillChars, total)})`);
      }
      if (msgChars > 0) {
        const toolCharsTotal = estimate.messages.reduce((s, m) => s + m.toolChars, 0);
        const msgNote = toolCharsTotal > 0 ? `  incl. ${kb(toolCharsTotal)} tool data` : '';
        write(ctx, `  Messages        ${kb(msgChars).padStart(7)}  (${pct(msgChars, total)})${msgNote}`);
      }
      write(ctx, `  ${'─'.repeat(44)}`);
      write(ctx, `  Total           ${kb(total).padStart(7)}  (~${Math.round(total / 4).toLocaleString()} tokens)`);

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

    const session = await ctx.sessionManager.getSession(ctx.sessionId);
    const msgs = ctx.history;
    const toolCallCount = msgs.reduce((n, m) => n + (m.tool_calls?.length ?? 0), 0);
    const lastMsg = msgs.at(-1);
    const lastMsgTime = lastMsg?.timestamp ? new Date(lastMsg.timestamp).toLocaleString() : 'none';
    const title = session?.title ?? '(untitled)';

    write(ctx, `\nSession  : ${ctx.sessionId}`);
    write(ctx, `Title    : ${title}`);
    write(ctx, `Messages : ${msgs.length}`);
    write(ctx, `Tool calls: ${toolCallCount}`);
    write(ctx, `Last msg : ${lastMsgTime}\n`);
  }
}
