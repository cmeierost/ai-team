import type { ICommand, CommandResponse, ExecutionContext } from '@ai-team/core';

type IndexedToolCall = {
  msgTimestamp: string;
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  resultLlm: string | undefined;
  idx: number;
};

function formatJson(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return Object.prototype.toString.call(v);
  }
}

function formatToolCall(selected: IndexedToolCall): string {
  return [
    `\n─── Tool call #${selected.idx + 1}: ${selected.toolName} ────────────────────`,
    `Params:\n${formatJson(selected.params)}`,
    `\nResult (LLM context):\n${formatJson(selected.resultLlm ?? selected.result)}`,
    `\nResult (raw):\n${formatJson(selected.result)}`,
    '─────────────────────────────────────────────────────────────\n',
  ].join('\n');
}

export class InspectChatCommand implements ICommand<string, string> {
  readonly key = 'inspect';
  readonly usage = '/inspect [n]';
  readonly description = 'Inspect raw tool-call results from this session (select from list)';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
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
      return { status: 'ok', message: 'No tool calls found in this session.' };
    }

    const argNum = Number.parseInt(args.trim(), 10);
    let selected: IndexedToolCall | undefined;

    if (!Number.isNaN(argNum) && argNum >= 1 && argNum <= allCalls.length) {
      selected = allCalls[argNum - 1];
    } else if (ctx.questionSelect) {
      const choices = allCalls.map((tc, i) => ({
        name: `${i + 1}) ${tc.toolName}  [${new Date(tc.msgTimestamp).toLocaleTimeString()}]`,
        value: String(i),
      }));
      const picked = await ctx.questionSelect({
        message: `Select a tool call to inspect (${allCalls.length} total):`,
        choices,
        default: '0',
      });
      selected = allCalls[Number.parseInt(picked, 10)];
    } else {
      selected = allCalls.at(-1);
    }

    if (!selected) {
      return { status: 'error', message: 'Invalid selection.' };
    }

    const output = formatToolCall(selected);
    return { status: 'ok', message: output, data: output };
  }
}
