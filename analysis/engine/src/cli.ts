#!/usr/bin/env node

/**
 * aspect-analyze CLI — standalone pipeline: collect → analyze → export.
 *
 * Uses only built-in `node:util.parseArgs` (no third-party CLI framework).
 * Progress goes to stderr so stdout stays clean for piped output.
 */

import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { writeFile, readFile, mkdir } from 'node:fs/promises';

import type { CollectionAspect } from '@aspect/collector-typescript';
import type { CalculatorGroup } from './orchestrator.js';

// ── Lazy loaders ────────────────────────────────────────────────────────

async function loadCollector() {
  return import('@aspect/collector-typescript');
}

async function loadEngine() {
  return {
    analyze: (await import('./orchestrator.js')).analyze,
    toSarif: (await import('./output/sarif.js')).toSarif,
    toDot: (await import('./output/dot.js')).toDot,
    toGraphML: (await import('./output/graphml.js')).toGraphML,
    toSonarQube: (await import('./output/sonarqube.js')).toSonarQube,
    toJson: (await import('./output/json.js')).toJson,
  };
}

// ── Constants ───────────────────────────────────────────────────────────

const VERSION = '0.1.0';

const VALID_FORMATS = ['json', 'sarif', 'dot', 'graphml', 'sonarqube'] as const;
type OutputFormat = (typeof VALID_FORMATS)[number];

// ── Testable helpers ────────────────────────────────────────────────────

export interface CliArgs {
  root?: string;
  src?: string;
  output?: string;
  format: string;
  aspects?: string;
  modules?: string;
  coverage?: string;
  include?: string;
  noThirdParty: boolean;
  noTypeOnly: boolean;
  quiet: boolean;
  help: boolean;
  version: boolean;
  positionals: string[];
}

/**
 * Parse raw argv (without the leading `node` / script entries) into typed args.
 */
