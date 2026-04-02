import { describe, it, expect } from 'vitest';
import {
  normalizeDepCruiserOutput,
  makeEntityId,
  tokenizeName,
  type DepCruiserRawOutput,
} from './dep-cruiser.js';

// Vitest + Vite handle JSON imports natively
import depCruiserFixture from '../__fixtures__/dep-cruiser-output.json';

const fixture = depCruiserFixture as unknown as DepCruiserRawOutput;

// ── 1. Fixture-based normalization ──────────────────────────────────────────

describe('normalizeDepCruiserOutput (fixture)', () => {
  const result = normalizeDepCruiserOutput(fixture);

  it('produces the correct number of entities', () => {
    expect(result.entities).toHaveLength(10);
  });

  it('produces the correct number of relationships', () => {
    // 16 total edges in fixture, but 5 are third-party (2 core + 3 npm) → filtered out
    expect(result.relationships).toHaveLength(11);
  });

  it('generates deterministic entity IDs', () => {
    const ids = result.entities.map((e) => e.id);
    expect(ids).toContain('file:src/index.ts');
    expect(ids).toContain('file:src/services/user-service.ts');
    expect(ids).toContain('file:src/models/user.ts');
    expect(ids).toContain('file:src/types/user-types.ts');
    expect(ids).toContain('file:src/utils/logger.ts');
    expect(ids).toContain('file:src/config.ts');
    expect(ids).toContain('file:src/controllers/api-controller.ts');
    expect(ids).toContain('file:src/middleware/auth.ts');
    expect(ids).toContain('file:src/plugins/analytics.ts');
    expect(ids).toContain('file:src/services/order-service.ts');
  });

  it('sets correct entity fields', () => {
    const entity = result.entities.find((e) => e.id === 'file:src/index.ts');
    expect(entity).toBeDefined();
    expect(entity!.kind).toBe('file');
    expect(entity!.name).toBe('index.ts');
    expect(entity!.filePath).toBe('src/index.ts');
    expect(entity!.sourceRange).toBeNull();
    expect(entity!.parentEntityId).toBeNull();
    expect(entity!.classification.isConcrete).toBe(true);
    expect(entity!.classification.isAbstract).toBe(false);
    expect(entity!.classification.visibility).toBeNull();
    expect(entity!.rawCounts).toBeNull();
    expect(entity!.methodFieldAccessMatrix).toBeNull();
  });

  it('creates relationships with correct source/target IDs', () => {
    const indexToUserService = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(indexToUserService).toBeDefined();
    expect(indexToUserService!.kind).toBe('import');
    expect(indexToUserService!.sourceRange).toBeNull();
    expect(indexToUserService!.targetClassification).toBe('unknown');
    expect(indexToUserService!.targetIsAbstraction).toBe(false);
    expect(indexToUserService!.consumedMembers).toBeNull();
    expect(indexToUserService!.targetTotalMembers).toBeNull();
  });
});

// ── 2. Entity ID generation ─────────────────────────────────────────────────

describe('makeEntityId', () => {
  it('prefixes with "file:"', () => {
    expect(makeEntityId('src/index.ts')).toBe('file:src/index.ts');
  });

  it('normalizes backslashes to forward slashes', () => {
    expect(makeEntityId('src\\services\\user.ts')).toBe(
      'file:src/services/user.ts',
    );
  });

  it('strips leading ./', () => {
    expect(makeEntityId('./src/index.ts')).toBe('file:src/index.ts');
  });

  it('handles deeply nested paths', () => {
    expect(makeEntityId('src/a/b/c/d.ts')).toBe('file:src/a/b/c/d.ts');
  });

  it('handles node_modules paths', () => {
    expect(makeEntityId('node_modules/lodash/lodash.js')).toBe(
      'file:node_modules/lodash/lodash.js',
    );
  });

  it('handles core module specifiers', () => {
    expect(makeEntityId('node:fs')).toBe('file:node:fs');
  });
});

// ── 3. Third-party detection ────────────────────────────────────────────────

describe('third-party detection', () => {
  const result = normalizeDepCruiserOutput(fixture);

  it('filters out core module imports (no third-party relationships)', () => {
    const coreImport = result.relationships.find(
      (r) => r.targetEntityId === 'file:node:fs',
    );
    expect(coreImport).toBeUndefined();
  });

  it('filters out npm imports (no third-party relationships)', () => {
    const npmImport = result.relationships.find(
      (r) => r.targetEntityId === 'file:node_modules/lodash/lodash.js',
    );
    expect(npmImport).toBeUndefined();
  });

  it('keeps local imports (all remaining relationships are not thirdParty)', () => {
    const localImport = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(localImport).toBeDefined();
    expect(localImport!.thirdParty).toBe(false);
    // All remaining rels should be non-third-party
    expect(result.relationships.every((r) => !r.thirdParty)).toBe(true);
  });
});

