import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

interface ToolCallChatCommandOptions {
  key?: string;
  usage?: string;
  description?: string;
  availableIn?: { chat?: boolean; tool?: boolean; cli?: boolean };
  presetToolName?: string;
}

export class ToolCallChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key: string;
  readonly usage: string;
  readonly description: string;
  readonly availableIn: { chat?: boolean; tool?: boolean; cli?: boolean };

  private readonly presetToolName?: string;

  constructor(options: ToolCallChatCommandOptions = {}) {
    this.key = options.key ?? 'tool';
    this.usage = options.usage ?? '/tool <tool-name> [json-args]';
    this.description = options.description ?? 'Run a direct tool call and print the result';
    this.availableIn = options.availableIn ?? { chat: true, tool: false };
    this.presetToolName = options.presetToolName;
  }

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    const trimmed = args.trim();
    if (!trimmed && !this.presetToolName) {
      write(ctx, 'Usage: /tool <tool-name> [json-args]');
      return;
    }

    let toolName: string;
    let rawJson = '';

    if (this.presetToolName) {
      toolName = this.presetToolName;
      rawJson = trimmed;
    } else {
      const firstSpace = trimmed.indexOf(' ');
      toolName = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace).trim();
      rawJson = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();
    }

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

    const result = await ctx.toolManager.execute(ctx.agent, toolName, parsedArgs, {
      agentId: ctx.agent.id,
      workspaceRoot: ctx.workspaceRoot,
    });

    if (!result.ok) {
      write(ctx, `Tool failed (${toolName}): ${result.error ?? 'unknown error'}`);
      return;
    }

    const pretty = typeof result.result === 'string' ? result.result : JSON.stringify(result.result, null, 2);

    write(ctx, `\nTool result (${toolName}):\n${pretty}`);
    ctx.lastManualOutput = `Tool: ${toolName}\n\n${pretty}`;
    write(ctx, '\n(Result not in context — use /context add to include it.)');
  }
}
