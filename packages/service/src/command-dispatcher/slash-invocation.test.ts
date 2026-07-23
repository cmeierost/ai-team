import { describe, expect, it } from 'vitest';
import { parseSlashInvocation } from './slash-invocation.js';

describe('parseSlashInvocation', () => {
  it('preserves the argument tail used by JSON and positional command parsing', () => {
    expect(parseSlashInvocation('  /run   {"command":"git","args":["status",  "--short"]}  ')).toEqual({
      commandToken: 'run',
      rawArgs: '{"command":"git","args":["status",  "--short"]}',
      rawInput: '/run   {"command":"git","args":["status",  "--short"]}',
    });
  });
});
