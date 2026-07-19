#!/usr/bin/env node
/**
 * Aspect dead-code CLI — symbol-level dead code detection via TypeScript compiler API.
 *
 * Uses ts.createProgram + TypeChecker to resolve symbols through re-exports,
 * count references in production files only, and detect:
 *  - Dead exported symbols (zero prod references)
 *  - Dead interface methods (implementing method never called)
 *  - Dead types (interfaces/types with zero consumers)
 *  - Dead enum members (never referenced in prod)
 *  - Dead private members (never used within containing class)
 *
 * Usage:
 *   aspect-dead-code [rootDir] [options]
 *   aspect-dead-code packages/service
 *   aspect-dead-code . --tsconfig packages/service/tsconfig.json
 */

import path from 'node:path';
import {
  analyzeDeadCodeAsync,
  findTsconfig,
  DEFAULT_SKIP_DIRS,
  type AnalysisResult,
  type SymbolEntity,
} from './symbol-analyzer.js';

interface CliOptions {
  rootDir?: string;
  tsconfig?: string;
  format?: 'text' | 'json';
  skipDirs?: string;
}

function installBrokenPipeGuard(): void {
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      process.exit(0);
    }
    throw err;
  });
}

function printHelp(): void {
  process.stdout.write('\nAspect dead-code detector (symbol-level)\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  aspect-dead-code [rootDir] [options]\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write(
    '  --tsconfig <path>              Path to tsconfig.json (default: auto-detect root)\n'
  );
  process.stdout.write('  --format <text|json>           Output format (default: text)\n');
  process.stdout.write(
    '  --skip-dirs <dirs>           Comma-separated dirs to skip (default: node_modules,dist,build,.next,.output,storybook-static,coverage)\n'
  );
  process.stdout.write('  --help                         Show this help\n\n');
  process.stdout.write('Examples:\n');
  process.stdout.write('  aspect-dead-code .\n');
  process.stdout.write('  aspect-dead-code . --format json\n');
  process.stdout.write('  aspect-dead-code . --skip-dirs dist,build,node_modules\n\n');
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
    skipDirs: undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (!arg.startsWith('--')) {
      if (!options.rootDir) {
        options.rootDir = arg;
      }
      continue;
    }

    switch (arg) {
      case '--help':
        printHelp();
        process.exit(0);
      case '--tsconfig':
        options.tsconfig = next;
        i++;
        break;
      case '--format':
        options.format = (next as CliOptions['format']) ?? 'text';
        i++;
        break;
      case '--skip-dirs':
        options.skipDirs = next;
        i++;
        break;
      default:
        break;
    }
  }

  return options;
}

