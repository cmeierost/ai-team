import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextLevel, type Agent, type PermissionConfig } from '../types/index.js';
import { createAccessEngine } from '../context/access-adapter.js';
import { ToolManager } from './tool-manager.js';
import { ALL_TOOLS } from './index.js';
import { stripLineNumberPrefixes } from './edit-tools.js';

describe('stripLineNumberPrefixes', () => {
  it('strips sequential fs_read-style prefixes', () => {
    const input = [
      '10: function demo(): string {',
      '11:   return "done";',
      '12:   console.log("unreachable");',
      '13: }',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(
      [
        'function demo(): string {',
        '  return "done";',
        '  console.log("unreachable");',
        '}',
      ].join('\n'),
    );
  });

  it('leaves single-line text unchanged', () => {
    const result = stripLineNumberPrefixes('42: only one line');
    expect(result.stripped).toBe(false);
    expect(result.text).toBe('42: only one line');
  });

  it('leaves text without line-number prefixes unchanged', () => {
    const input = 'const a = 1;\nconst b = 2;\nconst c = 3;\n';
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe(input);
  });

  it('rejects non-sequential numbers', () => {
    const input = ['1: first', '5: jumped', '6: next'].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
  });

  it('rejects when fewer than 80% of lines match', () => {
    const input = [
      '1: prefixed',
      'not prefixed',
      'also not prefixed',
      '4: prefixed again',
      'nope',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
  });

  it('handles lines starting with a number that is not a prefix', () => {
    const input = [
      'const x = 42;',
      'const y = 100;',
      'return x + y;',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe(input);
  });

  it('strips correctly with a trailing empty line', () => {
    const input = ['1: line one', '2: line two', '3: '].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(['line one', 'line two', ''].join('\n'));
  });

  it('preserves content after the prefix including colons', () => {
    const input = ['7: key: value', '8: other: stuff'].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(['key: value', 'other: stuff'].join('\n'));
  });

  it('handles large line numbers from a deep offset (fs_read with offset)', () => {
    const input = [
      '1042: export class SessionStore {',
      '1043:   private db: Database;',
      '1044:   constructor(db: Database) {',
      '1045:     this.db = db;',
      '1046:   }',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(
      [
        'export class SessionStore {',
        '  private db: Database;',
        '  constructor(db: Database) {',
        '    this.db = db;',
        '  }',
      ].join('\n'),
    );
  });

  it('does not false-positive on YAML-like "key: value" lines', () => {
    const input = [
      'name: my-service',
      'version: 1.0.0',
      'description: a service',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
    expect(result.text).toBe(input);
  });

  it('does not false-positive on timestamp-prefixed log lines', () => {
    const input = [
      '12: 30: 45 INFO server started',
      '12: 30: 46 DEBUG connected',
      '12: 30: 47 INFO ready',
    ].join('\n');
    // Numbers 12, 12, 12 are not sequential → rejected
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
  });

  it('strips when exactly at the 80% threshold', () => {
    // 5 lines: 4 match (80%), 1 blank does not
    const input = [
      '10: const a = 1;',
      '11: const b = 2;',
      '12: const c = 3;',
      '13: const d = 4;',
      '',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(
      ['const a = 1;', 'const b = 2;', 'const c = 3;', 'const d = 4;', ''].join('\n'),
    );
  });

  it('rejects when just below the 80% threshold', () => {
    // 5 lines: 3 match (60%), 2 don't
    const input = [
      '10: const a = 1;',
      '// comment',
      '12: const c = 3;',
      '// another',
      '14: const e = 5;',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
  });

  it('handles a realistic LLM-copied newString with numbered code', () => {
    // Simulates what Ethan would paste as newString after reading a function
    const input = [
      '17: function demo(): string {',
      '18:   return "done";',
      '19: }',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(
      ['function demo(): string {', '  return "done";', '}'].join('\n'),
    );
  });

  it('returns empty text correctly when all lines are just numbers', () => {
    const input = ['1: ', '2: ', '3: '].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(['', '', ''].join('\n'));
  });

  it('preserves indentation after stripping', () => {
    const input = [
      '5:     if (x) {',
      '6:       doSomething();',
      '7:     }',
    ].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(true);
    expect(result.text).toBe(
      ['    if (x) {', '      doSomething();', '    }'].join('\n'),
    );
  });

  it('leaves empty string unchanged', () => {
    const result = stripLineNumberPrefixes('');
    expect(result.stripped).toBe(false);
    expect(result.text).toBe('');
  });

  it('does not strip when numbers look sequential but have gaps from blank lines', () => {
    // Lines 1, 3, 5 — not sequential
    const input = ['1: a', '3: b', '5: c'].join('\n');
    const result = stripLineNumberPrefixes(input);
    expect(result.stripped).toBe(false);
  });
});

// ============================================================================
// Integration test helpers
// ============================================================================

const workspaces: string[] = [];

function perms(p: { read?: string[]; write?: string[]; create?: string[]; delete?: string[] }): PermissionConfig {
  return {
    read: p.read ?? [],
    write: p.write ?? [],
    create: p.create ?? [],
    delete: p.delete ?? [],
  };
}

function makeEditAgent(id: string): Agent {
  return {
    id,
    name: `Agent ${id}`,
    role: 'developer',
    contextLevel: ContextLevel.MODULE,
    filePath: `.ai-team/agents/${id}.agent.yml`,
    skillPath: `.ai-team/agents/${id}`,
    createdAt: new Date().toISOString(),
    permissions: perms({ read: ['**'], write: ['**'], create: ['**'], delete: ['**'] }),
    tools: ['fs_read', 'fs_edit', 'apply_patch', 'multiedit'],
  };
}

async function createWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ai-team-edit-tools-'));
  workspaces.push(dir);
  return dir;
}

function setupManager(workspaceRoot: string, agent: Agent) {
  const engine = createAccessEngine({ workspaceRoot, agents: [agent] });
  const manager = new ToolManager(workspaceRoot, engine);
  for (const tool of Object.values(ALL_TOOLS)) manager.register(tool);
  return { engine, manager };
}

/** Build the minimal context object ToolManager.execute expects. */
function ctx(ws: string, agent: Agent) {
  return { agentId: agent.id, workspaceRoot: ws };
}

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

// ============================================================================
// fs_edit
// ============================================================================

describe('fs_edit', () => {
  it('performs a single replacement and returns _fileChanges', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const filePath = path.join(ws, 'app.ts');
    await fs.writeFile(filePath, 'const x = 1;\nconst y = 2;\n', 'utf8');

    // fs_edit requires a prior fs_read
    await manager.execute(agent, 'fs_read', { filePath: 'app.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'fs_edit',
      { filePath: 'app.ts', oldString: 'const x = 1;', newString: 'const x = 42;' },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.edited).toBe(true);
    expect(payload.replacements).toBe(1);

    const disk = await fs.readFile(filePath, 'utf8');
    expect(disk).toBe('const x = 42;\nconst y = 2;\n');

    // _fileChanges tracks old and new full content
    expect(payload._fileChanges).toHaveLength(1);
    expect(payload._fileChanges[0].oldContent).toContain('const x = 1;');
    expect(payload._fileChanges[0].newContent).toContain('const x = 42;');
  });

  it('strips line-number prefixes from oldString and newString before matching', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const filePath = path.join(ws, 'demo.ts');
    await fs.writeFile(filePath, 'function demo(): string {\n  return "done";\n  console.log("unreachable");\n}\n', 'utf8');

    await manager.execute(agent, 'fs_read', { filePath: 'demo.ts' }, ctx(ws, agent));

    // Simulate LLM pasting fs_read output with line numbers into both old and new
    const result = await manager.execute(
      agent,
      'fs_edit',
      {
        filePath: 'demo.ts',
        oldString: '1: function demo(): string {\n2:   return "done";\n3:   console.log("unreachable");\n4: }',
        newString: '1: function demo(): string {\n2:   return "done";\n3: }',
      },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.edited).toBe(true);

    // The file on disk should NOT have line numbers
    const disk = await fs.readFile(filePath, 'utf8');
    expect(disk).not.toContain('1: function');
    expect(disk).toBe('function demo(): string {\n  return "done";\n}\n');
  });

  it('fails when oldString is not found', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'file.ts'), 'const a = 1;\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'file.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'fs_edit',
      { filePath: 'file.ts', oldString: 'not in file', newString: 'whatever' },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.edited).toBe(false);
    expect(payload.error).toContain('not found');
  });

  it('fails when file was not read first', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'unread.ts'), 'content\n', 'utf8');

    const result = await manager.execute(
      agent,
      'fs_edit',
      { filePath: 'unread.ts', oldString: 'content', newString: 'replaced' },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.edited).toBe(false);
    expect(payload.hint).toContain('fs_read');
  });

  it('rejects ambiguous oldString with multiple matches', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'dup.ts'), 'aaa\nbbb\naaa\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'dup.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'fs_edit',
      { filePath: 'dup.ts', oldString: 'aaa', newString: 'ccc' },
      ctx(ws, agent),
    );

    const payload = result.result as any;
    expect(payload.edited).toBe(false);
    expect(payload.error).toContain('2 times');
  });

  it('replaces all occurrences with replaceAll: true', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'multi.ts'), 'aaa\nbbb\naaa\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'multi.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'fs_edit',
      { filePath: 'multi.ts', oldString: 'aaa', newString: 'ccc', replaceAll: true },
      ctx(ws, agent),
    );

    const payload = result.result as any;
    expect(payload.edited).toBe(true);
    expect(payload.replacements).toBe(2);
    expect(await fs.readFile(path.join(ws, 'multi.ts'), 'utf8')).toBe('ccc\nbbb\nccc\n');
  });
});

