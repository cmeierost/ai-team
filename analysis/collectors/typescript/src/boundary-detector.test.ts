import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  detectPackageBoundaries,
  detectFacadeBoundaries,
  detectDirectoryBoundaries,
  detectModuleBoundaries,
} from './boundary-detector.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const TEST_ROOT = join(import.meta.dirname!, '__fixtures__', '_boundary_test');

function mkDir(...segments: string[]): void {
  mkdirSync(join(TEST_ROOT, ...segments), { recursive: true });
}

function mkFile(segments: string[], content: string): void {
  const dir = segments.slice(0, -1);
  if (dir.length) {
    mkDir(...dir);
  } else {
    mkdirSync(TEST_ROOT, { recursive: true });
  }
  writeFileSync(join(TEST_ROOT, ...segments), content, 'utf-8');
}

// ---------------------------------------------------------------------------
// Scaffold a mini monorepo fixture:
//
// _boundary_test/
// ├── package.json              (workspaces: ["packages/*"])
// ├── packages/
// │   ├── core/
// │   │   ├── package.json      (name: "@my/core")
// │   │   └── src/
// │   │       ├── index.ts      (root barrel — skipped by facade)
// │   │       ├── agent/
// │   │       │   └── index.ts  (3 re-exports → facade)
// │   │       ├── utils/
// │   │       │   └── index.ts  (no re-exports → NOT facade)
// │   │       └── empty/        (empty dir)
// │   ├── web/
// │   │   ├── package.json      (name: "@my/web")
// │   │   └── src/
// │   │       ├── index.tsx     (root barrel — skipped by facade)
// │   │       └── components/
// │   │           └── index.tsx  (2 re-exports → facade)
// │   └── no-name/
// │       └── package.json      (no name field)
// ├── node_modules/
// │   └── dep/
// │       └── package.json      (should be skipped)
// └── libs/
//     └── shared/
//         ├── package.json      (name: "@my/shared")
//         └── src/
//             └── helpers/
//                 └── index.ts   (1 re-export → facade)
// ---------------------------------------------------------------------------

beforeAll(() => {
  // Root
  mkFile(['package.json'], JSON.stringify({ name: 'root', workspaces: ['packages/*'] }));

  // packages/core
  mkFile(['packages', 'core', 'package.json'], JSON.stringify({ name: '@my/core' }));
  mkFile(['packages', 'core', 'src', 'index.ts'], "export * from './agent/index.js';\n");
  mkFile(
    ['packages', 'core', 'src', 'agent', 'index.ts'],
    [
      "export * from './runner.js';",
      "export { AgentConfig } from './config.js';",
      "export { default as createAgent } from './factory.js';",
    ].join('\n'),
  );
  mkFile(['packages', 'core', 'src', 'utils', 'index.ts'], '// no re-exports\nexport const VERSION = 1;\n');
  mkDir('packages', 'core', 'src', 'empty');

  // packages/web
  mkFile(['packages', 'web', 'package.json'], JSON.stringify({ name: '@my/web' }));
  mkFile(['packages', 'web', 'src', 'index.tsx'], "export * from './components/index.js';\n");
  mkFile(
    ['packages', 'web', 'src', 'components', 'index.tsx'],
    "export * from './Button.js';\nexport { default as Card } from './Card.js';\n",
  );

  // packages/no-name (missing name field)
  mkFile(['packages', 'no-name', 'package.json'], JSON.stringify({ version: '0.0.1' }));

  // node_modules (should be skipped everywhere)
  mkFile(['node_modules', 'dep', 'package.json'], JSON.stringify({ name: 'dep' }));

  // libs/shared (not a workspace — found via srcDirs walk)
  mkFile(['libs', 'shared', 'package.json'], JSON.stringify({ name: '@my/shared' }));
  mkFile(
    ['libs', 'shared', 'src', 'helpers', 'index.ts'],
    "export { formatDate } from './date.js';\n",
  );
});

afterAll(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('detectPackageBoundaries', () => {
  it('finds package.json files and reads name', () => {
    const result = detectPackageBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages'],
    });
    const ids = result.map((b) => b.moduleId).sort();
    expect(ids).toContain('@my/core');
    expect(ids).toContain('@my/web');
    result.forEach((b) => {
      expect(b.kind).toBe('package');
      expect(b.isPackage).toBe(true);
    });
  });

  it('skips node_modules', () => {
    const result = detectPackageBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['.'],
    });
    const ids = result.map((b) => b.moduleId);
    expect(ids).not.toContain('dep');
  });

  it('uses modulePath as moduleId when name is missing', () => {
    const result = detectPackageBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/no-name'],
    });
    expect(result.length).toBeGreaterThanOrEqual(1);
    const noName = result.find((b) => b.modulePath === 'packages/no-name');
    expect(noName).toBeDefined();
    expect(noName!.moduleId).toBe('packages/no-name');
  });

  it('detects workspace packages from root package.json', () => {
    const result = detectPackageBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: [], // srcDirs empty — workspace detection only
    });
    const ids = result.map((b) => b.moduleId).sort();
    expect(ids).toContain('@my/core');
    expect(ids).toContain('@my/web');
  });
});

