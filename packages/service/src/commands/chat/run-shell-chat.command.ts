import { promisify } from 'node:util';
import { exec } from 'node:child_process';
import type { ICommand, CommandRuntime } from '@ai-team/core';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';
import { write } from './shared-chat-commands.js';

const execAsync = promisify(exec);

export class RunShellChatCommand implements ICommand<string, OrchestratorContext, void> {
  readonly key = 'run';
  readonly usage = '/run <command>';
  readonly aliases = ['shell'];
  readonly description = 'Run a shell command → shared with agent';
  readonly availableIn = { chat: true, tool: false };

  async execute(args: string, ctx: OrchestratorContext, _runtime: CommandRuntime): Promise<void> {
    if (!args.trim()) {
      write(ctx, 'Usage: /run <command>');
      return;
    }

    write(ctx, `\n$ ${args.trim()}`);
    try {
      const { stdout, stderr } = await execAsync(args.trim(), {
        cwd: ctx.workspaceRoot,
        maxBuffer: 4 * 1024 * 1024,
      });
      const out = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n\n') || '(no output)';
      write(ctx, out);
      ctx.lastManualOutput = `Shell: ${args.trim()}\n\n${out}`;
      write(ctx, '\n(Result not in context — use /context add to include it.)');
    } catch (err: any) {
      const out = [err.stdout?.trim(), err.stderr?.trim(), err.message].filter(Boolean).join('\n');
      write(ctx, `Command failed:\n${out}`);
      ctx.lastManualOutput = `Shell: ${args.trim()}\n\nCommand failed:\n${out}`;
      write(ctx, '\n(Result not in context — use /context add to include it.)');
    }
  }
}
