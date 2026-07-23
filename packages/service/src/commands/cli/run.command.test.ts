import { describe, expect, it } from 'vitest';
import type { ExecutionContext, ICommand, IServiceContainer } from '@ai-team/core';
import { CommandDispatcher } from '../../command-dispatcher/command-dispatcher.js';
import { CommandRegistry } from '../../command-dispatcher/command-registry.js';
import {
  RunCliTool,
  RunCliToolMetadata,
  RunShellChatCommand,
  RunShellChatCommandMetadata,
} from './run.command.js';

describe('/run command', () => {
  it('declares structured variadic input for dispatcher normalization', () => {
    expect(RunShellChatCommandMetadata).toMatchObject({
      input: {
        mode: 'structured',
        variadicParameter: 'args',
        jsonSignature: true,
      },
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
    const tool = new RunCliTool(process.cwd(), configurationStorage);
    const context = {
      history: [],
      agent: { id: 'test-agent', cliTools: ['node'] },
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
  });
});
