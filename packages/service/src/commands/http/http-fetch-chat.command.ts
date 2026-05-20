import type { ICommand, IToolManager, CommandResponse, ExecutionContext } from '@ai-team/core';
import { parseUrlAndJsonOptions } from './http-chat-utils.js';

export class HttpFetchChatCommand implements ICommand<string, string> {
  readonly key = 'fetch';
  readonly aliases = ['http-fetch'];
  readonly usage = '/fetch <url> [json-options]';
  readonly description =
    'Fetch a web page via http_fetch and print the extracted result (great before /context add).';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(private readonly toolManager: IToolManager) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const parsed = parseUrlAndJsonOptions(args);
    if (parsed.error === 'missing-url') {
      return { status: 'error', message: `Usage: ${this.usage}` };
    }
    if (parsed.error === 'json-object-required') {
      return { status: 'error', message: 'JSON args must be an object, e.g. {"timeoutMs":12000}.' };
    }
    if (parsed.error) {
      return { status: 'error', message: parsed.error };
    }

    const result = (await this.toolManager.execute(ctx.agent!, 'http_fetch', {
      url: parsed.url,
      ...parsed.options,
    })) as { ok?: boolean; error?: string; result?: unknown };

    if (!result.ok) {
      return {
        status: 'error',
        message: `Tool failed (http_fetch): ${result.error ?? 'unknown error'}`,
      };
    }

    const pretty =
      typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
    const message = `\nTool result (http_fetch):\n${pretty}\n\n(Result not in context — use /context add to include it.)`;
    return { status: 'ok', message, data: pretty };
  }
}
