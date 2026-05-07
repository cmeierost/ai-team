import type { ICommand, ChatMessage, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class ContextChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'context';
  readonly usage =
    '/context add [--message <id>] [--summarized [instruction]] | /context remove [--message <id>] | /context list | /context summarize [--message <id>] [--instruction <text>]';
  readonly description =
    'Manage LLM context visibility for persisted messages and tool results (hide/unhide/list/summarize)';
  readonly availableIn = { chat: true, tool: false };

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const tokenRegex = /"([^"]*)"|'([^']*)'|(\S+)/g;
    const tokens: string[] = [];
    let match = tokenRegex.exec(args);
    while (match) {
      tokens.push(match[1] ?? match[2] ?? match[3]);
      match = tokenRegex.exec(args);
    }

    const first = tokens[0]?.toLowerCase();
    const subCmd: 'add' | 'remove' | 'list' | 'summarize' =
      first === 'add' || first === 'remove' || first === 'list' || first === 'summarize'
        ? first
        : 'add';
    const argStart = first === subCmd ? 1 : 0;

    let messageId: number | undefined;
    let addSummaryInstruction: string | undefined;
    let summarizeInstruction: string | undefined;
    const positional: string[] = [];

    for (let i = argStart; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === '--message') {
        const next = tokens[i + 1];
        const parsed = Number.parseInt(next ?? '', 10);
        if (!Number.isFinite(parsed)) {
          write(ctx, 'Invalid --message value. Provide a numeric message id.');
          return;
        }
        messageId = parsed;
        i += 1;
        continue;
      }
      if (token === '--summarized') {
        const next = tokens[i + 1];
        if (next && !next.startsWith('--')) {
          addSummaryInstruction = next;
          i += 1;
        } else {
          addSummaryInstruction = '';
        }
        continue;
      }
      if (token === '--instruction') {
        const next = tokens[i + 1];
        if (!next || next.startsWith('--')) {
          write(ctx, 'Missing value for --instruction.');
          return;
        }
        summarizeInstruction = next;
        i += 1;
        continue;
      }
      positional.push(token);
    }

    const allMessages = await ctx.sessionManager.listSessionMessages(ctx.sessionId);

    const resolveTargetMessage = (): ChatMessage | undefined => {
      if (messageId !== undefined) {
        return allMessages.find((m) => m.id === messageId);
      }

      if (subCmd === 'add') {
        return [...allMessages]
          .reverse()
          .find((m) => !m.isHuman && !m.archived && m.hiddenFromLlm === true);
      }
      if (subCmd === 'remove') {
        return [...allMessages]
          .reverse()
          .find((m) => !m.isHuman && !m.archived && m.hiddenFromLlm !== true);
      }
      if (subCmd === 'summarize') {
        return [...allMessages].reverse().find((m) => !m.isHuman && !m.archived);
      }
      return undefined;
    };

    if (subCmd === 'list') {
      if (allMessages.length === 0) {
        write(ctx, 'No persisted messages in this session yet.');
        return;
      }

      write(ctx, `\n─── Context messages (${allMessages.length}) ─────────────────────────────`);
      for (const m of allMessages) {
        const who = m.isHuman ? 'You' : (m.from ?? 'agent');
        const hiddenLabel = m.hiddenFromLlm ? 'hidden' : 'visible';
        const archivedLabel = m.archived ? 'archived' : 'active';
        const toolCount = m.tool_calls?.length ?? 0;
        const ts = m.timestamp ? new Date(m.timestamp).toLocaleString() : '?';
        write(
          ctx,
          `#${m.id ?? '?'}  ${ts}  ${who}  [${hiddenLabel}, ${archivedLabel}]${toolCount > 0 ? `  tools:${toolCount}` : ''}`
        );
        write(ctx, `    ${String(m.content).replaceAll('\n', ' ').slice(0, 180)}`);
        if (toolCount > 0) {
          for (const tc of m.tool_calls ?? []) {
            write(ctx, `    ↳ toolCall#${tc.id ?? '?'} ${tc.tool}`);
          }
        }
      }
      write(ctx, '──────────────────────────────────────────────────────────\n');
      return;
    }

    const target = resolveTargetMessage();
    if (!target || target.id == null) {
      write(
        ctx,
        messageId !== undefined
          ? `Message #${messageId} was not found in this session.`
          : 'No matching message found for this operation.'
      );
      return;
    }
    const targetId = target.id;

    const summarizeTargetAsync = async (instruction?: string): Promise<string> => {
      const toolCall = [...(target.tool_calls ?? [])].reverse().find((tc) => tc.id != null);
      const sourceText = toolCall
        ? (toolCall.resultLlm ??
          (toolCall.result != null ? JSON.stringify(toolCall.result, null, 2) : target.content))
        : target.content;

      const clipped = sourceText.length > 24_000 ? `${sourceText.slice(0, 24_000)}\n...[clipped]` : sourceText;

      const summary = await ctx.sessionManager.summarizeForContextAsync(
        ctx.llmService,
        clipped,
        200,
        instruction?.trim() || undefined
      );

      if (toolCall?.id != null) {
        await ctx.sessionManager.updateToolCallLlmResult(toolCall.id, summary.trim());
      } else {
        await ctx.sessionManager.updateMessageContent(targetId, summary.trim());
      }

      return summary.trim();
    };

    if (subCmd === 'remove') {
      if (target.hiddenFromLlm) {
        write(ctx, `Message #${targetId} is already hidden from LLM context.`);
        return;
      }
      await ctx.sessionManager.setMessageHiddenFromLlm(targetId, true);
      ctx.history = await ctx.sessionManager.getSessionMessages(ctx.sessionId);
      write(ctx, `Message #${targetId} is now hidden from LLM context.`);
      return;
    }

    if (subCmd === 'summarize') {
      const positionalInstruction = positional.join(' ').trim();
      const instruction = (summarizeInstruction ?? positionalInstruction) || undefined;
      const summary = await summarizeTargetAsync(instruction);
      ctx.history = await ctx.sessionManager.getSessionMessages(ctx.sessionId);
      write(ctx, `Summary saved for message #${targetId}:\n\n${summary}`);
      return;
    }

    if (addSummaryInstruction !== undefined) {
      const fallbackInstruction = positional.join(' ').trim();
      const summary = await summarizeTargetAsync(addSummaryInstruction || fallbackInstruction || undefined);
      await ctx.sessionManager.setMessageHiddenFromLlm(targetId, false);
      ctx.history = await ctx.sessionManager.getSessionMessages(ctx.sessionId);
      write(ctx, `Message #${targetId} added to LLM context with summary:\n\n${summary}`);
      return;
    }

    if (target.hiddenFromLlm !== true) {
      write(ctx, `Message #${targetId} is already included in LLM context.`);
      return;
    }

    await ctx.sessionManager.setMessageHiddenFromLlm(targetId, false);
    ctx.history = await ctx.sessionManager.getSessionMessages(ctx.sessionId);
    write(ctx, `Message #${targetId} added back to LLM context.`);
  }
}
