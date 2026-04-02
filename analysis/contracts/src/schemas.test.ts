import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ---------------------------------------------------------------------------
// Locate the schemas directory
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemasDir = join(__dirname, '..', 'schemas');

function loadSchema(relativePath: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(schemasDir, relativePath), 'utf-8'));
}

// ---------------------------------------------------------------------------
// Expected schema files
// ---------------------------------------------------------------------------

const COMMON_SCHEMAS = [
  'common/entity.schema.json',
  'common/relationship.schema.json',
  'common/module-boundary.schema.json',
  'common/provenance.schema.json',
  'common/source-range.schema.json',
];

const SIGNAL_SCHEMAS = [
  'signals/duplication.schema.json',
  'signals/coverage.schema.json',
  'signals/lint.schema.json',
];

const ROOT_SCHEMAS = [
  'collected-data.schema.json',
  'protocol.schema.json',
];

const ALL_SCHEMAS = [...ROOT_SCHEMAS, ...COMMON_SCHEMAS, ...SIGNAL_SCHEMAS];

// ---------------------------------------------------------------------------
// Schema file existence
// ---------------------------------------------------------------------------

describe('schema files', () => {
  it.each(ALL_SCHEMAS)('exists: %s', (relativePath) => {
    const fullPath = join(schemasDir, relativePath);
    expect(existsSync(fullPath)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Schema structural checks
// ---------------------------------------------------------------------------

describe('schema structure', () => {
  it.each(ALL_SCHEMAS)('has $id field: %s', (relativePath) => {
    const schema = loadSchema(relativePath);
    expect(schema).toHaveProperty('$id');
    expect(typeof schema.$id).toBe('string');
    expect((schema.$id as string).length).toBeGreaterThan(0);
  });

  it.each(ALL_SCHEMAS)('has root type or oneOf: %s', (relativePath) => {
    const schema = loadSchema(relativePath);
    // A schema must define its root shape via "type" or "oneOf"
    const hasType = 'type' in schema;
    const hasOneOf = 'oneOf' in schema;
    expect(hasType || hasOneOf).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// $ref resolution in collected-data.schema.json
// ---------------------------------------------------------------------------

describe('collected-data $ref resolution', () => {
  const schema = loadSchema('collected-data.schema.json');
  const props = schema.properties as Record<string, Record<string, unknown>>;

  const EXPECTED_REFS: [string, string][] = [
    ['entities', 'common/entity.schema.json'],
    ['relationships', 'common/relationship.schema.json'],
    ['moduleBoundaries', 'common/module-boundary.schema.json'],
    ['duplicationSignals', 'signals/duplication.schema.json'],
    ['coverageSignals', 'signals/coverage.schema.json'],
    ['lintSignals', 'signals/lint.schema.json'],
    ['provenance', 'common/provenance.schema.json'],
  ];

  it.each(EXPECTED_REFS)(
    'property "%s" references schema file "%s"',
    (propName, expectedRef) => {
      const prop = props[propName];
      expect(prop).toBeDefined();

      // The $ref can be on the prop directly (provenance) or inside items (arrays)
      const ref = (prop.$ref as string) ?? ((prop.items as Record<string, unknown>)?.$ref as string);
      expect(ref).toBe(expectedRef);
      // And the referenced file actually exists
      expect(existsSync(join(schemasDir, expectedRef))).toBe(true);
    },
  );
});

// ---------------------------------------------------------------------------
// Protocol schema oneOf
// ---------------------------------------------------------------------------

describe('protocol schema', () => {
  const schema = loadSchema('protocol.schema.json');

  it('has oneOf with 6 message types', () => {
    expect(schema).toHaveProperty('oneOf');
    const oneOf = schema.oneOf as unknown[];
    expect(oneOf).toHaveLength(6);
  });

  it('defines all expected message definitions', () => {
    const defs = schema.definitions as Record<string, unknown>;
    const expectedDefs = [
      'InvokeMessage',
      'ProgressMessage',
      'ChunkMessage',
      'ResultMessage',
      'ErrorMessage',
      'CompleteMessage',
    ];
    for (const name of expectedDefs) {
      expect(defs).toHaveProperty(name);
    }
  });
});

// ---------------------------------------------------------------------------
// Entity schema required fields
// ---------------------------------------------------------------------------

describe('entity schema', () => {
  const schema = loadSchema('common/entity.schema.json');

  it('requires the expected fields', () => {
    const required = schema.required as string[];
    expect(required).toEqual(
      expect.arrayContaining([
        'id',
        'kind',
        'name',
        'filePath',
        'sourceRange',
        'classification',
      ]),
    );
  });

  it('has kind enum with expected values', () => {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const kindEnum = props.kind.enum as string[];
    expect(kindEnum).toContain('file');
    expect(kindEnum).toContain('class');
    expect(kindEnum).toContain('function');
    expect(kindEnum).toContain('method');
    expect(kindEnum).toContain('interface');
  });
});

// ---------------------------------------------------------------------------
// Relationship schema required fields
// ---------------------------------------------------------------------------

describe('relationship schema', () => {
  const schema = loadSchema('common/relationship.schema.json');

  it('requires the expected fields', () => {
    const required = schema.required as string[];
    expect(required).toEqual(
      expect.arrayContaining([
        'sourceEntityId',
        'targetEntityId',
        'kind',
        'sourceRange',
        'targetClassification',
        'targetIsAbstraction',
        'crossModule',
        'crossPackage',
        'thirdParty',
        'typeOnly',
        'dynamic',
      ]),
    );
  });

  it('has kind enum with expected relationship types', () => {
    const props = schema.properties as Record<string, Record<string, unknown>>;
    const kindEnum = props.kind.enum as string[];
    expect(kindEnum).toContain('import');
    expect(kindEnum).toContain('extend');
    expect(kindEnum).toContain('implement');
    expect(kindEnum).toContain('call');
  });
});

// ---------------------------------------------------------------------------
// Generated types existence
// ---------------------------------------------------------------------------

describe('generated types', () => {
  it('exports CollectedCodeData type', async () => {
    const mod = await import('./generated/collected-data.js');
    // The module should exist — types are compile-time only but the JS file exists
    expect(mod).toBeDefined();
  });

  it('exports AspectProtocolMessage type', async () => {
    const mod = await import('./generated/protocol.js');
    expect(mod).toBeDefined();
  });

  it('exports Entity type', async () => {
    const mod = await import('./generated/entity.js');
    expect(mod).toBeDefined();
  });

  it('exports Relationship type', async () => {
    const mod = await import('./generated/relationship.js');
    expect(mod).toBeDefined();
  });

  it('re-exports all types from generated index', async () => {
    const mod = await import('./generated/index.js');
    expect(mod).toBeDefined();
  });
});