function printTextReport(rootDir: string, result: AnalysisResult): void {
  const w = (s: string) => process.stdout.write(s);
  const rel = (p: string) => path.relative(rootDir, p);

  // Dead members (interface methods, class members, type properties)
  const allDeadMembers: typeof result.deadEntities[number]['deadMembers'][number][] = [];
  for (const e of result.entities) {
    for (const m of e.deadMembers) allDeadMembers.push(m);
  }

  if (allDeadMembers.length > 0) {
    w(`\nDead Members (never referenced): ${allDeadMembers.length}\n`);
    w('='.repeat(120) + '\n');

    const byParentKind = new Map<string, typeof allDeadMembers>();
    for (const m of allDeadMembers) {
      const parent = result.entities.find((e) => e.entityId === m.parentEntityId);
      const parentKind = parent?.kind ?? 'unknown';
      let list = byParentKind.get(parentKind);
      if (!list) { list = []; byParentKind.set(parentKind, list); }
      list.push(m);
    }

    for (const [parentKind, members] of byParentKind) {
      w(`\n  ${parentKind} members (${members.length} dead):\n`);
      for (const m of members.slice(0, 40)) {
        const loc = `${rel(m.filePath)}:${m.line}`;
        w(`    ${loc}  ${m.parentName}.${m.name} (${m.kind})\n`);
      }
      if (members.length > 40) {
        w(`    ... and ${members.length - 40} more\n`);
      }
    }
  }

  // Dead entities by kind
  w(`\nDead Exported Entities: ${result.deadEntities.length}\n`);
  w('='.repeat(120) + '\n');

  const byKind = new Map<string, SymbolEntity[]>();
  for (const e of result.deadEntities) {
    const list = byKind.get(e.kind) ?? [];
    list.push(e);
    byKind.set(e.kind, list);
  }

  for (const [kind, entities] of byKind) {
    w(`\n  ${kind} (${entities.length} dead):\n`);
    for (const e of entities.slice(0, 50)) {
      const loc = `${rel(e.filePath)}:${e.line}`;
      const scoreParts = Object.entries(e.scoreBreakdown.byScope)
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
      const suffix = scoreParts ? ` [${scoreParts}]` : '';
      w(`    ${loc}  ${e.name}${suffix}\n`);
    }
    if (entities.length > 50) {
      w(`    ... and ${entities.length - 50} more\n`);
    }
  }

  // Recommendations
  if (result.recommendations.length > 0) {
    w(`\nRecommendations: ${result.recommendations.length}\n`);
    w('='.repeat(120) + '\n');
    for (const rec of result.recommendations.slice(0, 30)) {
      const loc = rec.line > 0 ? `${rel(rec.filePath)}:${rec.line}` : rel(rec.filePath);
      w(`  [${rec.type}] ${loc}  ${rec.entityName || ''}: ${rec.message}\n`);
    }
    if (result.recommendations.length > 30) {
      w(`  ... and ${result.recommendations.length - 30} more\n`);
    }
  }

  // Summary
  w(`\nSummary\n`);
  w('-'.repeat(120) + '\n');
  w(`  tsconfig:          ${rel(result.tsconfig)}\n`);
  w(`  Prod files:        ${result.prodFileCount}\n`);
  w(`  Test files:        ${result.testFileCount} (excluded from reference counting)\n`);
  w(`  Total entities:    ${result.summary.total}\n`);
  w(`  Dead entities:     ${result.summary.dead}\n`);
  w(`  Dead members:      ${allDeadMembers.length}\n`);
  w(`  Exported:          ${result.summary.exported}\n`);
  w(`  Dead exported:     ${result.summary.deadExported}\n`);
  w(`\n`);

  // By kind breakdown
  w('  By kind:\n');
  for (const [kind, counts] of Object.entries(result.summary.byKind)) {
    const pct = counts.total > 0 ? ((counts.dead / counts.total) * 100).toFixed(1) : '0.0';
    w(`    ${kind.padEnd(15)} ${String(counts.dead).padStart(5)} dead / ${String(counts.total).padStart(5)} total (${pct}%)\n`);
  }
  w(`\n`);

  // By scope
  w('  Reference scope (exported entities):\n');
  const scope = result.summary.byScope;
  w(`    Same file only:     ${scope.same_file_only}\n`);
  w(`    Same folder only:   ${scope.same_folder_only}\n`);
  w(`    Same package only:  ${scope.same_package_only}\n`);
  w(`    Cross-package:      ${scope.cross_package}\n`);
  w(`\n`);

  // By package
  w('  By package:\n');
  for (const [pkg, counts] of Object.entries(result.summary.byPackage)) {
    const pct = counts.total > 0 ? ((counts.dead / counts.total) * 100).toFixed(1) : '0.0';
    w(`    ${pkg.padEnd(25)} ${String(counts.dead).padStart(5)} dead / ${String(counts.total).padStart(5)} total (${pct}%)\n`);
  }
}

function printJsonReport(rootDir: string, result: AnalysisResult): void {
  const rel = (p: string) => path.relative(rootDir, p);

  console.log(
    JSON.stringify(
      {
        rootDir,
        tsconfig: rel(result.tsconfig),
        prodFileCount: result.prodFileCount,
        testFileCount: result.testFileCount,
        summary: result.summary,
        deadEntities: result.deadEntities.map((e) => ({
          filePath: rel(e.filePath),
          name: e.name,
          kind: e.kind,
          line: e.line,
          refCount: e.refCount,
          score: e.score,
          scoreBreakdown: e.scoreBreakdown,
          packageName: e.packageName,
          isExported: e.isExported,
          implementers: e.implementers,
          implementsInterfaces: e.implementsInterfaces,
          deadParameters: e.deadParameters,
          fanIn: e.fanIn,
          fanOut: e.fanOut,
        })),
        recommendations: result.recommendations.map((r) => ({
          type: r.type,
          filePath: rel(r.filePath),
          line: r.line,
          entityName: r.entityName,
          message: r.message,
        })),
      },
      null,
      2
    )
  );
}

async function mainAsync(): Promise<void> {
  installBrokenPipeGuard();
  const opts = parseArgs(process.argv.slice(2));

  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const format = opts.format ?? 'text';

  // Parse skip directories
  const skipDirs = opts.skipDirs
    ? new Set(opts.skipDirs.split(',').map((d) => d.trim()))
    : DEFAULT_SKIP_DIRS;

  // Always use root tsconfig for monorepo-wide analysis
  let tsconfigPath = opts.tsconfig;
  if (tsconfigPath) {
    tsconfigPath = path.resolve(rootDir, tsconfigPath);
  } else {
    const found = findTsconfig(rootDir);
    if (found) {
      tsconfigPath = found;
    } else {
      process.stderr.write(`Error: No tsconfig.json found in ${rootDir} or parent directories.\n`);
      process.exit(1);
    }
  }

  const result = await analyzeDeadCodeAsync(tsconfigPath, skipDirs);

  if (format === 'json') {
    printJsonReport(rootDir, result);
  } else {
    printTextReport(rootDir, result);
  }
}

try {
  await mainAsync();
} catch (err) {
  process.stderr.write(`Error: ${(err as Error).message}\n`);
  process.exit(1);
}
