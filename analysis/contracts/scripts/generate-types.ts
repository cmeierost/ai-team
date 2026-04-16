import { compileFromFile } from 'json-schema-to-typescript';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, '..', 'schemas');
const OUTPUT_DIR = join(__dirname, '..', 'src', 'generated');

interface SchemaEntry {
  /** Path relative to SCHEMAS_DIR */
  schemaPath: string;
  /** Output file name (without .ts extension) */
  outputName: string;
}

const SCHEMAS: SchemaEntry[] = [
  { schemaPath: 'common/source-range.schema.json', outputName: 'source-range' },
  { schemaPath: 'common/entity.schema.json', outputName: 'entity' },
  { schemaPath: 'common/relationship.schema.json', outputName: 'relationship' },
  { schemaPath: 'common/module-boundary.schema.json', outputName: 'module-boundary' },
  { schemaPath: 'common/file-inventory.schema.json', outputName: 'file-inventory' },
  { schemaPath: 'common/provenance.schema.json', outputName: 'provenance' },
  { schemaPath: 'signals/duplication.schema.json', outputName: 'duplication' },
  { schemaPath: 'signals/coverage.schema.json', outputName: 'coverage' },
  { schemaPath: 'signals/lint.schema.json', outputName: 'lint' },
  { schemaPath: 'collected-data.schema.json', outputName: 'collected-data' },
  { schemaPath: 'analyzed-data.schema.json', outputName: 'analyzed-data' },
  { schemaPath: 'protocol.schema.json', outputName: 'protocol' },
];

const COMPILE_OPTIONS = {
  bannerComment:
    '/* eslint-disable */\n/* This file is auto-generated from JSON Schema. Do not edit manually. */',
  style: {
    semi: true,
    trailingComma: 'all' as const,
    singleQuote: true,
  },
  enableConstEnums: false,
  strictIndexSignatures: true,
};

async function main(): Promise<void> {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const generated: string[] = [];

  for (const { schemaPath, outputName } of SCHEMAS) {
    const fullPath = join(SCHEMAS_DIR, schemaPath);
    process.stdout.write(`  ${schemaPath} → ${outputName}.ts … `);

    try {
      const ts = await compileFromFile(fullPath, COMPILE_OPTIONS);
      await writeFile(join(OUTPUT_DIR, `${outputName}.ts`), ts, 'utf-8');
      generated.push(outputName);
      console.log('✓');
    } catch (err) {
      console.log('✗');
      console.error(`    ERROR: ${err instanceof Error ? err.message : String(err)}`);
      throw err;
    }
  }

  // Build conflict-free barrel — sub-schemas are processed first so their
  // types take priority over inlined duplicates in root schemas.
  const exportsByFile = new Map<string, string[]>();
  for (const name of generated) {
    const content = await readFile(join(OUTPUT_DIR, `${name}.ts`), 'utf-8');
    const names = [
      ...content.matchAll(/^export (?:interface|type) (\w+)/gm),
    ].map((m) => m[1]);
    exportsByFile.set(name, names);
  }

  const seen = new Set<string>();
  const barrelLines = [
    '/* eslint-disable */',
    '/* This file is auto-generated. Do not edit manually. */',
    '',
  ];

  for (const name of generated) {
    const exports = exportsByFile.get(name) ?? [];
    const unique = exports.filter((n) => !seen.has(n));
    if (unique.length > 0) {
      unique.forEach((n) => seen.add(n));
      barrelLines.push(
        `export type { ${unique.join(', ')} } from './${name}.js';`,
      );
    }
  }
  barrelLines.push('');

  await writeFile(join(OUTPUT_DIR, 'index.ts'), barrelLines.join('\n'), 'utf-8');

  console.log('\n✓ Generated types:');
  for (const name of generated) {
    console.log(`  • src/generated/${name}.ts`);
  }
  console.log(`  • src/generated/index.ts (barrel)`);
  console.log(`\nTotal: ${generated.length} type files + 1 barrel`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('\nType generation failed:', err);
    process.exit(1);
  });
