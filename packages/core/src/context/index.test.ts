import path from 'path';
import { describe, expect, it } from 'vitest';
import { ContextManager } from './index.js';
import { ContextLevel, PermissionError } from '../types/index.js';

describe('ContextManager', () => {
  const workspaceRoot = path.resolve('/workspace');
  const contextManager = new ContextManager(workspaceRoot);

  it('matches read and write permissions using workspace-relative paths', () => {
    const agent = {
      id: 'maya',
      permissions: {
        read: ['src/**/*', 'docs/**/*'],
        write: ['src/feature-a/**/*'],
      },
    } as any;

    const readablePath = path.join(workspaceRoot, 'src', 'feature-a', 'service.ts');
    const writablePath = path.join(workspaceRoot, 'src', 'feature-a', 'handler.ts');
    const blockedPath = path.join(workspaceRoot, 'tests', 'service.test.ts');

    expect(contextManager.canRead(agent, readablePath)).toBe(true);
    expect(contextManager.canWrite(agent, writablePath)).toBe(true);
    expect(contextManager.canRead(agent, blockedPath)).toBe(false);
    expect(contextManager.canWrite(agent, blockedPath)).toBe(false);
  });

  it('throws PermissionError when read/write assertions fail', () => {
    const agent = {
      id: 'jordan',
      permissions: {
        read: ['docs/**/*'],
        write: ['docs/**/*'],
      },
    } as any;

    const sourceFile = path.join(workspaceRoot, 'src', 'index.ts');

    expect(() => contextManager.assertCanRead(agent, sourceFile)).toThrow(PermissionError);
    expect(() => contextManager.assertCanWrite(agent, sourceFile)).toThrow(PermissionError);
  });

  it('generates organization-level defaults with strategic access and agent management', () => {
    const permissions = contextManager.generateDefaultPermissions(ContextLevel.ORGANIZATION);

    expect(permissions.read).toEqual(['README.md', 'docs/**/*', '.ai-team/**/*']);
    expect(permissions.write).toEqual(['.ai-team/meetings/**/*', '**/agent.md', '**/*.agent.md']);
    expect(permissions.manage_agents).toBe(true);
  });
});
