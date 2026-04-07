import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  visitSourceFile,
  runAstVisitor,
  normalizePath,
  tokenizeName,
  type AstVisitorResult,
} from './ast-visitor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const fixturesDir = join(__dirname, '..', '__fixtures__', 'ast-samples');

// ── Helpers ─────────────────────────────────────────────────────────────────

function parseFixture(code: string, fileName = 'test.ts'): ts.SourceFile {
  return ts.createSourceFile(fileName, code, ts.ScriptTarget.ESNext, true);
}

async function loadAndParse(fixtureName: string): Promise<ts.SourceFile> {
  const filePath = join(fixturesDir, fixtureName);
  const code = await readFile(filePath, 'utf-8');
  return parseFixture(code, fixtureName);
}

// ── 1. Entity discovery ────────────────────────────────────────────────────

describe('entity discovery', () => {
  it('discovers file entity + function entity from simple-function.ts', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const kinds = entities.map((e) => e.kind);
    expect(kinds).toContain('file');
    expect(kinds).toContain('function');

    const fileEntity = entities.find((e) => e.kind === 'file');
    expect(fileEntity).toBeDefined();
    expect(fileEntity!.id).toBe('file:simple-function.ts');
    expect(fileEntity!.name).toBe('simple-function.ts');

    const funcEntity = entities.find((e) => e.kind === 'function');
    expect(funcEntity).toBeDefined();
    expect(funcEntity!.id).toBe('function:simple-function.ts:calculateTotal');
    expect(funcEntity!.name).toBe('calculateTotal');
  });

  it('discovers class + methods + interfaces from class-with-methods.ts', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const kinds = entities.map((e) => e.kind);
    expect(kinds).toContain('file');
    expect(kinds).toContain('class');
    expect(kinds).toContain('method');
    expect(kinds).toContain('interface');

    const classEntity = entities.find((e) => e.kind === 'class');
    expect(classEntity).toBeDefined();
    expect(classEntity!.name).toBe('UserService');
    expect(classEntity!.id).toBe('class:class-with-methods.ts:UserService');

    const methods = entities.filter((e) => e.kind === 'method');
    const methodNames = methods.map((m) => m.name);
    expect(methodNames).toContain('constructor');
    expect(methodNames).toContain('addUser');
    expect(methodNames).toContain('getUser');
    expect(methodNames).toContain('removeUser');

    const interfaces = entities.filter((e) => e.kind === 'interface');
    expect(interfaces.length).toBe(2);
    const ifaceNames = interfaces.map((i) => i.name);
    expect(ifaceNames).toContain('User');
    expect(ifaceNames).toContain('Logger');
  });

  it('discovers interface with isInterface=true, isTypeOnly=true', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const repoInterface = entities.find(
      (e) => e.kind === 'interface' && e.name === 'Repository',
    );
    expect(repoInterface).toBeDefined();
    expect(repoInterface!.classification.isInterface).toBe(true);
    expect(repoInterface!.classification.isTypeOnly).toBe(true);
    expect(repoInterface!.classification.isConcrete).toBe(false);
  });

  it('discovers abstract class with isAbstract=true', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const baseEntity = entities.find(
      (e) => e.kind === 'class' && e.name === 'BaseEntity',
    );
    expect(baseEntity).toBeDefined();
    expect(baseEntity!.classification.isAbstract).toBe(true);
    expect(baseEntity!.classification.isConcrete).toBe(false);
  });

  it('detects exported vs non-exported entities', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const userService = entities.find(
      (e) => e.kind === 'class' && e.name === 'UserService',
    );
    expect(userService!.classification.isExported).toBe(true);

    const userInterface = entities.find(
      (e) => e.kind === 'interface' && e.name === 'User',
    );
    expect(userInterface!.classification.isExported).toBe(false);
  });

  it('produces deterministic entity IDs', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'src/services/user.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    expect(classEntity!.id).toBe('class:src/services/user.ts:UserService');

    const addUserMethod = entities.find(
      (e) => e.kind === 'method' && e.name === 'addUser',
    );
    expect(addUserMethod!.id).toBe(
      'method:src/services/user.ts:UserService.addUser',
    );
  });

  it('discovers type aliases', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const typeAlias = entities.find((e) => e.kind === 'type-alias');
    expect(typeAlias).toBeDefined();
    expect(typeAlias!.name).toBe('Predicate');
    expect(typeAlias!.classification.isTypeOnly).toBe(true);
    expect(typeAlias!.classification.isExported).toBe(true);
  });

  it('discovers fields on a class', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const fields = entities.filter((e) => e.kind === 'field');
    const fieldNames = fields.map((f) => f.name);
    expect(fieldNames).toContain('users');
    expect(fieldNames).toContain('logger');

    const usersField = fields.find((f) => f.name === 'users');
    expect(usersField!.classification.visibility).toBe('private');
  });

  it('discovers abstract methods on abstract class', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const abstractMethods = entities.filter(
      (e) => e.kind === 'method' && e.classification.isAbstract,
    );
    expect(abstractMethods.length).toBeGreaterThanOrEqual(2);
    const names = abstractMethods.map((m) => m.name);
    expect(names).toContain('id');
    expect(names).toContain('validate');
  });
});

