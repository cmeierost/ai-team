import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { accessRulesToPatternSet, parseAccessFile, serializePatternSetToAccessFile } from './access-file.js';
import { PermissionEngine } from './engine.js';

const WORKSPACE = '/workspace/project';
const CWD = '/workspace/project';

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ai-team-access-workspace-'));
}

function createConventionReadyEngine(workspaceRoot: string): PermissionEngine {
  const engine = new PermissionEngine({ workspaceRoot });
  engine.registerContext({
    id: 'global',
    rules: [
      { right: 'read', effect: 'allow', pathPattern: '**' },
      { right: 'write', effect: 'allow', pathPattern: '**' },
      { right: 'create', effect: 'allow', pathPattern: '**' },
      { right: 'delete', effect: 'allow', pathPattern: '**' },
      { right: 'list', effect: 'allow', pathPattern: '**' },
    ],
  });
  engine.setGlobalContext('global');
  return engine;
}

async function waitForCondition(
  check: () => boolean,
  timeoutMs = 2000,
  intervalMs = 40,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error('Timed out waiting for condition.');
}

describe('parseAccessFile', () => {
  it('treats files without sections as allow-all-rights patterns and ! as deny', () => {
    const rules = parseAccessFile([
      '# allow-list style fallback',
      'src/**',
      '!src/private/**',
      '*.log',
      '',
    ].join('\n'));

    // 3 patterns × 5 rights
    expect(rules).toHaveLength(15);
    expect(rules.some((r) => r.pathPattern === 'src/**' && r.effect === 'allow' && r.right === 'read')).toBe(true);
    expect(rules.some((r) => r.pathPattern === 'src/private/**' && r.effect === 'deny' && r.right === 'write')).toBe(true);
    expect(rules.some((r) => r.pathPattern === '*.log' && r.effect === 'allow' && r.right === 'delete')).toBe(true);
  });

  it('parses section-based rights and effects', () => {
    const rules = parseAccessFile([
      '[write,create]',
      'docs/**',
      '[deny delete]',
      'docs/archive/**',
    ].join('\n'));

    expect(rules.some((r) => r.pathPattern === 'docs/**' && r.right === 'write' && r.effect === 'allow')).toBe(true);
    expect(rules.some((r) => r.pathPattern === 'docs/**' && r.right === 'create' && r.effect === 'allow')).toBe(true);
    expect(rules.some((r) => r.pathPattern === 'docs/archive/**' && r.right === 'delete' && r.effect === 'deny')).toBe(true);
  });

  it('maps [read] section entries to list as well', () => {
    const rules = parseAccessFile([
      '[read]',
      'packages/service/**/*',
    ].join('\n'));

    expect(rules.some((r) => r.pathPattern === 'packages/service/**/*' && r.right === 'read' && r.effect === 'allow')).toBe(true);
    expect(rules.some((r) => r.pathPattern === 'packages/service/**/*' && r.right === 'list' && r.effect === 'allow')).toBe(true);
  });

  it('derives list rights from [read] section when no [list] section is present', () => {
    const rules = parseAccessFile([
      '[read]',
      'docs/**/*',
      '[write]',
      '.ai-team/**/*',
    ].join('\n'));

    // List is allowed only where read is allowed
    expect(rules.some((r) => r.right === 'list' && r.effect === 'allow' && r.pathPattern === 'docs/**/*')).toBe(true);
    // No catch-all list fallback
    expect(rules.some((r) => r.right === 'list' && r.effect === 'allow' && r.pathPattern === '**')).toBe(false);
  });

  it('does not add implicit list allow-all when [list] section is present', () => {
    const rules = parseAccessFile([
      '[list]',
      'docs/**/*',
      '[read]',
      'docs/architecture/**/*',
    ].join('\n'));

    const implicitListRules = rules.filter(
      (r) => r.right === 'list' && r.effect === 'allow' && r.pathPattern === '**' && r.label === 'access-file implicit list fallback',
    );
    expect(implicitListRules).toHaveLength(0);
  });

  it('rejects section mode with patterns outside sections', () => {
    expect(() => parseAccessFile([
      'orphan/**',
      '[write]',
      'docs/**',
    ].join('\n'))).toThrow(/outside of a section/i);
  });
});

describe('access pattern conversion + serialization', () => {
  it('projects allow rules into mode-specific pattern sets', () => {
    const rules = parseAccessFile([
      '[read,write]',
      'src/**',
      '[create]',
      'docs/**',
      '[deny delete]',
      'secrets/**',
    ].join('\n'));

    const patterns = accessRulesToPatternSet(rules);

    expect(patterns.read).toEqual(['src/**']);
    expect(patterns.write).toEqual(['src/**']);
    expect(patterns.create).toEqual(['docs/**']);
    expect(patterns.delete).toEqual([]);
  });

  it('serializes and re-parses pattern sets deterministically', () => {
    const serialized = serializePatternSetToAccessFile({
      read: ['src/**', 'src/**', 'docs/**'],
      write: ['src/**'],
      create: ['artifacts/**'],
      delete: [],
    });

    const reparsed = accessRulesToPatternSet(parseAccessFile(serialized));

    expect(reparsed).toEqual({
      read: ['docs/**', 'src/**'],
      write: ['src/**'],
      create: ['artifacts/**'],
      delete: [],
    });
  });
});