export function parseCliArgs(args: string[]): CliArgs {
  const { values, positionals } = parseArgs({
    args,
    options: {
      root: { type: 'string', short: 'r' },
      src: { type: 'string' },
      output: { type: 'string', short: 'o' },
      format: { type: 'string', short: 'f', default: 'json' },
      aspects: { type: 'string' },
      modules: { type: 'string' },
      coverage: { type: 'string' },
      include: { type: 'string' },
      'no-third-party': { type: 'boolean', default: false },
      'no-type-only': { type: 'boolean', default: false },
      quiet: { type: 'boolean', short: 'q', default: false },
      help: { type: 'boolean', short: 'h', default: false },
      version: { type: 'boolean', short: 'v', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  return {
    root: values.root as string | undefined,
    src: values.src as string | undefined,
    output: values.output as string | undefined,
    format: (values.format as string) ?? 'json',
    aspects: values.aspects as string | undefined,
    modules: values.modules as string | undefined,
    coverage: values.coverage as string | undefined,
    include: values.include as string | undefined,
    noThirdParty: (values['no-third-party'] as boolean) ?? false,
    noTypeOnly: (values['no-type-only'] as boolean) ?? false,
    quiet: (values.quiet as boolean) ?? false,
    help: (values.help as boolean) ?? false,
    version: (values.version as boolean) ?? false,
    positionals,
  };
}

/**
 * Return the full help text for the CLI.
 */
export function formatHelp(): string {
  return `aspect-analyze — Analyze TypeScript/JavaScript code architecture

Usage: aspect-analyze [options] [rootDir]

Options:
  -r, --root <dir>       Root directory (default: current directory)
  --src <dirs>           Source directories, comma-separated (default: src)
  -o, --output <file>    Output file (default: stdout)
  -f, --format <fmt>     Output format: json, sarif, dot, graphml, sonarqube
  --aspects <list>       Collection aspects (comma-separated)
  --modules <file>       Module boundaries JSON file
  --coverage <file>      Coverage report path
  --include <list>       Calculator groups to include
  --no-third-party       Exclude third-party from coupling
  --no-type-only         Exclude type-only imports from coupling
  -q, --quiet            Suppress progress output
  -h, --help             Show this help
  -v, --version          Show version

Examples:
  aspect-analyze .                           Analyze current directory
  aspect-analyze -f sarif -o report.sarif    Export as SARIF
  aspect-analyze --aspects entityExtraction,dependencyGraph`;
}

/**
 * Run the full collect → analyze → export pipeline.
 *
 * Extracted so tests can call it without touching `process.argv`.
 */
export async function run(args: string[]): Promise<void> {
  const cli = parseCliArgs(args);

  if (cli.help) {
    console.log(formatHelp());
    process.exit(0);
  }

  if (cli.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const format = cli.format as OutputFormat;
  if (!VALID_FORMATS.includes(format)) {
    console.error(`Error: unknown format "${cli.format}". Valid formats: ${VALID_FORMATS.join(', ')}`);
    process.exit(1);
  }

  const rootDir = resolve(cli.root ?? cli.positionals[0] ?? process.cwd());

  const log = cli.quiet
    ? (_msg: string) => {}
    : (msg: string) => console.error(`▸ ${msg}`);

  // ── Collect ───────────────────────────────────────────────────────────
  log('Collecting data...');
  const { collect } = await loadCollector();

  const moduleBoundaries = cli.modules
    ? JSON.parse(await readFile(cli.modules, 'utf-8'))
    : undefined;

  const collectionResult = await collect({
    rootDir,
    srcDirs: cli.src?.split(',') ?? ['src'],
    includeAspects: cli.aspects?.split(',') as CollectionAspect[] | undefined,
    coveragePath: cli.coverage,
    moduleBoundaries,
  });

  log(
    `Collected ${collectionResult.data.entities.length} entities, ` +
      `${collectionResult.data.relationships.length} relationships`,
  );
  for (const w of collectionResult.warnings) {
    log(`⚠ ${w}`);
  }

  // ── Analyze ───────────────────────────────────────────────────────────
  log('Analyzing...');
  const engine = await loadEngine();

  const analysisResult = await engine.analyze(
    {
      entities: collectionResult.data.entities,
      relationships: collectionResult.data.relationships,
      moduleBoundaries: collectionResult.data.moduleBoundaries,
      duplicationSignals: collectionResult.data.duplicationSignals,
      coverageSignals: collectionResult.data.coverageSignals,
      lintSignals: collectionResult.data.lintSignals,
    },
    {
      include: cli.include?.split(',') as CalculatorGroup[] | undefined,
      couplingOptions: {
        excludeThirdParty: cli.noThirdParty,
        excludeTypeOnly: cli.noTypeOnly,
      },
    },
  );

  log(`Analysis complete (${analysisResult.timing.totalMs.toFixed(0)}ms)`);

  // ── Export ────────────────────────────────────────────────────────────
  const collectedData = {
    entities: collectionResult.data.entities,
    relationships: collectionResult.data.relationships,
    moduleBoundaries: collectionResult.data.moduleBoundaries,
  };

  let output: string;
  switch (format) {
    case 'sarif':
      output = JSON.stringify(engine.toSarif(analysisResult, collectedData), null, 2);
      break;
    case 'dot':
      output = engine.toDot(analysisResult, collectedData);
      break;
    case 'graphml':
      output = engine.toGraphML(analysisResult, collectedData);
      break;
    case 'sonarqube':
      output = JSON.stringify(engine.toSonarQube(analysisResult, collectedData), null, 2);
      break;
    case 'json':
    default:
      output = engine.toJson(analysisResult);
      break;
  }

  if (cli.output) {
    await mkdir(dirname(cli.output), { recursive: true });
    await writeFile(cli.output, output, 'utf-8');
    log(`Written to ${cli.output}`);
  } else {
    process.stdout.write(output);
  }

  // ── Summary ──────────────────────────────────────────────────────────
  if (!cli.quiet) {
    const s = analysisResult.summary;
    console.error(`\n📊 Summary:`);
    console.error(
      `   Entities: ${s.entityCount} | Relationships: ${s.relationshipCount} | Modules: ${s.moduleCount}`,
    );
    console.error(
      `   Max cyclomatic: ${s.maxCyclomaticComplexity} | Cycles: ${s.cycleCount} | Duplication: ${s.overallDuplicationPercentage.toFixed(1)}%`,
    );
  }
}

// ── Entry point ─────────────────────────────────────────────────────────

main().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});

function main(): Promise<void> {
  return run(process.argv.slice(2));
}