// ── 2. Raw counts ──────────────────────────────────────────────────────────

describe('raw counts', () => {
  it('counts branch points in simple-function.ts: 2 ifs + 1 for = 3', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.rawCounts).toBeDefined();
    expect(func!.rawCounts!.branchPoints).toBe(3);
  });

  it('counts nesting contributions with correct depth in complex-nesting.ts', async () => {
    const sf = await loadAndParse('complex-nesting.ts');
    const entities = visitSourceFile(sf, 'complex-nesting.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.rawCounts).toBeDefined();
    expect(func!.rawCounts!.nestingContributions).toBeDefined();

    const contributions = func!.rawCounts!.nestingContributions!;
    expect(contributions.length).toBeGreaterThan(0);

    // The outermost for is at depth 0
    expect(contributions[0]).toEqual({ depth: 0, increment: 1 });

    // There should be deeper nesting (depth 1, 2, 3)
    const maxDepth = Math.max(...contributions.map((c) => c.depth));
    expect(maxDepth).toBeGreaterThanOrEqual(3);
  });

  it('computes correct lines of code per entity', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.rawCounts!.linesOfCode).toBe(12);

    const fileEntity = entities.find((e) => e.kind === 'file');
    expect(fileEntity).toBeDefined();
    expect(fileEntity!.rawCounts!.linesOfCode).toBeGreaterThanOrEqual(12);
  });

  it('detects typeof type checking patterns in complex-nesting.ts', async () => {
    const sf = await loadAndParse('complex-nesting.ts');
    const entities = visitSourceFile(sf, 'complex-nesting.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func).toBeDefined();
    expect(func!.rawCounts!.typeCheckingPatterns).toBeGreaterThanOrEqual(2);
  });

  it('counts parameters on functions', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func!.rawCounts!.parameterCount).toBe(2);
  });

  it('counts return statements', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func!.rawCounts!.returnStatements).toBe(1);
  });

  it('provides Halstead operator and operand counts', async () => {
    const sf = await loadAndParse('simple-function.ts');
    const entities = visitSourceFile(sf, 'simple-function.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func!.rawCounts!.operators).toBeDefined();
    expect(func!.rawCounts!.operators!.distinct).toBeGreaterThan(0);
    expect(func!.rawCounts!.operators!.total).toBeGreaterThan(0);
    expect(func!.rawCounts!.operands).toBeDefined();
    expect(func!.rawCounts!.operands!.distinct).toBeGreaterThan(0);
    expect(func!.rawCounts!.operands!.total).toBeGreaterThan(0);
  });

  it('counts branch points including && operator in complex-nesting.ts', async () => {
    const sf = await loadAndParse('complex-nesting.ts');
    const entities = visitSourceFile(sf, 'complex-nesting.ts');

    const func = entities.find((e) => e.kind === 'function');
    expect(func!.rawCounts!.branchPoints).toBeDefined();
    // for, if(typeof), if(length), for, if(char), if(typeof), if(item > 0 && item < 100) + && = many
    expect(func!.rawCounts!.branchPoints).toBeGreaterThanOrEqual(7);
  });

  it('counts public methods/properties on class', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    expect(classEntity!.rawCounts!.publicMethodCount).toBe(3);
    // users and logger are private, so 0 public properties
    expect(classEntity!.rawCounts!.publicPropertyCount).toBe(0);
  });

  it('counts public methods on interface', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const repoInterface = entities.find(
      (e) => e.kind === 'interface' && e.name === 'Repository',
    );
    expect(repoInterface!.rawCounts!.publicMethodCount).toBe(4);
    expect(repoInterface!.rawCounts!.publicPropertyCount).toBe(0);
  });
});

