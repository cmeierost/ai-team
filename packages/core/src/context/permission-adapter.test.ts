import { describe, it, expect } from 'vitest';
import {
  agentToAccessContext,
  fileTreeConfigToAccessContext,
  createPermissionEngine,
  GLOBAL_CONTEXT_ID,
} from './permission-adapter.js';
import { ContextManager } from './index.js';
import { ContextLevel, type Agent, type FileTreeConfig, type PermissionConfig } from '../types/index.js';

function perms(p: { read?: string[]; write?: string[]; create?: string[]; delete?: string[]; manage_agents?: boolean }): PermissionConfig {
  return { read: p.read ?? [], write: p.write ?? [], create: p.create ?? [], delete: p.delete ?? [], manage_agents: p.manage_agents };
}

const makeAgent = (
  id: string,
  overrides?: Partial<Agent>,
): Agent => ({
  id,
  name: `Agent ${id}`,
  role: 'developer',
  contextLevel: ContextLevel.MODULE,
  filePath: `.ai-team/agents/${id}.agent.yml`,
  skillPath: `.ai-team/agents/${id}`,
  createdAt: new Date().toISOString(),
  permissions: perms({ read: ['src/**/*'], write: ['src/my-module/**/*'] }),
  ...overrides,
});

describe('agentToAccessContext', () => {
  it('converts read patterns to read-allow rules', () => {
    const ctx = agentToAccessContext(makeAgent('a'));
    const readRules = ctx.rules.filter(r => r.right === 'read' && r.effect === 'allow');
    expect(readRules.some(r => r.pathPattern === 'src/**/*')).toBe(true);
  });

  it('maps read patterns to list-allow rules by default', () => {
    const ctx = agentToAccessContext(makeAgent('a'));
    const listRules = ctx.rules.filter(r => r.right === 'list' && r.effect === 'allow');
    expect(listRules.some(r => r.pathPattern === 'src/**/*')).toBe(true);
  });

  it('converts write patterns to write-allow rules', () => {
    const ctx = agentToAccessContext(makeAgent('a'));
    const writeRules = ctx.rules.filter(r => r.right === 'write' && r.effect === 'allow');
    expect(writeRules.some(r => r.pathPattern === 'src/my-module/**/*')).toBe(true);
  });

  it('adds implicit read rules for write patterns (write implies read)', () => {
    const ctx = agentToAccessContext(makeAgent('a', {
      permissions: perms({ read: ['docs/**/*'], write: ['src/**/*'] }),
    }));
    const readRules = ctx.rules.filter(r => r.right === 'read' && r.effect === 'allow');
    expect(readRules.some(r => r.pathPattern === 'docs/**/*')).toBe(true);
    expect(readRules.some(r => r.pathPattern === 'src/**/*')).toBe(true);
  });

  it('adds implicit list rules for write patterns through read implication', () => {
    const ctx = agentToAccessContext(makeAgent('a', {
      permissions: perms({ write: ['src/**/*'] }),
    }));
    const listRules = ctx.rules.filter(r => r.right === 'list' && r.effect === 'allow');
    expect(listRules.some(r => r.pathPattern === 'src/**/*')).toBe(true);
  });

  it('does not duplicate read rule when write pattern already in read list', () => {
    const ctx = agentToAccessContext(makeAgent('a', {
      permissions: perms({ read: ['src/**/*'], write: ['src/**/*'] }),
    }));
    const readRules = ctx.rules.filter(r => r.right === 'read' && r.pathPattern === 'src/**/*');
    expect(readRules).toHaveLength(1);
  });

  it('converts create and delete patterns', () => {
    const ctx = agentToAccessContext(makeAgent('a', {
      permissions: perms({ create: ['new/**/*'], delete: ['tmp/**/*'] }),
    }));
    expect(ctx.rules.some(r => r.right === 'create' && r.pathPattern === 'new/**/*')).toBe(true);
    expect(ctx.rules.some(r => r.right === 'delete' && r.pathPattern === 'tmp/**/*')).toBe(true);
  });

  it('uses agent id and name for context id and label', () => {
    const ctx = agentToAccessContext(makeAgent('dev-a'));
    expect(ctx.id).toBe('dev-a');
    expect(ctx.label).toBe('Agent dev-a');
  });

  it('stores contextLevel and manage_agents in metadata', () => {
    const ctx = agentToAccessContext(makeAgent('hr', {
      contextLevel: ContextLevel.ORGANIZATION,
      permissions: perms({ manage_agents: true }),
    }));
    expect(ctx.metadata?.contextLevel).toBe(ContextLevel.ORGANIZATION);
    expect(ctx.metadata?.manage_agents).toBe(true);
  });

  it('handles agent with no permissions', () => {
    const ctx = agentToAccessContext(makeAgent('bare', { permissions: undefined }));
    expect(ctx.rules).toHaveLength(0);
  });
});