describe('PermissionEngine.registerAccessFile/registerGlobalAccessFile', () => {
  let engine: PermissionEngine;

  beforeEach(() => {
    engine = new PermissionEngine({ workspaceRoot: WORKSPACE });
    engine.registerContext({
      id: 'global',
      rules: [
        { right: 'read', effect: 'allow', pathPattern: '**' },
        { right: 'write', effect: 'allow', pathPattern: '**' },
        { right: 'create', effect: 'allow', pathPattern: '**' },
        { right: 'delete', effect: 'allow', pathPattern: '**' },
        { right: 'list', effect: 'allow', pathPattern: '**' },
      ],
    });
    engine.setGlobalContext('global');
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');
  });

  it('loads fallback allow-all patterns with negation exclusions into a context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-access-'));
    const file = join(dir, '.perm');
    await writeFile(file, ['src/**', '!src/private/**'].join('\n'), 'utf8');

    await engine.registerAccessFile('agent-a', file);

    expect(engine.checkPath('src/app.ts', 'read', CWD).allowed).toBe(true);
    expect(engine.checkPath('src/private/key.ts', 'read', CWD).allowed).toBe(false);
    expect(engine.checkPath('docs/readme.md', 'read', CWD).allowed).toBe(true);
  });

  it('loads section rules into global context via registerGlobalAccessFile', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-access-'));
    const file = join(dir, '.access-sections');
    await writeFile(file, [
      '[deny write,delete]',
      'docs/protected/**',
      '[deny read]',
      'secrets/**',
    ].join('\n'), 'utf8');

    await engine.registerGlobalAccessFile(file);

    expect(engine.checkPath('docs/protected/guide.md', 'write', CWD).allowed).toBe(false);
    expect(engine.checkPath('docs/protected/guide.md', 'delete', CWD).allowed).toBe(false);
    expect(engine.checkPath('secrets/key.pem', 'read', CWD).allowed).toBe(false);
    expect(engine.checkPath('docs/public/guide.md', 'read', CWD).allowed).toBe(true);
  });

  it('throws when global context is not configured', async () => {
    const noGlobalEngine = new PermissionEngine({ workspaceRoot: WORKSPACE });
    await expect(noGlobalEngine.registerGlobalAccessFile('any.file')).rejects.toThrow(/global context is not set/i);
  });
});

describe('PermissionEngine workspace conventions', () => {
  it('scopes .contextId.perm outside .ai-team to the file folder', async () => {
    const workspace = await createWorkspace();
    const nestedDir = join(workspace, 'apps', 'web');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, '.agent-a.perm'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');

    expect(engine.checkPath('apps/web/docs/guide.md', 'read', workspace).allowed).toBe(false);
    // strict mode: unmatched paths are denied when .agent-a.perm exists
    expect(engine.checkPath('docs/guide.md', 'read', workspace).allowed).toBe(false);
  });

  it('treats .contextId.perm under .ai-team/** as workspace-root relative', async () => {
    const workspace = await createWorkspace();
    const aiTeamDir = join(workspace, '.ai-team', 'conventions');
    await mkdir(aiTeamDir, { recursive: true });
    await writeFile(join(aiTeamDir, '.agent-a.perm'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');

    expect(engine.checkPath('docs/guide.md', 'read', workspace).allowed).toBe(false);
    // strict mode: unmatched paths are denied when .agent-a.perm exists
    expect(engine.checkPath('apps/web/docs/guide.md', 'read', workspace).allowed).toBe(false);
  });

  it('loads ignore conventions including .claudeignore with file-folder scoping', async () => {
    const workspace = await createWorkspace();
    const toolsDir = join(workspace, 'tools');
    await mkdir(toolsDir, { recursive: true });
    await writeFile(join(toolsDir, '.claudeignore'), 'build/**\n', 'utf8');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');

    expect(engine.checkPath('tools/build/output.log', 'read', workspace).allowed).toBe(false);
    expect(engine.checkPath('build/output.log', 'read', workspace).allowed).toBe(true);
  });

  it('applies discovered .perm rules to existing and later-registered contexts', async () => {
    const workspace = await createWorkspace();
    await writeFile(join(workspace, '.agent-a.perm'), ['[deny read]', 'secrets/**'].join('\n'), 'utf8');
    await writeFile(join(workspace, '.agent-b.perm'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

    const engine = createConventionReadyEngine(workspace);

    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');
    expect(engine.checkPath('secrets/key.pem', 'read', workspace).allowed).toBe(false);

    engine.registerContext({ id: 'agent-b', rules: [] });
    engine.setActiveContext('agent-b');
    expect(engine.checkPath('docs/guide.md', 'read', workspace).allowed).toBe(false);
  });

  it('refreshes conventions on watcher add/change/unlink events', async () => {
    const workspace = await createWorkspace();
    const accessFile = join(workspace, '.agent-a.perm');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');
    engine.startConventionWatcher();
    await new Promise((resolve) => setTimeout(resolve, 120));

    try {
      expect(engine.checkPath('secrets/key.pem', 'read', workspace).allowed).toBe(true);

      await writeFile(accessFile, ['[deny read]', 'secrets/**'].join('\n'), 'utf8');
      await waitForCondition(() => engine.checkPath('secrets/key.pem', 'read', workspace).allowed === false);

      await writeFile(accessFile, ['[deny read]', 'docs/**'].join('\n'), 'utf8');
      await waitForCondition(() => engine.checkPath('docs/guide.md', 'read', workspace).allowed === false);
      await waitForCondition(() => engine.checkPath('secrets/key.pem', 'read', workspace).allowed === false);

      await unlink(accessFile);
      await waitForCondition(() => engine.checkPath('docs/guide.md', 'read', workspace).allowed === true);
    } finally {
      engine.stopConventionWatcher();
    }
  });
});
