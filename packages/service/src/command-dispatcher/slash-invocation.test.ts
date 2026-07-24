import { describe, expect, it } from 'vitest';
import { parseSlashInvocation, resolveSlashInvocation } from './slash-invocation.js';

describe('parseSlashInvocation', () => {
  it('preserves the argument tail used by JSON and positional command parsing', () => {
    expect(parseSlashInvocation('  /run   {"command":"git","args":["status",  "--short"]}  ')).toEqual({
      commandToken: 'run',
      rawArgs: '{"command":"git","args":["status",  "--short"]}',
      rawInput: '/run   {"command":"git","args":["status",  "--short"]}',
    });
  });
});

describe('resolveSlashInvocation', () => {
  const commands = [
    {
      key: 'help',
      group: 'system',
      aliases: ['help'],
      description: 'Show help',
      availableIn: { chat: true },
    },
    {
      key: 'switch',
      group: 'session',
      aliases: ['switch'],
      description: 'Switch agent',
      availableIn: { chat: true },
    },
    {
      key: 'return',
      group: 'session',
      aliases: ['return'],
      description: 'Return to the parent workflow',
      availableIn: { chat: true },
    },
    {
      key: 'handoff',
      group: 'com',
      aliases: ['ho', 'handoff'],
      description: 'Hand off the conversation',
      availableIn: { chat: true },
    },
    {
      key: 'review',
      group: 'chat',
      path: ['dynamic', 'skill'],
      description: 'Dynamic skill',
      availableIn: { chat: true },
    },
  ] as any;

  it('resolves grouped built-in commands and preserves only their argument tail', () => {
    expect(resolveSlashInvocation('/system help topic', commands)).toMatchObject({
      commandKey: 'system-help',
      commandToken: 'system help',
      rawArgs: 'topic',
      canonicalInvocation: '/system help',
    });
  });

  it('resolves declared aliases but rejects legacy bare command keys', () => {
    expect(resolveSlashInvocation('/help topic', commands)).toMatchObject({
      commandKey: 'system-help',
      rawArgs: 'topic',
    });
    expect(resolveSlashInvocation('/switch michael', commands)).toMatchObject({
      commandKey: 'session-switch',
      rawArgs: 'michael',
    });
    expect(resolveSlashInvocation('/return', commands)).toMatchObject({
      commandKey: 'session-return',
      rawArgs: '',
    });
    expect(resolveSlashInvocation('/back', commands)).toBeUndefined();
    expect(resolveSlashInvocation('/helpful', commands)).toBeUndefined();
  });

  it('resolves the advertised /handoff alias', () => {
    expect(resolveSlashInvocation('/handoff alex-morgan Please take over the CLI discussion', commands)).toMatchObject({
      commandKey: 'com-handoff',
      commandToken: 'handoff',
      rawArgs: 'alex-morgan Please take over the CLI discussion',
      canonicalInvocation: '/com handoff',
    });
  });

  it('keeps dynamic commands as bare invocations', () => {
    expect(resolveSlashInvocation('/review src', commands)).toMatchObject({
      commandKey: 'chat-review',
      rawArgs: 'src',
      canonicalInvocation: '/review',
    });
  });
});
