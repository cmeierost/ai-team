import { describe, it, expect, beforeEach } from 'vitest';
import { AccessEngine } from '../engine.js';
import type { AccessContext } from '../types.js';

const WORKSPACE = '/workspace/project';
const CWD = '/workspace/project';

function createEngine(): AccessEngine {
  const engine = new AccessEngine({ workspaceRoot: WORKSPACE });

  // Global context: broad baseline
  engine.registerContext({
    id: 'global',
    label: 'Global baseline',
    rules: [
      { right: 'read', effect: 'allow', pathPattern: '**' },
      { right: 'list', effect: 'allow', pathPattern: '**' },
      { right: 'write', effect: 'deny', pathPattern: '.env' },
      { right: 'read', effect: 'deny', pathPattern: 'secrets/**' },
    ],
  });
  engine.setGlobalContext('global');

  // Agent A: frontend developer — can write in src/
  engine.registerContext({
    id: 'agent-a',
    label: 'Frontend dev',
    rules: [
      { right: 'write', effect: 'allow', pathPattern: 'src/**' },
      { right: 'create', effect: 'allow', pathPattern: 'src/**', filePattern: '*.ts' },
      { right: 'create', effect: 'allow', pathPattern: 'src/**', filePattern: '*.tsx' },
      { right: 'delete', effect: 'allow', pathPattern: 'src/**' },
    ],
  });

  // Agent B: docs writer — can only write *.md in docs/
  engine.registerContext({
    id: 'agent-b',
    label: 'Docs writer',
    rules: [
      { right: 'write', effect: 'allow', pathPattern: 'docs/**', filePattern: '*.md' },
      { right: 'create', effect: 'allow', pathPattern: 'docs/**', filePattern: '*.md' },
    ],
  });

  // Agent C: full-stack — can write everywhere except secrets
  engine.registerContext({
    id: 'agent-c',
    label: 'Full-stack',
    rules: [
      { right: 'write', effect: 'allow', pathPattern: '**' },
      { right: 'create', effect: 'allow', pathPattern: '**' },
      { right: 'delete', effect: 'allow', pathPattern: '**' },
      { right: 'write', effect: 'deny', pathPattern: 'secrets/**' },
    ],
  });

  // Register common commands
  engine.registerCommand({
    names: ['cat', 'type'],
    pathArgs: [{ right: 'read', extractor: { kind: 'positional', index: 0 } }],
  });

  engine.registerCommand({
    names: ['cp', 'copy'],
    pathArgs: [
      { right: 'read', extractor: { kind: 'positional', index: 0 } },
      { right: 'write', extractor: { kind: 'positional', index: 1 } },
    ],
  });

  engine.registerCommand({
    names: ['mkdir'],
    pathArgs: [{ right: 'create', extractor: { kind: 'positional', index: 0 } }],
  });

  engine.registerCommand({
    names: ['rm'],
    pathArgs: [{ right: 'delete', extractor: { kind: 'rest', startIndex: 0 } }],
  });

  // Register tools
  engine.registerTool({
    name: 'readFile',
    pathParams: [{ paramName: 'path', right: 'read' }],
  });

  engine.registerTool({
    name: 'writeFile',
    pathParams: [{ paramName: 'path', right: 'write' }],
  });

  engine.registerTool({
    name: 'run_in_terminal',
    pathParams: [],
    shellParam: 'command',
  });

  return engine;
}

describe('AccessEngine — checkPath', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('global context allows read everywhere (except secrets)', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkPath('src/foo.ts', 'read', CWD);
    expect(v.allowed).toBe(true);
  });

  it('global deny blocks read in secrets/', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkPath('secrets/key.pem', 'read', CWD);
    expect(v.allowed).toBe(false);
  });

  it('agent-a can write in src/', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkPath('src/app.ts', 'write', CWD);
    expect(v.allowed).toBe(true);
  });

  it('agent-a cannot write in docs/', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkPath('docs/readme.md', 'write', CWD);
    expect(v.allowed).toBe(false);
  });

  it('agent-b can create .md in docs/', () => {
    engine.setActiveContext('agent-b');
    const v = engine.checkPath('docs/guide.md', 'create', CWD);
    expect(v.allowed).toBe(true);
  });

  it('agent-b cannot create .ts in docs/', () => {
    engine.setActiveContext('agent-b');
    const v = engine.checkPath('docs/types.ts', 'create', CWD);
    expect(v.allowed).toBe(false);
  });

  it('returns alternative contexts on denial', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkPath('docs/readme.md', 'write', CWD);
    expect(v.allowed).toBe(false);
    const altIds = v.alternativeContexts.map((a) => a.contextId);
    expect(altIds).toContain('agent-b');
    expect(altIds).toContain('agent-c');
  });
});