// ============================================================================
// apply_patch
// ============================================================================

describe('apply_patch', () => {
  it('applies a unified diff to update a file', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const filePath = path.join(ws, 'hello.ts');
    await fs.writeFile(filePath, 'function greet() {\n  return "hello";\n}\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'hello.ts' }, ctx(ws, agent));

    const patchText = [
      '--- hello.ts',
      '+++ hello.ts',
      '@@ -1,3 +1,3 @@',
      ' function greet() {',
      '-  return "hello";',
      '+  return "hi";',
      ' }',
    ].join('\n');

    const result = await manager.execute(
      agent,
      'apply_patch',
      { patchText },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.applied.length).toBe(1);

    const disk = await fs.readFile(filePath, 'utf8');
    expect(disk).toContain('return "hi"');

    expect(payload._fileChanges).toHaveLength(1);
    expect(payload._fileChanges[0].oldContent).toContain('return "hello"');
    expect(payload._fileChanges[0].newContent).toContain('return "hi"');
  });

  it('creates a new file via add patch', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const patchText = [
      '--- /dev/null',
      '+++ newfile.ts',
      '@@ -0,0 +1,2 @@',
      '+export const value = 99;',
      '+',
    ].join('\n');

    const result = await manager.execute(
      agent,
      'apply_patch',
      { patchText },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.applied.length).toBe(1);

    const disk = await fs.readFile(path.join(ws, 'newfile.ts'), 'utf8');
    expect(disk).toContain('export const value = 99');
  });

  it('returns error for invalid patch text', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const result = await manager.execute(
      agent,
      'apply_patch',
      { patchText: 'this is not a valid patch at all' },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.error).toBeTruthy();
  });
});

