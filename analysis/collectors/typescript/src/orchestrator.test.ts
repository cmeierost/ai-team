import { vi, describe, it, expect, beforeEach } from 'vitest';
import type { Entity, ToolRun } from '@aspect/contracts';

// ── Mock modules (hoisted before imports) ───────────────────────────────────

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

vi.mock('./adapters/ast-visitor.js', () => ({
  runAstVisitor: vi.fn(),
}));

vi.mock('./adapters/dep-cruiser.js', () => ({
  runDepCruiserAdapter: vi.fn(),
}));

vi.mock('./adapters/jscpd.js', () => ({
  runJscpdAdapter: vi.fn(),
}));

vi.mock('./adapters/eslint.js', () => ({
  runEslintAdapter: vi.fn(),
}));

vi.mock('./adapters/coverage.js', () => ({
  runCoverageAdapter: vi.fn(),
}));

import { readdir } from 'node:fs/promises';
import { runAstVisitor } from './adapters/ast-visitor.js';
import { runDepCruiserAdapter } from './adapters/dep-cruiser.js';
import { runJscpdAdapter } from './adapters/jscpd.js';
import { runEslintAdapter } from './adapters/eslint.js';
import { runCoverageAdapter } from './adapters/coverage.js';

import {
  collect,
  resolveAspects,
  mergeEntities,
  buildModuleBoundaries,
  discoverFiles,
  type CollectorOptions,
} from './orchestrator.js';

// ── Typed mocks ─────────────────────────────────────────────────────────────

const mockReaddir = vi.mocked(readdir);
const mockAstVisitor = vi.mocked(runAstVisitor);
const mockDepCruiser = vi.mocked(runDepCruiserAdapter);
const mockJscpd = vi.mocked(runJscpdAdapter);
const mockEslint = vi.mocked(runEslintAdapter);
const mockCoverage = vi.mocked(runCoverageAdapter);

// ── Test fixtures ───────────────────────────────────────────────────────────

const RANGE = { startLine: 1, startColumn: 0, endLine: 10, endColumn: 0 };
const CLASSIFICATION = {
  isAbstract: false,
  isInterface: false,
  isConcrete: true,
  isTypeOnly: false,
  isExported: false,
  visibility: null,
};

function makeEntity(id: string, filePath: string, name: string): Entity {
  return {
    id,
    kind: 'file',
    name,
    filePath,
    sourceRange: RANGE,
    classification: CLASSIFICATION,
    nameTokens: [name.replace('.ts', '')],
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
  };
}

const entity1 = makeEntity('file:src/foo.ts', 'src/foo.ts', 'foo.ts');
const entity2 = makeEntity('file:src/bar.ts', 'src/bar.ts', 'bar.ts');
const entity3 = makeEntity('file:src/baz.ts', 'src/baz.ts', 'baz.ts');

function makeAstToolRun() {
  return {
    tool: 'typescript-ast' as const,
    version: '5.0.0',
    aspect: 'entityExtraction' as const,
    exitCode: 0,
    duration: 50,
    warnings: [],
  };
}

function makeDepCruiserToolRun() {
  return {
    tool: 'dependency-cruiser',
    version: '16.0.0',
    aspect: 'dependencyGraph',
    exitCode: 0,
    duration: 100,
    warnings: [],
  };
}

function makeJscpdToolRun() {
  return {
    tool: 'jscpd' as const,
    version: '4.0.0',
    aspect: 'duplication' as const,
    exitCode: 0,
    duration: 80,
    warnings: [] as string[],
  };
}

function makeEslintToolRun() {
  return {
    tool: 'eslint' as const,
    version: '9.0.0',
    aspect: 'lint' as const,
    exitCode: 0,
    duration: 120,
    warnings: [] as string[],
  };
}

function makeCoverageToolRun() {
  return {
    tool: 'lcov',
    version: '1.0',
    aspect: 'coverage' as const,
    exitCode: 0,
    duration: 20,
    warnings: [] as string[],
  };
}