describe('AccessEngine — checkCommand', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('cat file.txt allowed when global allows read', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkCommand('cat src/foo.ts', CWD);
    expect(v.allowed).toBe(true);
  });

  it('cat secrets/key denied by global', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkCommand('cat secrets/key.pem', CWD);
    expect(v.allowed).toBe(false);
  });

  it('cp with mixed rights: source read + dest write', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkCommand('cp src/a.ts src/b.ts', CWD);
    expect(v.allowed).toBe(true);
    expect(v.paths).toHaveLength(2);
  });

  it('mkdir denied for agent without create right', () => {
    engine.setActiveContext('agent-b');
    const v = engine.checkCommand('mkdir src/components', CWD);
    expect(v.allowed).toBe(false);
  });

  it('mkdir allowed for agent with create right', () => {
    engine.setActiveContext('agent-c');
    const v = engine.checkCommand('mkdir src/components', CWD);
    expect(v.allowed).toBe(true);
  });

  it('unregistered command denied by default', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkCommand('curl http://example.com', CWD);
    expect(v.allowed).toBe(false);
    expect(v.explanation).toContain('Unregistered command');
  });

  it('resolves relative paths against cwd', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkCommand('cat foo.ts', '/workspace/project/src');
    expect(v.allowed).toBe(true);
    expect(v.paths[0].path).toBe('src/foo.ts');
  });
});

describe('AccessEngine — checkToolCall', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('readFile tool allowed for readable path', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkToolCall('readFile', { path: 'src/foo.ts' }, CWD);
    expect(v.allowed).toBe(true);
  });

  it('writeFile tool denied for agent-b outside docs/', () => {
    engine.setActiveContext('agent-b');
    const v = engine.checkToolCall('writeFile', { path: 'src/app.ts' }, CWD);
    expect(v.allowed).toBe(false);
  });

  it('compound tool: run_in_terminal with cat', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkToolCall(
      'run_in_terminal',
      { command: 'cat src/foo.ts' },
      CWD,
    );
    expect(v.allowed).toBe(true);
  });

  it('compound tool: run_in_terminal with cat on denied path', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkToolCall(
      'run_in_terminal',
      { command: 'cat secrets/key.pem' },
      CWD,
    );
    expect(v.allowed).toBe(false);
  });

  it('unregistered tool denied by default', () => {
    engine.setActiveContext('agent-a');
    const v = engine.checkToolCall('unknownTool', { file: 'x' }, CWD);
    expect(v.allowed).toBe(false);
  });
});

describe('AccessEngine — batch operations', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  const files = ['src/app.ts', 'docs/readme.md', 'secrets/key.pem'];

  it('filterPaths keeps only accessible paths', () => {
    engine.setActiveContext('agent-a');
    const result = engine.filterPaths(files, 'read', CWD);
    expect(result).toContain('src/app.ts');
    expect(result).toContain('docs/readme.md');
    expect(result).not.toContain('secrets/key.pem');
  });

  it('filterPaths with write right for agent-a', () => {
    engine.setActiveContext('agent-a');
    const result = engine.filterPaths(files, 'write', CWD);
    expect(result).toEqual(['src/app.ts']);
  });

  it('annotatePaths shows per-context rights', () => {
    const annotations = engine.annotatePaths(files, CWD);
    expect(annotations).toHaveLength(3);

    const srcAnnotation = annotations.find((a) => a.path === 'src/app.ts')!;
    expect(srcAnnotation.contextRights.get('agent-a')?.has('write')).toBe(true);
    expect(srcAnnotation.contextRights.get('agent-c')?.has('write')).toBe(true);

    const docsAnnotation = annotations.find((a) => a.path === 'docs/readme.md')!;
    expect(docsAnnotation.contextRights.get('agent-b')?.has('write')).toBe(true);
  });

  it('checkPaths returns one verdict per path', () => {
    engine.setActiveContext('agent-a');
    const verdicts = engine.checkPaths(files, 'read', CWD);
    expect(verdicts).toHaveLength(3);
    expect(verdicts[0].allowed).toBe(true);  // src/app.ts
    expect(verdicts[1].allowed).toBe(true);  // docs/readme.md
    expect(verdicts[2].allowed).toBe(false); // secrets/key.pem
  });
});

