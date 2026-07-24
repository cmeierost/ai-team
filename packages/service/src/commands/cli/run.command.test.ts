import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext, ICommand, IServiceContainer } from '@ai-team/core';
import { CommandDispatcher } from '../../command-dispatcher/command-dispatcher.js';
import { CommandRegistry } from '../../command-dispatcher/command-registry.js';
import { resolveSlashInvocation } from '../../command-dispatcher/slash-invocation.js';
import {
  RunCliTool,
  RunCliToolMetadata,
  RunShellChatCommand,
  RunShellChatCommandMetadata,
} from './run.command.js';

describe('/run command', () => {
  it('declares structured variadic input for dispatcher normalization', () => {
    expect(RunShellChatCommandMetadata).toMatchObject({
      aliases: expect.arrayContaining(['run']),
      input: {
        mode: 'structured',
        variadicParameter: 'args',
        jsonSignature: true,
      },
    });
  });

  it.each([
    ['/run git status', 'git status'],
    ['/run pnpm --filter @ai-team/web storybook', 'pnpm --filter @ai-team/web storybook'],
  ])('resolves %s through the public chat alias', (input, rawArgs) => {
    expect(resolveSlashInvocation(input, [RunShellChatCommandMetadata])).toMatchObject({
      commandKey: 'chat-run',
      commandToken: 'run',
      rawArgs,
    });
  });

  it('executes positional input after dispatcher normalization', async () => {
    const configurationStorage = {
      get: (key: string) => (key === 'allowedCliTools' ? ['node'] : undefined),
    } as never;
    const command = new RunShellChatCommand(process.cwd(), configurationStorage);
    const registry = new CommandRegistry();
    registry.register(
      RunShellChatCommandMetadata,
      () => command as ICommand<unknown, unknown>
    );
    const resolver = {
      tryResolve: () => undefined,
    } as unknown as IServiceContainer;
    const dispatcher = new CommandDispatcher(registry, resolver);
    const context = {
      history: [],
      agent: { id: 'test-agent', cliTools: ['node'] },
    } as unknown as ExecutionContext;

    const result = await dispatcher.dispatch(
      'chat-run',
      'node -e "process.stdout.write(\'run-ok\')" first second third',
      context
    );

    expect(result.status).toBe('ok');
    expect(result.message).toContain('$ node -e');
    expect(result.message).toContain('run-ok');
    expect(result.message).toContain('Result not in context');
  });

  it('emits correlated slash output before the child process completes', async () => {
    let resolveFirstDelta: (() => void) | undefined;
    const firstDelta = new Promise<void>((resolve) => {
      resolveFirstDelta = resolve;
    });
    const toolEvent = vi.fn(
      (
        _toolName: string,
        _callId: string | undefined,
        _phase: string,
        _message: string | undefined,
        _denial: unknown,
        toolResult: { resultLlm?: { type?: string } }
      ) => {
        if (toolResult.resultLlm?.type === 'command_output_delta') {
          resolveFirstDelta?.();
        }
      }
    );
    const configurationStorage = {
      get: (key: string) => (key === 'allowedCliTools' ? ['node'] : undefined),
    } as never;
    const command = new RunShellChatCommand(
      process.cwd(),
      configurationStorage,
      { toolEvent } as never
    );
    let completed = false;

    const execution = command.execute(
      {
        command: 'node',
        args: [
          '-e',
          "process.stdout.write('first');setTimeout(()=>process.stdout.write('second'),100)",
        ],
      },
      {
        history: [],
        commandInvocation: { callId: 'run-1', toolName: 'slash:run' },
      } as unknown as ExecutionContext
    ).then((result) => {
      completed = true;
      return result;
    });

    await firstDelta;
    expect(completed).toBe(false);
    const result = await execution;
    expect(result.status).toBe('ok');
    expect(result.data?.stdout).toBe('firstsecond');
    expect(toolEvent).toHaveBeenCalledWith(
      'slash:run',
      'run-1',
      'start',
      undefined,
      undefined,
      expect.objectContaining({
        outcome: 'start',
        resultLlm: expect.objectContaining({ type: 'command_output_delta' }),
      })
    );
  });

  it('retains output and exit code when a command exits non-zero', async () => {
    const configurationStorage = {
      get: (key: string) => (key === 'allowedCliTools' ? ['node'] : undefined),
    } as never;
    const command = new RunShellChatCommand(process.cwd(), configurationStorage);

    const result = await command.execute(
      {
        command: 'node',
        args: ['-e', "process.stdout.write('usage text');process.exit(7)"],
      },
      { history: [] } as unknown as ExecutionContext
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('usage text');
    expect(result.message).toContain('exited with code 7');
    expect(result.data).toEqual(expect.objectContaining({
      stdout: 'usage text',
      exitCode: 7,
    }));
  });

  it.runIf(process.platform === 'win32')('executes an allowed Windows .cmd shim', async () => {
    const configurationStorage = {
      get: (key: string) => (key === 'allowedCliTools' ? ['pnpm'] : undefined),
    } as never;
    const command = new RunShellChatCommand(process.cwd(), configurationStorage);

    const result = await command.execute(
      { command: 'pnpm', args: ['--version'] },
      { history: [] } as unknown as ExecutionContext
    );

    expect(result.status).toBe('ok');
    expect(result.data?.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });

  it.runIf(process.platform === 'win32')(
    'passes command-shell metacharacters to a Windows .cmd shim as literal arguments',
    async () => {
      const configurationStorage = {
        get: (key: string) => (key === 'allowedCliTools' ? ['pnpm'] : undefined),
      } as never;
      const command = new RunShellChatCommand(process.cwd(), configurationStorage);

      const result = await command.execute(
        {
          command: 'pnpm',
          args: [
            'exec',
            'node',
            '-e',
            'process.stdout.write(process.argv[1])',
            'safe&echo INJECTED',
          ],
        },
        { history: [] } as unknown as ExecutionContext
      );

      expect(result.status).toBe('ok');
      expect(result.data?.stdout).toBe('safe&echo INJECTED');
    }
  );

  it('declares the structured agent tool surface as cli_run', () => {
    expect(RunCliToolMetadata).toMatchObject({
      key: 'run',
      group: 'cli',
      availableIn: { tool: true },
    });
    expect(RunCliToolMetadata.parameters.safeParse({ command: 'git', args: ['status'] }).success).toBe(
      true
    );
  });

  it('uses a complete human invocation as the /run completion example', () => {
    expect(RunShellChatCommandMetadata.help?.examples).toContainEqual({
      value: 'git status',
      surfaces: ['chat'],
    });
  });

  it('registers the agent tool with its derived cli_run name', () => {
    const registry = new CommandRegistry();

    expect(() =>
      registry.register(
        RunCliToolMetadata,
        () => ({ metadata: RunCliToolMetadata }) as ICommand<unknown, unknown>
      )
    ).not.toThrow();
    expect(registry.toLlmToolDefinitions()).toContainEqual(
      expect.objectContaining({
        name: 'cli_run',
        group: 'cli',
      })
    );
  });

  it('executes through the structured agent tool surface when both allowlists permit it', async () => {
    const configurationStorage = {
      get: (key: string) => (key === 'allowedCliTools' ? ['node'] : undefined),
    } as never;
    const toolEvent = vi.fn();
    const tool = new RunCliTool(
      process.cwd(),
      configurationStorage,
      { toolEvent } as never
    );
    const context = {
      history: [],
      agent: { id: 'test-agent', cliTools: ['node'] },
      commandInvocation: { callId: 'agent-run-1', toolName: 'cli_run' },
    } as unknown as ExecutionContext;

    const result = await tool.execute(
      {
        command: 'node',
        args: ['-e', "process.stdout.write(process.argv.slice(1).join('|'))", 'one', 'two'],
      },
      context
    );

    expect(result.status).toBe('ok');
    expect(result.data?.stdout).toBe('one|two');
    expect(toolEvent).toHaveBeenCalledWith(
      'cli_run',
      'agent-run-1',
      'start',
      undefined,
      undefined,
      expect.objectContaining({
        resultLlm: expect.objectContaining({ type: 'command_output_delta' }),
      })
    );
  });
});
