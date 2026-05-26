import { describe, it, expect } from 'vitest';
import { tokenizeCommand, extractPaths, CommandRegistry, ToolRegistry } from './operations.js';
import type { CommandDescriptor, ToolDescriptor } from './operations.js';

describe('tokenizeCommand', () => {
  it('splits basic command', () => {
    expect(tokenizeCommand('cat file.txt')).toEqual(['cat', 'file.txt']);
  });

  it('handles quoted paths', () => {
    expect(tokenizeCommand('cat "my file.txt"')).toEqual(['cat', 'my file.txt']);
  });

  it('handles single-quoted paths', () => {
    expect(tokenizeCommand("cat 'my file.txt'")).toEqual(['cat', 'my file.txt']);
  });

  it('handles flags', () => {
    expect(tokenizeCommand('mkdir -p foo/bar')).toEqual(['mkdir', '-p', 'foo/bar']);
  });

  it('handles multiple spaces', () => {
    expect(tokenizeCommand('cat   file.txt')).toEqual(['cat', 'file.txt']);
  });

  it('returns empty for empty string', () => {
    expect(tokenizeCommand('')).toEqual([]);
  });
});

describe('extractPaths', () => {
  const catDescriptor: CommandDescriptor = {
    names: ['cat'],
    pathArgs: [{ right: 'read', extractor: { kind: 'positional', index: 0 } }],
  };

  const cpDescriptor: CommandDescriptor = {
    names: ['cp'],
    pathArgs: [
      { right: 'read', extractor: { kind: 'positional', index: 0 } },
      { right: 'write', extractor: { kind: 'positional', index: 1 } },
    ],
  };

  it('extracts positional path from cat', () => {
    const tokens = ['cat', 'src/foo.ts'];
    expect(extractPaths(catDescriptor, tokens)).toEqual([
      { path: 'src/foo.ts', right: 'read' },
    ]);
  });

  it('extracts two paths with different rights from cp', () => {
    const tokens = ['cp', 'src/a.ts', 'dest/b.ts'];
    expect(extractPaths(cpDescriptor, tokens)).toEqual([
      { path: 'src/a.ts', right: 'read' },
      { path: 'dest/b.ts', right: 'write' },
    ]);
  });

  it('skips flags for positional extraction', () => {
    const tokens = ['cp', '-r', 'src/', 'dest/'];
    expect(extractPaths(cpDescriptor, tokens)).toEqual([
      { path: 'src/', right: 'read' },
      { path: 'dest/', right: 'write' },
    ]);
  });

  it('extracts rest args', () => {
    const grepDesc: CommandDescriptor = {
      names: ['grep'],
      pathArgs: [{ right: 'read', extractor: { kind: 'rest', startIndex: 1 } }],
    };
    const tokens = ['grep', '-r', 'pattern', 'dir1/', 'dir2/'];
    expect(extractPaths(grepDesc, tokens)).toEqual([
      { path: 'dir1/', right: 'read' },
      { path: 'dir2/', right: 'read' },
    ]);
  });
});

describe('CommandRegistry', () => {
  it('registers and retrieves by name', () => {
    const reg = new CommandRegistry();
    const desc: CommandDescriptor = {
      names: ['cat', 'type'],
      pathArgs: [{ right: 'read', extractor: { kind: 'positional', index: 0 } }],
    };
    reg.register(desc);
    expect(reg.get('cat')).toBe(desc);
    expect(reg.get('type')).toBe(desc);
    expect(reg.has('cat')).toBe(true);
    expect(reg.has('unknown')).toBe(false);
  });
});

describe('ToolRegistry', () => {
  it('registers and retrieves by name', () => {
    const reg = new ToolRegistry();
    const desc: ToolDescriptor = {
      name: 'readFile',
      pathParams: [{ paramName: 'path', right: 'read' }],
    };
    reg.register(desc);
    expect(reg.get('readFile')).toBe(desc);
    expect(reg.has('readFile')).toBe(true);
    expect(reg.has('unknown')).toBe(false);
  });
});
