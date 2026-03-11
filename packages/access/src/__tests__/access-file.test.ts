import { mkdir, mkdtemp, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseAccessFile } from '../access-file.js';
import { AccessEngine } from '../engine.js';

const WORKSPACE = '/workspace/project';
const CWD = '/workspace/project';

async function createWorkspace(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'ai-team-access-workspace-'));
}

function createConventionReadyEngine(workspaceRoot: string): AccessEngine {
  const engine = new AccessEngine({ workspaceRoot });
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
  it('treats files without sections as deny-all-rights patterns', () => {
    const rules = parseAccessFile([
      '# ignore-like fallback',
      'secrets/**',
      '*.log',
      '',
    ].join('\n'));

    // 2 patterns × 5 rights
    expect(rules).toHaveLength(10);
    expect(rules.every((r) => r.effect === 'deny')).toBe(true);
    expect(rules.some((r) => r.pathPattern === 'secrets/**' && r.right === 'read')).toBe(true);
    expect(rules.some((r) => r.pathPattern === '*.log' && r.right === 'delete')).toBe(true);
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

  it('rejects section mode with patterns outside sections', () => {
    expect(() => parseAccessFile([
      'orphan/**',
      '[write]',
      'docs/**',
    ].join('\n'))).toThrow(/outside of a section/i);
  });
});

describe('AccessEngine.registerAccessFile/registerGlobalAccessFile', () => {
  let engine: AccessEngine;

  beforeEach(() => {
    engine = new AccessEngine({ workspaceRoot: WORKSPACE });
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

  it('loads fallback deny-all patterns into a context', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ai-team-access-'));
    const file = join(dir, '.access');
    await writeFile(file, ['secrets/**', '*.log'].join('\n'), 'utf8');

    await engine.registerAccessFile('agent-a', file);

    expect(engine.checkPath('secrets/key.pem', 'read', CWD).allowed).toBe(false);
    expect(engine.checkPath('app.log', 'delete', CWD).allowed).toBe(false);
    expect(engine.checkPath('src/app.ts', 'read', CWD).allowed).toBe(true);
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
    const noGlobalEngine = new AccessEngine({ workspaceRoot: WORKSPACE });
    await expect(noGlobalEngine.registerGlobalAccessFile('any.file')).rejects.toThrow(/global context is not set/i);
  });
});

describe('AccessEngine workspace conventions', () => {
  it('scopes .contextId.access outside .ai-team to the file folder', async () => {
    const workspace = await createWorkspace();
    const nestedDir = join(workspace, 'apps', 'web');
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(nestedDir, '.agent-a.access'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');

    expect(engine.checkPath('apps/web/docs/guide.md', 'read', workspace).allowed).toBe(false);
    expect(engine.checkPath('docs/guide.md', 'read', workspace).allowed).toBe(true);
  });

  it('treats .contextId.access under .ai-team/** as workspace-root relative', async () => {
    const workspace = await createWorkspace();
    const aiTeamDir = join(workspace, '.ai-team', 'conventions');
    await mkdir(aiTeamDir, { recursive: true });
    await writeFile(join(aiTeamDir, '.agent-a.access'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

    const engine = createConventionReadyEngine(workspace);
    engine.registerContext({ id: 'agent-a', rules: [] });
    engine.setActiveContext('agent-a');

    expect(engine.checkPath('docs/guide.md', 'read', workspace).allowed).toBe(false);
    expect(engine.checkPath('apps/web/docs/guide.md', 'read', workspace).allowed).toBe(true);
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

  it('applies discovered .access rules to existing and later-registered contexts', async () => {
    const workspace = await createWorkspace();
    await writeFile(join(workspace, '.agent-a.access'), ['[deny read]', 'secrets/**'].join('\n'), 'utf8');
    await writeFile(join(workspace, '.agent-b.access'), ['[deny read]', 'docs/**'].join('\n'), 'utf8');

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
    const accessFile = join(workspace, '.agent-a.access');

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
      await waitForCondition(() => engine.checkPath('secrets/key.pem', 'read', workspace).allowed === true);

      await unlink(accessFile);
      await waitForCondition(() => engine.checkPath('docs/guide.md', 'read', workspace).allowed === true);
    } finally {
      engine.stopConventionWatcher();
    }
  });
});