describe('detectFacadeBoundaries', () => {
  it('detects re-export index files as facades', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    const paths = result.map((b) => b.modulePath);
    expect(paths).toContain('packages/core/src/agent');
  });

  it('does not count root barrel as facade', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    const paths = result.map((b) => b.modulePath);
    expect(paths).not.toContain('packages/core/src');
  });

  it('skips index files with no re-exports', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    const paths = result.map((b) => b.modulePath);
    expect(paths).not.toContain('packages/core/src/utils');
  });

  it('detects .tsx index files', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/web/src'],
    });
    const paths = result.map((b) => b.modulePath);
    expect(paths).toContain('packages/web/src/components');
  });

  it('respects minExports threshold', () => {
    // The helpers dir has 1 re-export
    const withMin1 = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['libs/shared/src'],
      minExports: 1,
    });
    expect(withMin1.map((b) => b.modulePath)).toContain('libs/shared/src/helpers');

    const withMin5 = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['libs/shared/src'],
      minExports: 5,
    });
    expect(withMin5.map((b) => b.modulePath)).not.toContain('libs/shared/src/helpers');
  });

  it('sets kind=facade and isPackage=false', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    result.forEach((b) => {
      expect(b.kind).toBe('facade');
      expect(b.isPackage).toBe(false);
    });
  });
});

describe('detectDirectoryBoundaries', () => {
  it('groups at depth 1', () => {
    const result = detectDirectoryBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
      depth: 1,
    });
    const paths = result.map((b) => b.modulePath).sort();
    expect(paths).toContain('packages/core/src/agent');
    expect(paths).toContain('packages/core/src/utils');
    expect(paths).toContain('packages/core/src/empty');
  });

  it('groups at depth 2 from higher root', () => {
    const result = detectDirectoryBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages'],
      depth: 2,
    });
    const paths = result.map((b) => b.modulePath);
    // depth 2 from packages → packages/core/src, packages/web/src, etc.
    expect(paths).toContain('packages/core/src');
    expect(paths).toContain('packages/web/src');
  });

  it('sets kind=directory and isPackage=false', () => {
    const result = detectDirectoryBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    result.forEach((b) => {
      expect(b.kind).toBe('directory');
      expect(b.isPackage).toBe(false);
    });
  });
});

describe('detectModuleBoundaries (combined)', () => {
  it('deduplicates: package wins over facade', () => {
    // Use the entire repo root so packages are detected both ways
    const result = detectModuleBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages'],
      detectPackages: true,
      detectFacades: true,
      detectDirectories: true,
      directoryDepth: 1,
    });

    // Packages/core should be kind=package not directory
    const core = result.find((b) => b.modulePath === 'packages/core');
    expect(core).toBeDefined();
    expect(core!.kind).toBe('package');
  });

  it('facade wins over directory when packages disabled', () => {
    const result = detectModuleBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
      detectPackages: false,
      detectFacades: true,
      detectDirectories: true,
      directoryDepth: 1,
    });

    const agent = result.find((b) => b.modulePath === 'packages/core/src/agent');
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe('facade');
  });

  it('uses all forward slashes in paths', () => {
    const result = detectModuleBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages'],
    });
    for (const b of result) {
      expect(b.modulePath).not.toMatch(/\\/);
      expect(b.moduleId).not.toMatch(/\\/);
    }
  });

  it('returns empty array for empty srcDirs', () => {
    const result = detectModuleBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: [],
      detectPackages: false,
    });
    expect(result).toEqual([]);
  });
});

describe('edge cases', () => {
  it('handles empty directories gracefully', () => {
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src/empty'],
    });
    expect(result).toEqual([]);
  });

  it('handles deeply nested structures', () => {
    // Create a deeply nested facade
    mkDir('packages', 'core', 'src', 'a', 'b', 'c');
    mkFile(
      ['packages', 'core', 'src', 'a', 'b', 'c', 'index.ts'],
      "export * from './deep.js';\n",
    );
    const result = detectFacadeBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/core/src'],
    });
    const paths = result.map((b) => b.modulePath);
    expect(paths).toContain('packages/core/src/a/b/c');
  });

  it('package detection handles invalid JSON gracefully', () => {
    mkFile(['packages', 'broken', 'package.json'], '{ not valid json');
    // Should not throw
    const result = detectPackageBoundaries({
      rootDir: TEST_ROOT,
      srcDirs: ['packages/broken'],
    });
    // The broken package should be skipped — not present in results
    const broken = result.find((b) => b.modulePath === 'packages/broken');
    expect(broken).toBeUndefined();
  });
});
