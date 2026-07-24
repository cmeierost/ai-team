import path from 'node:path';
import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
  IConfigurationStorage,
  IEmitService,
} from '@ai-team/core';
import { withTimeout } from '../../utils/with-timeout.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const WINDOWS_CMD_META_CHARS = /([()\][%!^"`<>&|;, *?])/g;

function normalizeExecutableName(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) return undefined;
  if (trimmed.includes(' ') || trimmed.includes('/') || trimmed.includes('\\')) return undefined;
  return trimmed.toLowerCase();
}

function escapeWindowsCmdCommand(value: string): string {
  return value.replace(WINDOWS_CMD_META_CHARS, '^$1');
}

function escapeWindowsCmdArgument(value: string, doubleEscapeMetaChars: boolean): string {
  let escaped = value
    .replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    .replace(/(?=(\\+?)?)\1$/, '$1$1');
  escaped = `"${escaped}"`.replace(WINDOWS_CMD_META_CHARS, '^$1');
  return doubleEscapeMetaChars
    ? escaped.replace(WINDOWS_CMD_META_CHARS, '^$1')
    : escaped;
}

async function resolveWindowsCommandShim(
  command: string,
  cwd: string
): Promise<string | undefined> {
  try {
    const result = (await execFileAsync('where.exe', [command], {
      cwd,
      windowsHide: true,
    })) as { stdout?: string };
    return (result.stdout ?? '')
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find((entry) => /\.(?:cmd|bat)$/i.test(entry));
  } catch {
    return undefined;
  }
}

async function executeCommand(
  command: string,
  args: string[],
  cwd: string,
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
): Promise<{ stdout?: string; stderr?: string; exitCode: number }> {
  const options = {
    cwd,
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8,
  };

  if (process.platform === 'win32') {
    const shim = await resolveWindowsCommandShim(command, cwd);
    if (shim) {
      const doubleEscapeMetaChars = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(shim);
      const shellCommand = [
        escapeWindowsCmdCommand(shim),
        ...args.map((arg) => escapeWindowsCmdArgument(arg, doubleEscapeMetaChars)),
      ].join(' ');
      const commandProcessor = process.env.ComSpec ?? process.env.COMSPEC ?? 'cmd.exe';
      return executeFileWithStreaming(
        commandProcessor,
        ['/d', '/s', '/c', `"${shellCommand}"`],
        {
          ...options,
          windowsVerbatimArguments: true,
        },
        onOutput
      );
    }
  }

  return executeFileWithStreaming(command, args, options, onOutput);
}

function executeFileWithStreaming(
  file: string,
  args: string[],
  options: {
    cwd: string;
    windowsHide: boolean;
    maxBuffer: number;
    windowsVerbatimArguments?: boolean;
  },
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
): Promise<{ stdout?: string; stderr?: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { ...options, encoding: 'utf8' },
      (error, stdout, stderr) => {
        const errorCode = (error as { code?: unknown } | null)?.code;
        if (error && typeof errorCode !== 'number') {
          reject(error);
          return;
        }
        resolve({
          stdout,
          stderr,
          exitCode: typeof errorCode === 'number' ? errorCode : 0,
        });
      }
    );
    child.stdout?.on('data', (chunk: string | Buffer) => {
      const text = String(chunk);
      if (text) onOutput?.('stdout', text);
    });
    child.stderr?.on('data', (chunk: string | Buffer) => {
      const text = String(chunk);
      if (text) onOutput?.('stderr', text);
    });
  });
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
  exitCode: number;
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
  allowedCommands?: string[],
  onOutput?: (stream: 'stdout' | 'stderr', text: string) => void
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
    executeCommand(normalized, args, execCwd, onOutput),
    60_000,
    `run timed out after 60s (${normalized})`
  )) as { stdout?: string; stderr?: string; exitCode: number };

  return {
    command: normalized,
    args,
    cwd: execCwd,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim() || undefined,
    exitCode: result.exitCode,
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

function createCommandOutputEmitter(
  context: ExecutionContext,
  emitService: IEmitService | undefined,
  invocation: string
): (stream: 'stdout' | 'stderr', text: string) => void {
  const correlation = context.commandInvocation;
  const emit = (
    type: 'command_output_start' | 'command_output_delta',
    text: string,
    outputStream?: 'stdout' | 'stderr'
  ) => {
    if (!correlation || !emitService) return;
    emitService.toolEvent(
      correlation.toolName,
      correlation.callId,
      'start',
      undefined,
      undefined,
      {
        toolName: correlation.toolName,
        outcome: 'start',
        resultLlm: {
          type,
          ...(outputStream ? { stream: outputStream } : {}),
          text,
        },
      }
    );
  };

  emit('command_output_start', `${invocation}\n\n`);
  return (stream, text) => emit('command_output_delta', text, stream);
}

/** Structured, LLM-callable surface. Authorization is enforced by ToolManager and cliTools. */
export class RunCliTool implements ICommand<RunCliParams, RunCliResult> {
  readonly metadata = RunCliToolMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly emitService?: IEmitService
  ) {}

  formatForLlm(result: unknown): unknown {
    const response = result as CommandResponse<RunCliResult>;
    const r = response.data ?? (result as RunCliResult);
    const cmd = `$ ${r.command}${r.args?.length ? ' ' + r.args.join(' ') : ''}`;
    const out = r.stdout?.trim() || '(no output)';
    const err = r.stderr?.trim();
    const rendered = err ? `${cmd}\n\n${out}\n\nstderr:\n${err}` : `${cmd}\n\n${out}`;
    return r.exitCode
      ? `${rendered}\n\nCommand exited with code ${r.exitCode}.`
      : rendered;
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
    const invocation = `$ ${params.command}${params.args?.length ? ` ${params.args.join(' ')}` : ''}`;
    const result = await runCommand(
      params,
      this.workspaceRoot,
      allowedCommands,
      createCommandOutputEmitter(context, this.emitService, invocation)
    );
    return result.exitCode === 0
      ? {
          status: 'ok',
          message: 'Command executed successfully.',
          data: result,
        }
      : {
          status: 'error',
          message: `Command exited with code ${result.exitCode}.`,
          data: result,
        };
  }
}

export const RunShellChatCommandMetadata = {
  key: 'run',
  usage: '/chat run <command> [args...]',
  aliases: ['run', 'shell'],
  description: 'Run a shell command → output shared with agent',
  availableIn: { chat: true, tool: false },
  group: 'chat',
  parameters: RunCliParamsSchema,
  input: {
    mode: 'structured',
    variadicParameter: 'args',
    jsonSignature: true,
  },
  help: {
    examples: [{ value: 'git status', surfaces: ['chat'] }],
  },
} satisfies ICommandDescriptor;

export class RunShellChatCommand implements ICommand<RunCliParams, RunCliResult> {
  readonly metadata = RunShellChatCommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly configurationStorage: IConfigurationStorage,
    private readonly emitService?: IEmitService
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
        getGlobalAllowedCommands(this.configurationStorage) ?? [],
        createCommandOutputEmitter(_ctx, this.emitService, invocation)
      );
      const out = [result.stdout, result.stderr].filter(Boolean).join('\n\n') || '(no output)';
      if (result.exitCode !== 0) {
        return {
          status: 'error',
          message: `${invocation}\n\n${out}\n\nCommand exited with code ${result.exitCode}.`,
          data: result,
        };
      }
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
