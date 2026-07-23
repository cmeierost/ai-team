import path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IConfigurationStorage,
} from '@ai-team/core';
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

export const RunCliParamsSchema = z.object({
  command: z.string().min(1).describe('Executable name, for example git'),
  args: z
    .array(z.string())
    .default([])
    .describe('Command arguments as an array, for example ["status", "--short"]'),
  cwd: z
    .string()
    .optional()
    .describe('Optional relative working directory (defaults to workspace root)'),
});

export const RunCliToolMetadata = {
  key: 'run',
  group: 'cli',
  availableIn: { chat: false, tool: true },
  description:
    'Execute an allowed command-line executable with an arbitrary argument array. The executable must be allowed for the agent.',
  parameters: RunCliParamsSchema,
} satisfies ICommandDescriptor;

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

function getGlobalAllowedCommands(
  configurationStorage: IConfigurationStorage
): string[] | undefined {
  const configured = configurationStorage.get('allowedCliTools');
  return Array.isArray(configured)
    ? configured.filter((value): value is string => typeof value === 'string')
    : undefined;
}

function getAgentAllowedCommands(
  configurationStorage: IConfigurationStorage,
  agentCommands: string[]
): string[] {
  const globalCommands = getGlobalAllowedCommands(configurationStorage);
  if (!globalCommands) {
    return agentCommands;
  }
  const globallyAllowed = new Set(
    globalCommands.map(normalizeExecutableName).filter(Boolean) as string[]
  );
  return agentCommands.filter((command) => {
    const normalized = normalizeExecutableName(command);
    return normalized ? globallyAllowed.has(normalized) : false;
  });
}

/** Structured, LLM-callable surface. Authorization is enforced by ToolManager and cliTools. */
export class RunCliTool implements ICommand<RunCliParams, RunCliResult> {
  readonly metadata = RunCliToolMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  formatForLlm(result: unknown): unknown {
    const response = result as CommandResponse<RunCliResult>;
    const r = response.data ?? (result as RunCliResult);
    const cmd = `$ ${r.command}${r.args?.length ? ' ' + r.args.join(' ') : ''}`;
    const out = r.stdout?.trim() || '(no output)';
    const err = r.stderr?.trim();
    return err ? `${cmd}\n\n${out}\n\nstderr:\n${err}` : `${cmd}\n\n${out}`;
  }

  async execute(
    params: RunCliParams,
    context: ExecutionContext
  ): Promise<CommandResponse<RunCliResult>> {
    if (!context.agent) {
      throw new Error('run requires an agent context.');
    }
    const allowedCommands = getAgentAllowedCommands(
      this.configurationStorage,
      context.agent.cliTools ?? []
    );
    const result = await runCommand(params, this.workspaceRoot, allowedCommands);
    return {
      status: 'ok',
      message: 'Command executed successfully.',
      data: result,
    };
  }
}

export const RunShellChatCommandMetadata = {
  key: 'run',
  usage: '/run <command> [args...]',
  aliases: ['shell'],
  description: 'Run a shell command → output shared with agent',
  availableIn: { chat: true, tool: false },
  group: 'chat',
  parameters: RunCliParamsSchema,
  input: {
    mode: 'structured',
    variadicParameter: 'args',
    jsonSignature: true,
  },
} satisfies ICommandDescriptor;

export class RunShellChatCommand implements ICommand<RunCliParams, RunCliResult> {
  readonly metadata = RunShellChatCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage
  ) {}

  async execute(
    params: RunCliParams,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<RunCliResult>> {
    const invocation = `$ ${params.command}${params.args?.length ? ` ${params.args.join(' ')}` : ''}`;
    try {
      const result = await runCommand(
        params,
        this.workspaceRoot,
        getGlobalAllowedCommands(this.configurationStorage) ?? []
      );
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n\n') || '(no output)';
      return {
        status: 'ok',
        message: `${invocation}\n\n${out}\n\n(Result not in context — use /context add to include it.)`,
        data: result,
      };
    } catch (err: any) {
      return {
        status: 'error',
        message: `${invocation}\n\nCommand failed: ${err.message}`,
      };
    }
  }
}