// dep-cruiser uses its own local Entity type (sourceRange nullable)
function makeDepCruiserEntity(id: string, filePath: string, name: string) {
  return {
    id,
    kind: 'file' as const,
    name,
    filePath,
    sourceRange: null,
    parentEntityId: null,
    classification: CLASSIFICATION,
    nameTokens: [name.replace('.ts', '')],
    rawCounts: null,
    methodFieldAccessMatrix: null,
  };
}

function makeDepCruiserRelationship(
  source: string,
  target: string,
  opts?: { crossModule?: boolean }
) {
  return {
    sourceEntityId: source,
    targetEntityId: target,
    kind: 'import' as const,
    sourceRange: null,
    targetClassification: 'unknown' as const,
    targetIsAbstraction: false as const,
    consumedMembers: null,
    targetTotalMembers: null,
    crossModule: opts?.crossModule ?? false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
  };
}

// ── Default mock setup ──────────────────────────────────────────────────────

function setupDefaultMocks() {
  // readdir returns a couple of TS files
  (mockReaddir as any).mockResolvedValue(['foo.ts', 'bar.ts']);

  // AST visitor
  mockAstVisitor.mockResolvedValue({
    entities: [entity1, entity2],
    toolRun: makeAstToolRun(),
  });

  // Dep-cruiser (with its local Entity/Relationship types)
  (mockDepCruiser as any).mockResolvedValue({
    entities: [
      makeDepCruiserEntity('file:src/foo.ts', 'src/foo.ts', 'foo.ts'),
      makeDepCruiserEntity('file:src/baz.ts', 'src/baz.ts', 'baz.ts'),
    ],
    relationships: [makeDepCruiserRelationship('file:src/foo.ts', 'file:src/bar.ts')],
    toolRun: makeDepCruiserToolRun(),
  });

  // jscpd
  (mockJscpd as any).mockResolvedValue({
    duplicationSignals: [
      {
        source: { tool: 'jscpd', version: '4.0.0' },
        clones: [
          {
            id: 'clone:src/foo.ts:L1-src/bar.ts:L5',
            format: 'typescript',
            tokenCount: 60,
            lineCount: 8,
            fragment: null,
            firstFile: {
              filePath: 'src/foo.ts',
              startLine: 1,
              endLine: 8,
              startCol: 0,
              endCol: 20,
            },
            secondFile: {
              filePath: 'src/bar.ts',
              startLine: 5,
              endLine: 12,
              startCol: 0,
              endCol: 20,
            },
          },
        ],
        statistics: {
          totalLines: 100,
          totalTokens: 500,
          totalSources: 2,
          duplicatedLines: 8,
          duplicatedTokens: 60,
        },
      },
    ],
    toolRun: makeJscpdToolRun(),
  });

  // eslint
  (mockEslint as any).mockResolvedValue({
    lintSignals: [
      {
        source: { tool: 'eslint', version: '9.0.0', ruleSet: 'default' },
        results: [
          {
            filePath: 'src/foo.ts',
            ruleId: 'no-unused-vars',
            severity: 'warning',
            message: 'x is unused',
            line: 3,
            column: 7,
            endLine: 3,
            endColumn: 8,
          },
        ],
      },
    ],
    toolRun: makeEslintToolRun(),
  });

  // coverage
  (mockCoverage as any).mockResolvedValue({
    coverageSignals: [
      {
        source: { tool: 'lcov', format: 'lcov', version: '1.0' },
        files: [
          {
            filePath: 'src/foo.ts',
            linesCovered: 8,
            linesTotal: 10,
            branchesCovered: null,
            branchesTotal: null,
            functions: [],
          },
        ],
      },
    ],
    toolRun: makeCoverageToolRun(),
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Unit tests
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveAspects', () => {
  it('returns all 5 aspects by default', () => {
    const aspects = resolveAspects();
    expect(aspects.size).toBe(5);
    expect(aspects.has('dependencyGraph')).toBe(true);
    expect(aspects.has('entityExtraction')).toBe(true);
    expect(aspects.has('duplication')).toBe(true);
    expect(aspects.has('lint')).toBe(true);
    expect(aspects.has('coverage')).toBe(true);
  });

  it('returns only the included subset', () => {
    const aspects = resolveAspects(['entityExtraction', 'lint']);
    expect(aspects.size).toBe(2);
    expect(aspects.has('entityExtraction')).toBe(true);
    expect(aspects.has('lint')).toBe(true);
    expect(aspects.has('coverage')).toBe(false);
  });

  it('excludes specified aspects from all', () => {
    const aspects = resolveAspects(undefined, ['coverage']);
    expect(aspects.size).toBe(4);
    expect(aspects.has('coverage')).toBe(false);
    expect(aspects.has('dependencyGraph')).toBe(true);
  });

  it('applies both include and exclude', () => {
    const aspects = resolveAspects(['entityExtraction', 'lint', 'coverage'], ['lint']);
    expect(aspects.size).toBe(2);
    expect(aspects.has('entityExtraction')).toBe(true);
    expect(aspects.has('coverage')).toBe(true);
    expect(aspects.has('lint')).toBe(false);
  });
});

describe('mergeEntities', () => {
  it('adds all entities when no duplicates', () => {
    const existing = [entity1];
    mergeEntities(existing, [entity2, entity3]);
    expect(existing).toHaveLength(3);
    expect(existing.map((e) => e.id)).toEqual([entity1.id, entity2.id, entity3.id]);
  });

  it('skips duplicate entities by ID, keeping the earlier one', () => {
    const existing = [entity1];
    const incoming = [makeEntity('file:src/foo.ts', 'src/foo.ts', 'foo-modified.ts'), entity2];
    mergeEntities(existing, incoming);
    expect(existing).toHaveLength(2);
    // The original entity1 is kept, not the modified incoming one
    expect(existing[0].name).toBe('foo.ts');
    expect(existing[1].id).toBe(entity2.id);
  });

  it('handles empty incoming array', () => {
    const existing = [entity1];
    mergeEntities(existing, []);
    expect(existing).toHaveLength(1);
  });

  it('handles empty existing array', () => {
    const existing: Entity[] = [];
    mergeEntities(existing, [entity1, entity2]);
    expect(existing).toHaveLength(2);
  });
});

describe('buildModuleBoundaries', () => {
  it('assigns files to correct module boundaries', () => {
    const entities = [entity1, entity2, entity3];
    const definitions = [{ moduleId: 'mod-a', modulePath: 'src' }];
    const boundaries = buildModuleBoundaries(definitions, entities);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].moduleId).toBe('mod-a');
    expect(boundaries[0].files).toEqual(['src/foo.ts', 'src/bar.ts', 'src/baz.ts']);
    expect(boundaries[0].declaredLayer).toBeNull();
    expect(boundaries[0].isPackage).toBe(false);
  });

  it('creates multiple boundaries with correct file assignments', () => {
    const e1 = makeEntity('file:core/a.ts', 'core/a.ts', 'a.ts');
    const e2 = makeEntity('file:api/b.ts', 'api/b.ts', 'b.ts');
    const e3 = makeEntity('file:core/c.ts', 'core/c.ts', 'c.ts');
    const definitions = [
      { moduleId: 'core', modulePath: 'core' },
      { moduleId: 'api', modulePath: 'api' },
    ];
    const boundaries = buildModuleBoundaries(definitions, [e1, e2, e3]);
    expect(boundaries).toHaveLength(2);
    expect(boundaries[0].files).toEqual(['core/a.ts', 'core/c.ts']);
    expect(boundaries[1].files).toEqual(['api/b.ts']);
  });

  it('returns empty array when no definitions', () => {
    expect(buildModuleBoundaries(undefined, [entity1])).toEqual([]);
    expect(buildModuleBoundaries([], [entity1])).toEqual([]);
  });

  it('returns boundary with empty files when no entities match', () => {
    const definitions = [{ moduleId: 'other', modulePath: 'other' }];
    const boundaries = buildModuleBoundaries(definitions, [entity1]);
    expect(boundaries).toHaveLength(1);
    expect(boundaries[0].files).toEqual([]);
  });
});