describe('AccessEngine — introspection', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('whoCanAccess returns correct context IDs', () => {
    const who = engine.whoCanAccess('docs/readme.md', 'write', CWD);
    expect(who).toContain('agent-b');
    expect(who).toContain('agent-c');
    expect(who).not.toContain('agent-a');
  });

  it('whatCanContextDo returns rights map', () => {
    const rights = engine.whatCanContextDo('agent-a', ['src/app.ts', 'docs/readme.md'], CWD);
    expect(rights.get('src/app.ts')?.has('write')).toBe(true);
    expect(rights.get('src/app.ts')?.has('read')).toBe(true);
    expect(rights.get('docs/readme.md')?.has('write')).toBe(false);
    expect(rights.get('docs/readme.md')?.has('read')).toBe(true);
  });

  it('rankContexts sorts by coverage', () => {
    const files = ['src/app.ts', 'docs/readme.md', 'config/settings.json'];
    const ranked = engine.rankContexts(files, 'write', CWD);
    // agent-c has ** → covers all 3
    expect(ranked[0].contextId).toBe('agent-c');
    expect(ranked[0].coverageCount).toBe(3);
  });

  it('findGaps identifies denied paths and alternatives', () => {
    const files = ['src/app.ts', 'docs/readme.md', 'config/settings.json'];
    const gaps = engine.findGaps(files, 'write', 'agent-a', CWD);
    expect(gaps.denied).toContain('docs/readme.md');
    expect(gaps.denied).toContain('config/settings.json');

    const docsAlt = gaps.alternatives.find((a) => a.path === 'docs/readme.md');
    expect(docsAlt?.contextIds).toContain('agent-b');
    expect(docsAlt?.contextIds).toContain('agent-c');
  });

  it('distributeWork assigns paths across contexts', () => {
    const files = ['src/app.ts', 'docs/readme.md', 'config/settings.json', 'secrets/key.pem'];
    const dist = engine.distributeWork(files, 'write', CWD);

    // agent-c covers most (all except secrets)
    const agentC = dist.find((d) => d.contextId === 'agent-c');
    expect(agentC).toBeDefined();
    expect(agentC!.paths).toContain('src/app.ts');
    expect(agentC!.paths).toContain('docs/readme.md');
    expect(agentC!.paths).toContain('config/settings.json');

    // secrets/key.pem is globally denied for write → unassigned
    const unassigned = dist.find((d) => d.contextId === '__unassigned__');
    expect(unassigned?.paths).toContain('secrets/key.pem');
  });

  it('listRules returns rules for specific context', () => {
    const result = engine.listRules('agent-a');
    expect(result).toHaveLength(1);
    expect(result[0].contextId).toBe('agent-a');
    expect(result[0].rules.length).toBeGreaterThan(0);
  });

  it('listRules without arg returns all contexts', () => {
    const result = engine.listRules();
    expect(result.length).toBeGreaterThanOrEqual(4); // global + 3 agents
  });
});

describe('AccessEngine — ignore patterns', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('ignored files are invisible regardless of context', () => {
    engine.setIgnorePatterns(['node_modules/**', '*.log']);
    engine.setActiveContext('agent-c'); // agent-c has write everywhere

    expect(engine.checkPath('node_modules/foo/bar.js', 'read', CWD).allowed).toBe(false);
    expect(engine.checkPath('debug.log', 'read', CWD).allowed).toBe(false);
    expect(engine.checkPath('src/app.ts', 'read', CWD).allowed).toBe(true);
  });

  it('ignored files marked as deniedByIgnore', () => {
    engine.setIgnorePatterns(['*.log']);
    engine.setActiveContext('agent-c');

    const v = engine.checkPath('app.log', 'read', CWD);
    expect(v.paths[0].deniedByIgnore).toBe(true);
  });
});

describe('AccessEngine — context switching', () => {
  let engine: AccessEngine;
  beforeEach(() => { engine = createEngine(); });

  it('switching context changes access results immediately', () => {
    engine.setActiveContext('agent-a');
    expect(engine.checkPath('docs/readme.md', 'write', CWD).allowed).toBe(false);

    engine.setActiveContext('agent-b');
    expect(engine.checkPath('docs/readme.md', 'write', CWD).allowed).toBe(true);
  });

  it('runtime context update changes access', () => {
    engine.setActiveContext('agent-a');
    expect(engine.checkPath('config/app.json', 'write', CWD).allowed).toBe(false);

    // Give agent-a write to config/
    engine.updateContext('agent-a', {
      rules: [
        { right: 'write', effect: 'allow', pathPattern: 'src/**' },
        { right: 'write', effect: 'allow', pathPattern: 'config/**' },
        { right: 'create', effect: 'allow', pathPattern: 'src/**', filePattern: '*.ts' },
        { right: 'create', effect: 'allow', pathPattern: 'src/**', filePattern: '*.tsx' },
        { right: 'delete', effect: 'allow', pathPattern: 'src/**' },
      ],
    });

    expect(engine.checkPath('config/app.json', 'write', CWD).allowed).toBe(true);
  });
});