// ============================================================================
// multiedit
// ============================================================================

describe('multiedit', () => {
  it('applies multiple sequential edits to the same file', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const filePath = path.join(ws, 'multi.ts');
    await fs.writeFile(filePath, 'const a = 1;\nconst b = 2;\nconst c = 3;\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'multi.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'multiedit',
      {
        filePath: 'multi.ts',
        edits: [
          { oldString: 'const a = 1;', newString: 'const a = 10;' },
          { oldString: 'const c = 3;', newString: 'const c = 30;' },
        ],
      },
      ctx(ws, agent),
    );

    expect(result.ok).toBe(true);
    const payload = result.result as any;
    expect(payload.succeeded).toBe(2);
    expect(payload.totalEdits).toBe(2);

    const disk = await fs.readFile(filePath, 'utf8');
    expect(disk).toBe('const a = 10;\nconst b = 2;\nconst c = 30;\n');
  });

  it('returns aggregated _fileChanges tracking first old and last new', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    const original = 'let x = 1;\nlet y = 2;\n';
    await fs.writeFile(path.join(ws, 'agg.ts'), original, 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'agg.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'multiedit',
      {
        filePath: 'agg.ts',
        edits: [
          { oldString: 'let x = 1;', newString: 'let x = 10;' },
          { oldString: 'let y = 2;', newString: 'let y = 20;' },
        ],
      },
      ctx(ws, agent),
    );

    const payload = result.result as any;
    expect(payload._fileChanges).toHaveLength(1);
    // oldContent is from BEFORE the first edit
    expect(payload._fileChanges[0].oldContent).toBe(original);
    // newContent is from AFTER the last edit
    expect(payload._fileChanges[0].newContent).toBe('let x = 10;\nlet y = 20;\n');
  });

  it('sub-results do not contain _fileChanges', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'sub.ts'), 'aaa\nbbb\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'sub.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'multiedit',
      {
        filePath: 'sub.ts',
        edits: [{ oldString: 'aaa', newString: 'xxx' }],
      },
      ctx(ws, agent),
    );

    const payload = result.result as any;
    for (const r of payload.results) {
      expect(r.result).not.toHaveProperty('_fileChanges');
    }
  });

  it('stops at the first failing edit and reports failedAtIndex', async () => {
    const ws = await createWorkspace();
    const agent = makeEditAgent('ethan');
    const { manager } = setupManager(ws, agent);

    await fs.writeFile(path.join(ws, 'fail.ts'), 'line1\nline2\n', 'utf8');
    await manager.execute(agent, 'fs_read', { filePath: 'fail.ts' }, ctx(ws, agent));

    const result = await manager.execute(
      agent,
      'multiedit',
      {
        filePath: 'fail.ts',
        edits: [
          { oldString: 'line1', newString: 'changed1' },
          { oldString: 'DOES NOT EXIST', newString: 'whatever' },
          { oldString: 'line2', newString: 'changed2' },
        ],
      },
      ctx(ws, agent),
    );

    const payload = result.result as any;
    expect(payload.succeeded).toBe(1);
    expect(payload.failedAtIndex).toBe(1);
    expect(payload.error).toContain('not found');

    // Third edit should not have been applied
    const disk = await fs.readFile(path.join(ws, 'fail.ts'), 'utf8');
    expect(disk).toBe('changed1\nline2\n');
  });
});
