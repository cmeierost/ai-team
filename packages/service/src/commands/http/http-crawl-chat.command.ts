import type {
  ICommand,
  IToolManager,
  CommandResponse,
  ExecutionContext,
  ICommandDescriptor,
} from '@ai-team/core';
import { parseUrlAndJsonOptions } from './http-chat-utils.js';
export const HttpCrawlChatCommandMetadata = {
  key: 'crawl',
  aliases: ['http-crawl'],
  usage: '/crawl <url> [json-options]',
  description:
    'Crawl links via http_crawl and print extracted results (supports depth/page limits).',
  availableIn: { chat: true, tool: false },
  group: 'chat',
} satisfies ICommandDescriptor;

export class HttpCrawlChatCommand implements ICommand<string, string> {
  readonly metadata = HttpCrawlChatCommandMetadata;

  constructor(private readonly toolManager: IToolManager) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<string>> {
    const parsed = parseUrlAndJsonOptions(args);
    if (parsed.error === 'missing-url') {
      return { status: 'error', message: `Usage: ${this.metadata.usage}` };
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
