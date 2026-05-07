import { describe, expect, it, vi } from 'vitest';
import { checkPathRight, resolveWorkspacePathMeta } from './access-evaluation.js';

describe('resolveWorkspacePathMeta', () => {
  it('returns workspace-relative metadata for an in-workspace path', () => {
    const result = resolveWorkspacePathMeta('C:/workspace', 'docs/readme.md');

    expect(result.insideWorkspace).toBe(true);
    expect(result.relative).toBe('docs/readme.md');
    expect(result.absolute.replaceAll('\\', '/')).toBe('C:/workspace/docs/readme.md');
  });

  it('marks paths outside the workspace as outsideWorkspace', () => {
    const result = resolveWorkspacePathMeta('C:/workspace', '../secret.txt');

    expect(result.insideWorkspace).toBe(false);
    expect(result.relative).toBe('../secret.txt');
  });
});

describe('checkPathRight', () => {
  it('delegates to the matching permission-checker method', () => {
    const checker = {
      canReadPath: vi.fn().mockReturnValue(true),
      canWritePath: vi.fn().mockReturnValue(false),
      canListPath: vi.fn().mockReturnValue(false),
      assertCanReadPath: vi.fn(),
      assertCanWritePath: vi.fn(),
    };
    const permissions = { read: ['docs/**/*'], write: [] };

    const allowed = checkPathRight('C:/workspace', checker, permissions, 'docs/readme.md', 'read');

    expect(allowed).toBe(true);
    expect(checker.canReadPath).toHaveBeenCalledWith(
      'C:/workspace',
      permissions,
      'docs/readme.md'
    );
    expect(checker.canWritePath).not.toHaveBeenCalled();
    expect(checker.canListPath).not.toHaveBeenCalled();
  });
});