// ── 3. Method-field access matrix ──────────────────────────────────────────

describe('method-field access matrix', () => {
  it('extracts correct this.field accesses for UserService methods', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    expect(classEntity).toBeDefined();
    expect(classEntity!.methodFieldAccessMatrix).toBeDefined();

    const matrix = classEntity!.methodFieldAccessMatrix!;

    const addUser = matrix.find((m) => m.methodName === 'addUser');
    expect(addUser).toBeDefined();
    expect(addUser!.accessedFields).toContain('users');
    expect(addUser!.accessedFields).toContain('logger');

    const getUser = matrix.find((m) => m.methodName === 'getUser');
    expect(getUser).toBeDefined();
    expect(getUser!.accessedFields).toContain('users');
    expect(getUser!.accessedFields).not.toContain('logger');
  });

  it('identifies methods that share field access', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    const matrix = classEntity!.methodFieldAccessMatrix!;

    const addUser = matrix.find((m) => m.methodName === 'addUser');
    const removeUser = matrix.find((m) => m.methodName === 'removeUser');

    expect(addUser!.accessedFields).toContain('users');
    expect(removeUser!.accessedFields).toContain('users');
  });

  it('returns empty accessedFields for methods without this.xyz', () => {
    const code = `
class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'test.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    const matrix = classEntity!.methodFieldAccessMatrix!;

    const add = matrix.find((m) => m.methodName === 'add');
    expect(add).toBeDefined();
    expect(add!.accessedFields).toEqual([]);
  });

  it('includes constructor field access', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    const matrix = classEntity!.methodFieldAccessMatrix!;

    const ctor = matrix.find((m) => m.methodName === 'constructor');
    expect(ctor).toBeDefined();
    expect(ctor!.accessedFields).toContain('logger');
  });
});

// ── 4. Classification ──────────────────────────────────────────────────────

describe('classification', () => {
  it('detects visibility on class members', async () => {
    const sf = await loadAndParse('class-with-methods.ts');
    const entities = visitSourceFile(sf, 'class-with-methods.ts');

    const usersField = entities.find(
      (e) => e.kind === 'field' && e.name === 'users',
    );
    expect(usersField!.classification.visibility).toBe('private');

    // addUser has no explicit visibility modifier → null
    const addUserMethod = entities.find(
      (e) => e.kind === 'method' && e.name === 'addUser',
    );
    expect(addUserMethod!.classification.visibility).toBe(null);
  });

  it('interface members have public visibility on interface methods (counted as public)', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const repo = entities.find(
      (e) => e.kind === 'interface' && e.name === 'Repository',
    );
    // Interface members are all public by nature, captured in rawCounts
    expect(repo!.rawCounts!.publicMethodCount).toBe(4);
  });

  it('detects concrete methods on abstract class', async () => {
    const sf = await loadAndParse('interface-and-types.ts');
    const entities = visitSourceFile(sf, 'interface-and-types.ts');

    const isValid = entities.find(
      (e) => e.kind === 'method' && e.name === 'isValid',
    );
    expect(isValid).toBeDefined();
    expect(isValid!.classification.isAbstract).toBe(false);
    expect(isValid!.classification.isConcrete).toBe(true);
  });
});

// ── 5. Integration tests ───────────────────────────────────────────────────

describe('visitSourceFile integration', () => {
  it('parses a string into SourceFile and returns complete results', () => {
    const code = `
export function greet(name: string): string {
  if (name.length > 0) {
    return \`Hello, \${name}!\`;
  }
  return 'Hello, stranger!';
}
`;
    const sf = parseFixture(code, 'greet.ts');
    const entities = visitSourceFile(sf, 'greet.ts');

    expect(entities.length).toBeGreaterThanOrEqual(2);
    const fileEntity = entities.find((e) => e.kind === 'file');
    const funcEntity = entities.find((e) => e.kind === 'function');

    expect(fileEntity).toBeDefined();
    expect(fileEntity!.id).toBe('file:greet.ts');

    expect(funcEntity).toBeDefined();
    expect(funcEntity!.id).toBe('function:greet.ts:greet');
    expect(funcEntity!.rawCounts!.branchPoints).toBe(1); // one if
    expect(funcEntity!.rawCounts!.parameterCount).toBe(1);
    expect(funcEntity!.rawCounts!.returnStatements).toBe(2);
    expect(funcEntity!.classification.isExported).toBe(true);
  });

  it('processes multiple files and gives correct filePaths', async () => {
    const sf1 = await loadAndParse('simple-function.ts');
    const sf2 = await loadAndParse('class-with-methods.ts');

    const e1 = visitSourceFile(sf1, 'src/simple-function.ts');
    const e2 = visitSourceFile(sf2, 'src/class-with-methods.ts');

    const all = [...e1, ...e2];

    // Each file has its own file entity with correct path
    const files = all.filter((e) => e.kind === 'file');
    expect(files.length).toBe(2);
    expect(files.map((f) => f.filePath).sort()).toEqual([
      'src/class-with-methods.ts',
      'src/simple-function.ts',
    ]);

    // All entities from file 1 have correct filePath
    for (const e of e1) {
      expect(e.filePath).toBe('src/simple-function.ts');
    }
    for (const e of e2) {
      expect(e.filePath).toBe('src/class-with-methods.ts');
    }
  });
});

