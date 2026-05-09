import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

type DirectToolResult = {
  ok: boolean;
  error?: string;
  result?: unknown;
};

function parseUrlAndJsonOptions(args: string): {
  url?: string;
  options: Record<string, unknown>;
  error?: string;
} {
  const trimmed = args.trim();
  if (!trimmed) {
    return { options: {}, error: 'missing-url' };
  }

  const firstSpace = trimmed.indexOf(' ');
  const url = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).trim();
  const rawJson = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  if (!url) {
    return { options: {}, error: 'missing-url' };
  }

  if (!rawJson) {
    return { url, options: {} };
  }

  try {
    const parsed = JSON.parse(rawJson);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { url, options: {}, error: 'json-object-required' };
    }
    return { url, options: parsed as Record<string, unknown> };
  } catch (error) {
    return {
      url,
      options: {},
      error: `Invalid JSON args: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function executeDirectTool(
  ctx: OrchestratorContext,
  commandKey: string,
  toolName: string,
  usage: string,
  args: string
): Promise<void> {
  const parsed = parseUrlAndJsonOptions(args);
  if (parsed.error === 'missing-url') {
    write(ctx, `Usage: ${usage}`);
    return;
  }
  if (parsed.error === 'json-object-required') {
    write(ctx, 'JSON args must be an object, e.g. {"timeoutMs":12000}.');
    return;
  }
  if (parsed.error) {
    write(ctx, parsed.error);
    return;
  }

  const request = {
    url: parsed.url,
    ...parsed.options,
  };

  const result = (await ctx.toolManager.execute(ctx.agent, toolName, request, {
    agentId: ctx.agent.id,
    workspaceRoot: ctx.workspaceRoot,
  })) as DirectToolResult;

  if (!result.ok) {
    write(ctx, `Tool failed (${toolName}): ${result.error ?? 'unknown error'}`);
    return;
  }

  const pretty =
    typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);
  write(ctx, `\nTool result (${toolName}):\n${pretty}`);
  ctx.lastManualOutput = `/${commandKey} -> ${toolName}\n\n${pretty}`;
  write(ctx, '\n(Result not in context — use /context add to include it.)');
}

export class HttpFetchChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'fetch';
  readonly aliases = ['http-fetch'];
  readonly usage = '/fetch <url> [json-options]';
  readonly description =
    'Fetch a web page via http_fetch and print the extracted result (great before /context add).';
  readonly availableIn = { chat: true, tool: false };
  readonly group = 'chat';

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    await executeDirectTool(ctx, this.key, 'http_fetch', this.usage, args);
  }
}

export class HttpCrawlChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'crawl';
  readonly aliases = ['http-crawl'];
  readonly usage = '/crawl <url> [json-options]';
  readonly description =
    'Crawl links via http_crawl and print extracted results (supports depth/page limits).';
  readonly availableIn = { chat: true, tool: false };

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    await executeDirectTool(ctx, this.key, 'http_crawl', this.usage, args);
  }
}
