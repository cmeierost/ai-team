import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

export class InspectChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'inspect';
  readonly usage = '/inspect [n]';
  readonly description = 'Inspect raw tool-call results from this session (select from list)';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
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

    const argNum = Number.parseInt(args.trim(), 10);
    let selected: IndexedToolCall;

    if (!Number.isNaN(argNum) && argNum >= 1 && argNum <= allCalls.length) {
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
      selected = allCalls[Number.parseInt(picked, 10)];
    } else {
      selected = allCalls.at(-1)!;
    }

    if (!selected) {
      write(ctx, 'Invalid selection.');
      return;
    }

    const formatJson = (v: unknown): string => {
      try {
        return JSON.stringify(v, null, 2);
      } catch {
        return Object.prototype.toString.call(v);
      }
    };

    write(ctx, `\n─── Tool call #${selected.idx + 1}: ${selected.toolName} ────────────────────`);
    write(ctx, `Params:\n${formatJson(selected.params)}`);
    write(ctx, `\nResult (LLM context):\n${formatJson(selected.resultLlm ?? selected.result)}`);
    write(ctx, `\nResult (raw):\n${formatJson(selected.result)}`);
    write(ctx, '─────────────────────────────────────────────────────────────\n');
  }
}