describe('fileTreeConfigToAccessContext', () => {
  it('converts readPaths to global read-allow rules', () => {
    const ctx = fileTreeConfigToAccessContext({ readPaths: ['**/*'] } as FileTreeConfig);
    expect(ctx.id).toBe(GLOBAL_CONTEXT_ID);
    expect(ctx.rules.some(r => r.right === 'read' && r.pathPattern === '**/*')).toBe(true);
  });

  it('converts readPaths to global list-allow rules', () => {
    const ctx = fileTreeConfigToAccessContext({ readPaths: ['**/*'] } as FileTreeConfig);
    expect(ctx.rules.some(r => r.right === 'list' && r.pathPattern === '**/*')).toBe(true);
  });

  it('adds implicit read rules for writePaths', () => {
    const ctx = fileTreeConfigToAccessContext({
      writePaths: ['src/**/*'],
    } as FileTreeConfig);
    expect(ctx.rules.some(r => r.right === 'write' && r.pathPattern === 'src/**/*')).toBe(true);
    expect(ctx.rules.some(r => r.right === 'read' && r.pathPattern === 'src/**/*')).toBe(true);
  });
});

describe('createPermissionEngine', () => {
  it('creates an engine with global and agent contexts', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      fileTreeConfig: { readPaths: ['docs/**/*'] } as FileTreeConfig,
      agents: [makeAgent('a'), makeAgent('b')],
    });

    expect(engine.getContext(GLOBAL_CONTEXT_ID)).toBeDefined();
    expect(engine.getContext('a')).toBeDefined();
    expect(engine.getContext('b')).toBeDefined();
  });

  it('wires built-in tool descriptors', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a')],
    });

    // fs_read should be registered
    const verdict = engine.checkToolCall('fs_read', { filePath: 'src/foo.ts' }, '/workspace', 'a');
    // The tool is registered, so it won't fall back to "unregistered tool denied"
    expect(verdict.explanation).not.toContain('Unregistered tool');
  });

  it('wires fs_exists/fs_info as list-right tools', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'] }),
      })],
    });

    const existsAllowed = engine.checkToolCall('fs_exists', { path: 'src/foo.ts' }, '/workspace', 'a');
    const existsDenied = engine.checkToolCall('fs_exists', { path: 'docs/readme.md' }, '/workspace', 'a');
    const infoAllowed = engine.checkToolCall('fs_info', { path: 'src/foo.ts' }, '/workspace', 'a');
    const infoDenied = engine.checkToolCall('fs_info', { path: 'docs/readme.md' }, '/workspace', 'a');

    expect(existsAllowed.allowed).toBe(true);
    expect(existsDenied.allowed).toBe(false);
    expect(infoAllowed.allowed).toBe(true);
    expect(infoDenied.allowed).toBe(false);
  });

  it('wires common command descriptors', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a')],
    });

    const verdict = engine.checkCommand('cat src/hello.ts', '/workspace', 'a');
    expect(verdict.explanation).not.toContain('Unregistered command');
  });

  it('agent context allows reads matching agent permissions', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'], write: ['src/my-module/**/*'] }),
      })],
    });

    const verdict = engine.checkPath('src/foo.ts', 'read', '/workspace', 'a');
    expect(verdict.allowed).toBe(true);
  });

  it('agent context denies reads outside permission patterns', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'] }),
      })],
    });

    const verdict = engine.checkPath('docs/readme.md', 'read', '/workspace', 'a');
    expect(verdict.allowed).toBe(false);
  });

  it('global context allows reads for any agent via merged evaluation', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      fileTreeConfig: { readPaths: ['docs/**/*'] } as FileTreeConfig,
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'] }),
      })],
    });

    // Agent a gets docs via global + src via own context
    const srcVerdict = engine.checkPath('src/foo.ts', 'read', '/workspace', 'a');
    const docsVerdict = engine.checkPath('docs/readme.md', 'read', '/workspace', 'a');
    expect(srcVerdict.allowed).toBe(true);
    expect(docsVerdict.allowed).toBe(true);
  });

  it('provides alternative contexts when access is denied', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [
        makeAgent('a', { permissions: perms({ read: ['src/**/*'] }) }),
        makeAgent('b', { permissions: perms({ read: ['docs/**/*'] }) }),
      ],
    });

    const verdict = engine.checkPath('docs/readme.md', 'read', '/workspace', 'a');
    expect(verdict.allowed).toBe(false);
    expect(verdict.alternativeContexts.some((ac: { contextId: string }) => ac.contextId === 'b')).toBe(true);
  });
});