// ── 6. runAstVisitor (full adapter) ────────────────────────────────────────

describe('runAstVisitor', () => {
  it('processes fixture files and returns entities with toolRun', async () => {
    const result = await runAstVisitor({
      rootDir: fixturesDir,
      files: ['simple-function.ts', 'class-with-methods.ts'],
    });

    expect(result.toolRun.tool).toBe('typescript-ast');
    expect(result.toolRun.aspect).toBe('entityExtraction');
    expect(result.toolRun.exitCode).toBe(0);
    expect(result.toolRun.duration).toBeGreaterThanOrEqual(0);
    expect(result.toolRun.version).toBeDefined();

    expect(result.entities.length).toBeGreaterThanOrEqual(4);

    const files = result.entities.filter((e) => e.kind === 'file');
    expect(files.length).toBe(2);
  });

  it('warns for missing files instead of crashing', async () => {
    const result = await runAstVisitor({
      rootDir: fixturesDir,
      files: ['nonexistent.ts'],
    });

    expect(result.toolRun.exitCode).toBe(0);
    expect(result.toolRun.warnings.length).toBeGreaterThanOrEqual(1);
    expect(result.toolRun.warnings[0]).toContain('nonexistent.ts');
  });
});

// ── 7. Utility helpers ─────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('converts backslashes to forward slashes', () => {
    expect(normalizePath('src\\services\\user.ts')).toBe(
      'src/services/user.ts',
    );
  });

  it('strips leading "./"', () => {
    expect(normalizePath('./src/index.ts')).toBe('src/index.ts');
  });

  it('passes through already-normalized paths', () => {
    expect(normalizePath('src/index.ts')).toBe('src/index.ts');
  });
});

describe('tokenizeName', () => {
  it('splits camelCase', () => {
    expect(tokenizeName('calculateTotal')).toEqual(['calculate', 'total']);
  });

  it('splits PascalCase', () => {
    expect(tokenizeName('UserService')).toEqual(['user', 'service']);
  });

  it('handles single word', () => {
    expect(tokenizeName('index')).toEqual(['index']);
  });

  it('handles constructor', () => {
    expect(tokenizeName('constructor')).toEqual(['constructor']);
  });

  it('handles anonymous names', () => {
    expect(tokenizeName('<anonymous>')).toEqual(['<anonymous>']);
  });
});