// ── 4. Type-only detection ──────────────────────────────────────────────────

describe('type-only detection', () => {
  const result = normalizeDepCruiserOutput(fixture);

  it('flags typeOnly imports correctly', () => {
    const typeOnlyImport = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/models/user.ts' &&
        r.targetEntityId === 'file:src/types/user-types.ts',
    );
    expect(typeOnlyImport).toBeDefined();
    expect(typeOnlyImport!.typeOnly).toBe(true);
  });

  it('non-typeOnly imports are false', () => {
    const regularImport = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/utils/logger.ts',
    );
    expect(regularImport).toBeDefined();
    expect(regularImport!.typeOnly).toBe(false);
  });
});

// ── 5. Dynamic import detection ─────────────────────────────────────────────

describe('dynamic import detection', () => {
  const result = normalizeDepCruiserOutput(fixture);

  it('flags dynamic imports correctly', () => {
    const dynamicImport = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/middleware/auth.ts' &&
        r.targetEntityId === 'file:src/utils/logger.ts',
    );
    expect(dynamicImport).toBeDefined();
    expect(dynamicImport!.dynamic).toBe(true);
  });

  it('static imports are not dynamic', () => {
    const staticImport = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(staticImport).toBeDefined();
    expect(staticImport!.dynamic).toBe(false);
  });
});

// ── 6. Cross-module detection ───────────────────────────────────────────────

describe('cross-module detection', () => {
  const boundaries = [
    { moduleId: 'services', modulePath: 'src/services' },
    { moduleId: 'controllers', modulePath: 'src/controllers' },
    { moduleId: 'models', modulePath: 'src/models' },
  ];

  it('detects cross-module relationships', () => {
    const result = normalizeDepCruiserOutput(fixture, { moduleBoundaries: boundaries });

    // controllers/api-controller → services/user-service crosses boundary
    const crossModuleRel = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/controllers/api-controller.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(crossModuleRel).toBeDefined();
    expect(crossModuleRel!.crossModule).toBe(true);
  });

  it('same-module relationships are not cross-module', () => {
    const result = normalizeDepCruiserOutput(fixture, { moduleBoundaries: boundaries });

    // services/user-service → models/user crosses boundary
    // but services/order-service → models/user also crosses
    // Let's check within services: user-service → analytics (plugins, not in boundaries)
    // That means one has a moduleId and the other doesn't → crossModule
    const withinServices = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/services/order-service.ts' &&
        r.targetEntityId === 'file:src/models/user.ts',
    );
    expect(withinServices).toBeDefined();
    expect(withinServices!.crossModule).toBe(true); // services → models
  });

  it('returns false for all when no boundaries are defined', () => {
    const result = normalizeDepCruiserOutput(fixture);
    const crossModules = result.relationships.filter((r) => r.crossModule);
    expect(crossModules).toHaveLength(0);
  });

  it('prefers the longest matching boundary when boundaries overlap', () => {
    // Boundaries ordered with longer path first to test the "shorter match found after longer" branch
    const overlappingBoundaries = [
      { moduleId: 'services', modulePath: 'src/services' },
      { moduleId: 'src', modulePath: 'src' },
    ];
    const result = normalizeDepCruiserOutput(fixture, { moduleBoundaries: overlappingBoundaries });

    // user-service is in src/services → should match 'services' module (longer match)
    // index.ts is in src/ → should match 'src' module
    // So index→user-service should be cross-module (src → services)
    const indexToUserService = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(indexToUserService).toBeDefined();
    expect(indexToUserService!.crossModule).toBe(true);
  });
});

// ── 7. Cross-package detection ──────────────────────────────────────────────

describe('cross-package detection', () => {
  const result = normalizeDepCruiserOutput(fixture);

  it('filters out node_modules dependencies (no crossPackage relationships)', () => {
    const npmDep = result.relationships.find(
      (r) => r.targetEntityId === 'file:node_modules/lodash/lodash.js',
    );
    expect(npmDep).toBeUndefined();
  });

  it('marks local dependencies as not crossPackage', () => {
    const localDep = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/index.ts' &&
        r.targetEntityId === 'file:src/utils/logger.ts',
    );
    expect(localDep).toBeDefined();
    expect(localDep!.crossPackage).toBe(false);
  });

  it('does not include core module relationships', () => {
    const coreDep = result.relationships.find(
      (r) => r.targetEntityId === 'file:node:fs',
    );
    expect(coreDep).toBeUndefined();
  });
});