describe('ContextManager with PermissionEngine delegation', () => {
  it('delegates canRead to engine when engine is provided', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'] }),
      })],
    });

    const cm = new ContextManager('/workspace', undefined, engine);
    const agent = makeAgent('a', { permissions: perms({ read: ['src/**/*'] }) });

    expect(cm.canRead(agent, '/workspace/src/foo.ts')).toBe(true);
    expect(cm.canRead(agent, '/workspace/docs/readme.md')).toBe(false);
  });

  it('delegates canWrite to engine when engine is provided', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [makeAgent('a', {
        permissions: perms({ read: ['src/**/*'], write: ['src/my-module/**/*'] }),
      })],
    });

    const cm = new ContextManager('/workspace', undefined, engine);
    const agent = makeAgent('a', {
      permissions: perms({ read: ['src/**/*'], write: ['src/my-module/**/*'] }),
    });

    expect(cm.canWrite(agent, '/workspace/src/my-module/file.ts')).toBe(true);
    expect(cm.canWrite(agent, '/workspace/src/other/file.ts')).toBe(false);
  });

  it('checkPathDetailed returns full verdict with alternatives', () => {
    const engine = createPermissionEngine({
      workspaceRoot: '/workspace',
      agents: [
        makeAgent('a', { permissions: perms({ read: ['src/**/*'] }) }),
        makeAgent('b', { permissions: perms({ read: ['docs/**/*'], write: ['docs/**/*'] }) }),
      ],
    });

    const cm = new ContextManager('/workspace', undefined, engine);
    const agent = makeAgent('a', { permissions: perms({ read: ['src/**/*'] }) });

    const verdict = cm.checkPathDetailed(agent, '/workspace/docs/readme.md', 'write');
    expect(verdict).toBeDefined();
    expect(verdict?.allowed).toBe(false);
    expect(verdict?.alternativeContexts.some((ac: { contextId: string }) => ac.contextId === 'b')).toBe(true);
  });

  it('returns undefined from checkPathDetailed when no engine is present', () => {
    const cm = new ContextManager('/workspace');
    const agent = makeAgent('a');
    expect(cm.checkPathDetailed(agent, '/workspace/src/foo.ts', 'read')).toBeUndefined();
  });
});
