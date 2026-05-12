import type { ICommand, IToolManager, CommandResponse, ExecutionContext } from '@ai-team/core';
import { parseUrlAndJsonOptions } from './http-chat-utils.js';

export class HttpCrawlChatCommand implements ICommand<string, string> {
  readonly key = 'crawl';
  readonly aliases = ['http-crawl'];
  readonly usage = '/crawl <url> [json-options]';
  readonly description =
    'Crawl links via http_crawl and print extracted results (supports depth/page limits).';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  constructor(private readonly toolManager: IToolManager) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const parsed = parseUrlAndJsonOptions(args);
    if (parsed.error === 'missing-url') {
      return { status: 'error', message: `Usage: ${this.usage}` };
    }
    if (parsed.error === 'json-object-required') {
      return { status: 'error', message: 'JSON args must be an object, e.g. {"maxDepth":2}.' };
    }
    if (parsed.error) {
      return { status: 'error', message: parsed.error };
    }

    const result = (await this.toolManager.execute(ctx.agent!, 'http_crawl', {
      url: parsed.url,
      ...parsed.options,
    })) as { ok?: boolean; error?: string; result?: unknown };

    if (!result.ok) {
      return {
        status: 'error',
        message: `Tool failed (http_crawl): ${result.error ?? 'unknown error'}`,
      };
    }

    const pretty =
      typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
    const message = `\nTool result (http_crawl):\n${pretty}\n\n(Result not in context — use /context add to include it.)`;
    return { status: 'ok', message, data: pretty };
  }
}