describe('discoverFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('discovers files in srcDirs with default extensions', async () => {
    (mockReaddir as any).mockResolvedValue(['index.ts', 'util.tsx', 'readme.md']);
    const result = await discoverFiles({ rootDir: '/project' });
    expect(result).toEqual(['src/index.ts', 'src/util.tsx']);
  });

  it('excludes node_modules and dist by default', async () => {
    (mockReaddir as any).mockResolvedValue([
      'index.ts',
      'node_modules/dep/index.ts',
      'dist/index.ts',
    ]);
    const result = await discoverFiles({ rootDir: '/project' });
    expect(result).toEqual(['src/index.ts']);
  });

  it('handles multiple srcDirs', async () => {
    (mockReaddir as any).mockResolvedValueOnce(['a.ts']);
    (mockReaddir as any).mockResolvedValueOnce(['b.ts']);
    const result = await discoverFiles({
      rootDir: '/project',
      srcDirs: ['lib', 'test'],
    });
    expect(result).toEqual(['lib/a.ts', 'test/b.ts']);
  });

  it('returns empty array when directory does not exist', async () => {
    (mockReaddir as any).mockRejectedValue(new Error('ENOENT: no such file or directory'));
    const result = await discoverFiles({ rootDir: '/project' });
    expect(result).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Integration tests (mocked adapters)
// ═══════════════════════════════════════════════════════════════════════════

describe('collect', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultMocks();
  });

  const baseOptions: CollectorOptions = {
    rootDir: '/project',
    srcDirs: ['src'],
  };

  it('runs all adapters and assembles a valid CollectedCodeData', async () => {
    const result = await collect({
      ...baseOptions,
      coveragePath: '/project/coverage/lcov.info',
    });

    // Schema shape
    expect(result.data.schemaVersion).toBe('1.0');
    expect(result.data.collectedAt).toBeTruthy();
    expect(result.data.collector.id).toBe('@aspect/collector-typescript');
    expect(result.data.collector.language).toBe('typescript');

    // Entities: AST visitor produced 2, dep-cruiser had 1 overlap + 1 new
    expect(result.data.entities.length).toBe(3);
    expect(result.data.entities.map((e) => e.id).sort()).toEqual([
      'file:src/bar.ts',
      'file:src/baz.ts',
      'file:src/foo.ts',
    ]);

    // Relationships from dep-cruiser
    expect(result.data.relationships).toHaveLength(1);
    expect(result.data.relationships[0].sourceEntityId).toBe('file:src/foo.ts');

    // Dep-cruiser entities get a default sourceRange when null
    const bazEntity = result.data.entities.find((e) => e.id === 'file:src/baz.ts');
    expect(bazEntity!.sourceRange).toEqual({
      startLine: 0,
      startColumn: 0,
      endLine: 0,
      endColumn: 0,
    });

    // Duplication signals mapped correctly
    expect(result.data.duplicationSignals).toHaveLength(1);
    const clone = result.data.duplicationSignals![0].clones[0];
    expect(clone.firstFile).toHaveProperty('startColumn', 0);
    expect(clone.firstFile).toHaveProperty('endColumn', 20);
    expect(clone.firstFile).not.toHaveProperty('startCol');

    // Lint signals
    expect(result.data.lintSignals).toHaveLength(1);

    // Coverage signals
    expect(result.data.coverageSignals).toHaveLength(1);

    // Provenance
    expect(result.data.provenance.toolRuns).toHaveLength(5);
    expect(result.data.collector.tools).toEqual([
      'typescript-ast',
      'dependency-cruiser',
      'jscpd',
      'eslint',
      'lcov',
    ]);

    // Timing
    expect(result.timing.totalMs).toBeGreaterThan(0);
    expect(result.timing.perAspect).toHaveProperty('entityExtraction');
    expect(result.timing.perAspect).toHaveProperty('dependencyGraph');
    expect(result.timing.perAspect).toHaveProperty('duplication');
    expect(result.timing.perAspect).toHaveProperty('lint');
    expect(result.timing.perAspect).toHaveProperty('coverage');

    // No warnings
    expect(result.warnings).toEqual([]);
  });

  it('runs only specified aspects via includeAspects', async () => {
    const result = await collect({
      ...baseOptions,
      includeAspects: ['entityExtraction'],
    });

    expect(mockAstVisitor).toHaveBeenCalledOnce();
    expect(mockDepCruiser).not.toHaveBeenCalled();
    expect(mockJscpd).not.toHaveBeenCalled();
    expect(mockEslint).not.toHaveBeenCalled();
    expect(mockCoverage).not.toHaveBeenCalled();

    expect(result.data.entities).toHaveLength(2);
    expect(result.data.relationships).toHaveLength(0);
    expect(result.data.duplicationSignals).toBeUndefined();
    expect(result.data.lintSignals).toBeUndefined();
    expect(result.data.coverageSignals).toBeUndefined();
    expect(result.data.collector.tools).toEqual(['typescript-ast']);
    expect(result.timing.perAspect).toHaveProperty('entityExtraction');
    expect(result.timing.perAspect).not.toHaveProperty('dependencyGraph');
  });

  it('skips aspects via excludeAspects', async () => {
    await collect({
      ...baseOptions,
      excludeAspects: ['dependencyGraph', 'duplication', 'lint', 'coverage'],
    });

    expect(mockAstVisitor).toHaveBeenCalledOnce();
    expect(mockDepCruiser).not.toHaveBeenCalled();
    expect(mockJscpd).not.toHaveBeenCalled();
    expect(mockEslint).not.toHaveBeenCalled();
    expect(mockCoverage).not.toHaveBeenCalled();
  });

  it('handles adapter failure gracefully with warning', async () => {
    mockAstVisitor.mockRejectedValue(new Error('TS crash'));
    (mockDepCruiser as any).mockRejectedValue(new Error('cruise failed'));

    const result = await collect({
      ...baseOptions,
      includeAspects: ['entityExtraction', 'dependencyGraph'],
    });

    // Other aspects still produce no error
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('AST visitor failed');
    expect(result.warnings[0]).toContain('TS crash');
    expect(result.warnings[1]).toContain('dependency-cruiser failed');
    expect(result.warnings[1]).toContain('cruise failed');

    // Data is still valid (empty but well-formed)
    expect(result.data.entities).toEqual([]);
    expect(result.data.relationships).toEqual([]);
    expect(result.data.schemaVersion).toBe('1.0');
  });

  it('records timing for each aspect that ran', async () => {
    const result = await collect({
      ...baseOptions,
      includeAspects: ['entityExtraction', 'lint'],
    });

    expect(result.timing.perAspect.entityExtraction).toBeGreaterThanOrEqual(0);
    expect(result.timing.perAspect.lint).toBeGreaterThanOrEqual(0);
    expect(result.timing.perAspect.dependencyGraph).toBeUndefined();
    expect(result.timing.totalMs).toBeGreaterThan(0);
  });

  it('produces valid output when no source files are found', async () => {
    (mockReaddir as any).mockResolvedValue([]);
    mockAstVisitor.mockResolvedValue({
      entities: [],
      toolRun: makeAstToolRun(),
    });

    const result = await collect({
      ...baseOptions,
      includeAspects: ['entityExtraction'],
    });

    expect(result.data.entities).toEqual([]);
    expect(result.data.relationships).toEqual([]);
    expect(result.data.moduleBoundaries).toEqual([]);
    expect(result.data.schemaVersion).toBe('1.0');
    expect(result.data.provenance.toolRuns).toHaveLength(1);
  });

  it('skips coverage adapter when coveragePath is not provided', async () => {
    const result = await collect(baseOptions);

    expect(mockCoverage).not.toHaveBeenCalled();
    expect(result.data.coverageSignals).toBeUndefined();
    // coverage timing still not recorded
    expect(result.timing.perAspect.coverage).toBeUndefined();
  });

  it('runs coverage adapter when coveragePath is provided', async () => {
    const result = await collect({
      ...baseOptions,
      coveragePath: '/project/coverage/lcov.info',
    });

    expect(mockCoverage).toHaveBeenCalledWith({
      rootDir: '/project',
      coveragePath: '/project/coverage/lcov.info',
      format: undefined,
    });
    expect(result.data.coverageSignals).toHaveLength(1);
  });

  it('passes options through to adapters correctly', async () => {
    await collect({
      rootDir: '/project',
      srcDirs: ['lib'],
      jscpd: { minTokens: 100, minLines: 10 },
      eslint: { configPath: '.eslintrc.json', extraArgs: ['--fix'] },
      depCruiser: { extraOptions: { tsPreCompilationDeps: true } },
      coveragePath: '/project/cov.json',
      coverageFormat: 'istanbul',
      moduleBoundaries: [{ moduleId: 'core', modulePath: 'lib/core' }],
    });

    expect(mockDepCruiser).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: '/project',
        srcDirs: ['lib'],
        cruiseOptions: { tsPreCompilationDeps: true },
        moduleBoundaries: [{ moduleId: 'core', modulePath: 'lib/core' }],
      })
    );

    expect(mockJscpd).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: '/project',
        minTokens: 100,
        minLines: 10,
      })
    );

    expect(mockEslint).toHaveBeenCalledWith(
      expect.objectContaining({
        rootDir: '/project',
        configPath: '.eslintrc.json',
        extraArgs: ['--fix'],
      })
    );

    expect(mockCoverage).toHaveBeenCalledWith({
      rootDir: '/project',
      coveragePath: '/project/cov.json',
      format: 'istanbul',
    });
  });

  it('builds module boundaries from entities', async () => {
    const result = await collect({
      ...baseOptions,
      moduleBoundaries: [{ moduleId: 'main', modulePath: 'src' }],
    });

    expect(result.data.moduleBoundaries).toHaveLength(1);
    expect(result.data.moduleBoundaries[0].moduleId).toBe('main');
    // All entities with filePath starting with 'src/' are assigned
    expect(result.data.moduleBoundaries[0].files.length).toBeGreaterThan(0);
  });

  it('omits empty optional signal arrays', async () => {
    // jscpd returns no clones
    (mockJscpd as any).mockResolvedValue({
      duplicationSignals: [],
      toolRun: makeJscpdToolRun(),
    });
    // eslint returns empty signals
    (mockEslint as any).mockResolvedValue({
      lintSignals: [],
      toolRun: makeEslintToolRun(),
    });

    const result = await collect(baseOptions);

    expect(result.data.duplicationSignals).toBeUndefined();
    expect(result.data.lintSignals).toBeUndefined();
    expect(result.data.coverageSignals).toBeUndefined();
  });

  it('handles mixed adapter success and failure', async () => {
    mockAstVisitor.mockResolvedValue({
      entities: [entity1],
      toolRun: makeAstToolRun(),
    });
    (mockDepCruiser as any).mockRejectedValue(new Error('dep-cruise boom'));
    (mockJscpd as any).mockRejectedValue(new Error('jscpd boom'));
    // eslint and coverage succeed

    const result = await collect({
      ...baseOptions,
      coveragePath: '/project/cov.info',
    });

    // Successful adapters still contribute
    expect(result.data.entities).toHaveLength(1);
    expect(result.data.lintSignals).toHaveLength(1);
    expect(result.data.coverageSignals).toHaveLength(1);

    // Failures are warnings
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.some((w) => w.includes('dep-cruise boom'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('jscpd boom'))).toBe(true);
  });
});