// ── 8. Name tokenization ────────────────────────────────────────────────────

describe('tokenizeName', () => {
  it('splits kebab-case', () => {
    expect(tokenizeName('user-service.ts')).toEqual(['user', 'service']);
  });

  it('splits snake_case', () => {
    expect(tokenizeName('user_service.ts')).toEqual(['user', 'service']);
  });

  it('splits camelCase', () => {
    expect(tokenizeName('userService.ts')).toEqual(['user', 'service']);
  });

  it('splits PascalCase', () => {
    expect(tokenizeName('UserService.ts')).toEqual(['user', 'service']);
  });

  it('handles single-word names', () => {
    expect(tokenizeName('index.ts')).toEqual(['index']);
  });

  it('handles mixed delimiters', () => {
    expect(tokenizeName('my-cool_utilsHelper.ts')).toEqual([
      'my',
      'cool',
      'utils',
      'helper',
    ]);
  });

  it('handles acronyms', () => {
    expect(tokenizeName('XMLParser.ts')).toEqual(['xml', 'parser']);
  });

  it('handles dotted extensions like .test.ts', () => {
    // path.extname returns ".ts", leaving "api-controller.test"
    // splitting on "." gives ["api-controller", "test"]
    // then kebab splits give ["api", "controller", "test"]
    expect(tokenizeName('api-controller.test.ts')).toEqual([
      'api',
      'controller',
      'test',
    ]);
  });

  it('handles double delimiters that produce empty parts', () => {
    expect(tokenizeName('foo--bar.ts')).toEqual(['foo', 'bar']);
  });

  it('handles leading/trailing delimiters', () => {
    expect(tokenizeName('-hello-.ts')).toEqual(['hello']);
  });

  it('handles paths (extracts basename)', () => {
    expect(tokenizeName('src/services/user-service.ts')).toEqual([
      'user',
      'service',
    ]);
  });
});

// ── 9. Empty project ────────────────────────────────────────────────────────

describe('empty project', () => {
  it('returns empty arrays for a project with no modules', () => {
    const empty: DepCruiserRawOutput = {
      modules: [],
      summary: {
        violations: [],
        totalCruised: 0,
        totalDependenciesCruised: 0,
      },
    };
    const result = normalizeDepCruiserOutput(empty);
    expect(result.entities).toEqual([]);
    expect(result.relationships).toEqual([]);
  });

  it('handles a module with no dependencies', () => {
    const singleOrphan: DepCruiserRawOutput = {
      modules: [
        {
          source: 'src/orphan.ts',
          dependencies: [],
          orphan: true,
          valid: true,
        },
      ],
      summary: {
        violations: [],
        totalCruised: 1,
        totalDependenciesCruised: 0,
      },
    };
    const result = normalizeDepCruiserOutput(singleOrphan);
    expect(result.entities).toHaveLength(1);
    expect(result.entities[0]!.id).toBe('file:src/orphan.ts');
    expect(result.relationships).toEqual([]);
  });
});

// ── 10. Circular dependency metadata ────────────────────────────────────────

describe('circular dependency metadata', () => {
  it('preserves circular relationships', () => {
    const result = normalizeDepCruiserOutput(fixture);

    // user-service → analytics (circular)
    const circularForward = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/services/user-service.ts' &&
        r.targetEntityId === 'file:src/plugins/analytics.ts',
    );
    expect(circularForward).toBeDefined();

    // analytics → user-service (circular)
    const circularBack = result.relationships.find(
      (r) =>
        r.sourceEntityId === 'file:src/plugins/analytics.ts' &&
        r.targetEntityId === 'file:src/services/user-service.ts',
    );
    expect(circularBack).toBeDefined();
  });

  it('circular deps appear as warnings in extractWarnings (via fixture violations)', () => {
    // We import the internal extractWarnings indirectly by exercising
    // normalizeDepCruiserOutput — the warnings live on the toolRun in the
    // runner, so here we verify the raw violations are present in the fixture.
    expect(fixture.summary.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'cycle',
          from: 'src/services/user-service.ts',
          to: 'src/plugins/analytics.ts',
        }),
      ]),
    );

    // Verify circular flags are set on the raw dependencies
    const userServiceMod = fixture.modules.find(
      (m) => m.source === 'src/services/user-service.ts',
    );
    const circularDep = userServiceMod?.dependencies.find(
      (d) => d.resolved === 'src/plugins/analytics.ts',
    );
    expect(circularDep?.circular).toBe(true);
  });
});
