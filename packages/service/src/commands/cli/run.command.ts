import path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { ChatCommandEmitter } from '../../orchestrator/services/emit-service.js';
import { withTimeout } from '../../utils/with-timeout.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function normalizeExecutableName(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(' ') || trimmed.includes('/') || trimmed.includes('\\')) return undefined;
  return trimmed.toLowerCase();
}

export interface RunCliParams {
  command: string;
  args?: string[];
  cwd?: string;
}

export interface RunCliResult {
  command: string;
  args: string[];
  cwd: string;
  stdout: string;
  stderr?: string;
}

async function runCommand(
  params: RunCliParams,
  workspaceRoot: string,
  allowedCommands?: string[]
): Promise<RunCliResult> {
  const { command, args = [], cwd } = params;
  const normalized = normalizeExecutableName(command);
  if (!normalized) {
    throw new Error('Invalid command name. Provide executable only (for example: git).');
  }

  if (allowedCommands !== undefined) {
    const allowed = new Set(
      allowedCommands.map((e) => normalizeExecutableName(e)).filter(Boolean) as string[]
    );
    if (!allowed.has(normalized)) {
      throw new Error(
        `Command '${normalized}' is not registered. Register it first with register_cli.`
      );
    }
  }

  const execCwd = cwd ? path.resolve(workspaceRoot, cwd) : workspaceRoot;
  if (!path.resolve(execCwd).startsWith(path.resolve(workspaceRoot))) {
    throw new Error('cwd must stay inside the workspace root.');
  }

  const result = (await withTimeout(
    execFileAsync(normalized, args, {
      cwd: execCwd,
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 8,
    }),
    60_000,
    `run timed out after 60s (${normalized})`
  )) as { stdout?: string; stderr?: string };

  return {
    command: normalized,
    args,
    cwd: execCwd,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim() || undefined,
  };
}

/** Tool version: structured params, LLM-callable, requires allowlist via register_cli. */
export class RunCliTool {
  readonly name = 'run';
  readonly key = 'run';
  readonly group = 'tool';
  readonly availableIn = { chat: false, tool: true };
  readonly description =
    'Execute an allowed command-line tool with args. Command must be registered first via register_cli.';
  readonly parameters = z.object({
    command: z.string().min(1).describe('Executable name, for example git'),
    args: z
      .array(z.string())
      .optional()
      .describe('Command arguments as array, for example ["status", "--short"]'),
    cwd: z
      .string()
      .optional()
      .describe('Optional relative working directory (defaults to workspace root)'),
  });

  constructor(private readonly workspaceRoot: string) {}

  formatForLlm(result: unknown): unknown {
    const r = result as RunCliResult;
    const cmd = `$ ${r.command}${r.args?.length ? ' ' + r.args.join(' ') : ''}`;
    const out = r.stdout?.trim() || '(no output)';
    const err = r.stderr?.trim();
    return err ? `${cmd}\n\n${out}\n\nstderr:\n${err}` : `${cmd}\n\n${out}`;
  }

  async execute(params: RunCliParams, context: ExecutionContext): Promise<RunCliResult> {
    return runCommand(params, this.workspaceRoot, context.agent!.cliTools ?? []);
  }
}
export const RunShellChatCommandMetadata = {
  key: 'run',
  usage: '/run <command> [args...]',
  aliases: ['shell'],
  description: 'Run a shell command → output shared with agent',
  availableIn: { chat: true, tool: false },
  group: 'chat',
} satisfies ICommandDescriptor;

export class RunShellChatCommand implements ICommand<string, void> {
  readonly metadata = RunShellChatCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitter: ChatCommandEmitter
  ) {}

  async execute(args: string, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const [command, ...rest] = args.trim().split(/\s+/);
    if (!command) {
      this.emitter.write('Usage: /run <command> [args...]');
      return { status: 'error', message: 'Usage: /run <command> [args...]' };
    }

    this.emitter.write(`\n$ ${args.trim()}`);
    try {
      const result = await runCommand(
        { command, args: rest },
        this.workspaceRoot,
        (ctx.agent! as any)?.cliTools
      );
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n\n') || '(no output)';
      this.emitter.write(out);
      this.emitter.write('\n(Result not in context — use /context add to include it.)');
      return { status: 'ok', message: 'Command executed successfully.' };
    } catch (err: any) {
      this.emitter.write(`Command failed: ${err.message}`);
      return { status: 'error', message: `Command failed: ${err.message}` };
    }
  }
}