// ── 8. Arrow function / variable export detection ──────────────────────────

describe('arrow function detection', () => {
  it('discovers exported arrow functions as function entities', () => {
    const code = `
export const add = (a: number, b: number): number => a + b;
export const multiply = function(a: number, b: number): number { return a * b; };
`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'math.ts');

    const funcs = entities.filter((e) => e.kind === 'function');
    expect(funcs.length).toBe(2);

    const names = funcs.map((f) => f.name).sort();
    expect(names).toEqual(['add', 'multiply']);

    for (const f of funcs) {
      expect(f.classification.isExported).toBe(true);
    }
  });

  it('discovers wrapped/HOC function patterns (memo, forwardRef)', () => {
    const code = `
import { memo, forwardRef } from 'react';
export const AgentNode = memo(({ data }: { data: any }) => {
  return <div>{data.label}</div>;
});
export const Panel = forwardRef((props: any, ref: any) => {
  return <div ref={ref}>{props.children}</div>;
});
export const Wrapped = memo(forwardRef((props: any, ref: any) => {
  return <span ref={ref} />;
}));
`;
    const sf = parseFixture(code, 'components.tsx');
    const entities = visitSourceFile(sf, 'components.tsx');

    const funcs = entities.filter((e) => e.kind === 'function');
    expect(funcs.map((f) => f.name).sort()).toEqual(['AgentNode', 'Panel', 'Wrapped']);

    for (const f of funcs) {
      expect(f.classification.isExported).toBe(true);
      expect(f.rawCounts?.linesOfCode).toBeGreaterThan(0);
    }
  });

  it('discovers exported standalone constants as field entities', () => {
    const code = `
export const MAX_RETRIES = 3;
export const DEFAULT_CONFIG = { timeout: 5000, retries: 3 };
const internal = 'hidden';
`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'constants.ts');

    const fields = entities.filter((e) => e.kind === 'field');
    expect(fields.map((f) => f.name).sort()).toEqual(['DEFAULT_CONFIG', 'MAX_RETRIES']);

    for (const f of fields) {
      expect(f.classification.isExported).toBe(true);
    }
    // Non-exported const should not appear as an entity
    expect(entities.find((e) => e.name === 'internal')).toBeUndefined();
  });
});

// ── 9. Enum detection ──────────────────────────────────────────────────────

describe('enum detection', () => {
  it('discovers enum entities', () => {
    const code = `
export enum Color {
  Red,
  Green,
  Blue,
}
`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'colors.ts');

    const enumEntity = entities.find((e) => e.kind === 'enum');
    expect(enumEntity).toBeDefined();
    expect(enumEntity!.name).toBe('Color');
    expect(enumEntity!.id).toBe('enum:colors.ts:Color');
    expect(enumEntity!.classification.isExported).toBe(true);
    expect(enumEntity!.rawCounts!.linesOfCode).toBeGreaterThanOrEqual(4);
  });
});

// ── 10. Edge cases / resilience ────────────────────────────────────────────

describe('resilience', () => {
  it('handles empty file without crashing', () => {
    const sf = parseFixture('');
    const entities = visitSourceFile(sf, 'empty.ts');

    expect(entities.length).toBe(1); // Just the file entity
    expect(entities[0].kind).toBe('file');
  });

  it('handles file with only comments', () => {
    const code = `
// This is a comment
/* Multi-line
   comment */
`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'comments.ts');

    expect(entities.length).toBe(1); // Just the file entity
  });

  it('handles class with no methods', () => {
    const code = `class Empty {}`;
    const sf = parseFixture(code);
    const entities = visitSourceFile(sf, 'empty-class.ts');

    const classEntity = entities.find((e) => e.kind === 'class');
    expect(classEntity).toBeDefined();
    expect(classEntity!.methodFieldAccessMatrix).toEqual([]);
  });
});
