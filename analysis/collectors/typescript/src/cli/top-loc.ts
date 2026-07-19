#!/usr/bin/env node
/**
 * Quick CLI: list the top N entities by lines of code.
 *
 * Usage:
 *   node top-loc.js <rootDir> [options]
 *
 * All filtering is parameter-driven — no hardcoded defaults.
 */

import path from 'node:path';
import { collect } from '../orchestrator.js';

interface CliOptions {
  rootDir?: string;
  limit?: number;
  exclude?: string[];
  kinds?: string[];
  noFiles?: boolean;
  noTests?: boolean;
}

function printHelp(): void {
  process.stdout.write('\nTop-LOC — list biggest entities by lines of code\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  top-loc <rootDir> [options]\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write('  --limit <n>                    Number of entities to show (default: 20)\n');
  process.stdout.write('  --exclude <csv>                Exclude paths containing these substrings\n');
  process.stdout.write('  --kinds <csv>                  Only include these entity kinds (e.g. class,function,method)\n');
  process.stdout.write('  --no-files                     Exclude file-level entities (default: false)\n');
  process.stdout.write('  --no-tests                     Exclude *.test.* and *.spec.* files (default: false)\n');
  process.stdout.write('  --help                         Show this help\n\n');
  process.stdout.write('Examples:\n');
  process.stdout.write('  top-loc ./my-project\n');
  process.stdout.write('  top-loc . --kinds class,function,method --no-tests\n');
  process.stdout.write('  top-loc . --no-files --exclude node_modules,dist,build\n');
  process.stdout.write('  top-loc . --kinds class --limit 50 --no-tests\n\n');
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  const opts: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    } else if (arg === '--limit' && i + 1 < args.length) {
      opts.limit = Number.parseInt(args[++i], 10);
    } else if (arg === '--exclude' && i + 1 < args.length) {
      opts.exclude = args[++i].split(',').map((v) => v.trim());
    } else if (arg === '--kinds' && i + 1 < args.length) {
      opts.kinds = args[++i].split(',').map((v) => v.trim());
    } else if (arg === '--no-files') {
      opts.noFiles = true;
    } else if (arg === '--no-tests') {
      opts.noTests = true;
    } else if (!arg.startsWith('--')) {
      opts.rootDir = arg;
    }
  }

  return opts;
}

function mainAsync(): void {
  const opts = parseArgs();
  const rootDir = path.resolve(opts.rootDir ?? process.cwd());
  const limit = opts.limit ?? 20;
  const exclude = opts.exclude ?? [];
  const kinds = opts.kinds ?? [];
  const noFiles = opts.noFiles ?? false;
  const noTests = opts.noTests ?? false;

  process.stdout.write(`Collecting entities from ${rootDir}...\n`);

  collect({
    rootDir,
    srcDirs: ['.'],
    includeAspects: ['entityExtraction'],
    exclude: exclude.map((s) => `**/${s}/**`),
  }).then((result) => {
    const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|jsx)$/;

    let entities = result.data.entities.filter(
      (e) => e.rawCounts?.linesOfCode && e.rawCounts!.linesOfCode! > 0
    );

    if (noFiles) {
      entities = entities.filter((e) => e.kind !== 'file');
    }

    if (noTests) {
      entities = entities.filter((e) => !TEST_FILE_RE.test(e.filePath));
    }

    if (kinds.length > 0) {
      const kindSet = new Set(kinds);
      entities = entities.filter((e) => kindSet.has(e.kind));
    }

    entities.sort((a, b) => (b.rawCounts?.linesOfCode ?? 0) - (a.rawCounts?.linesOfCode ?? 0));

    const top = entities.slice(0, limit);

    const maxLoc = top[0]?.rawCounts?.linesOfCode ?? 1;
    const maxName = Math.min(Math.max(...top.map((e) => e.name.length)), 60);

    process.stdout.write(
      `\nTop ${top.length} entities by LOC (root: ${rootDir})\n` + `${'='.repeat(120)}\n`
    );

    top.forEach((entity, idx) => {
      const loc = entity.rawCounts?.linesOfCode ?? 0;
      const barLen = Math.round((loc / maxLoc) * 30);
      const bar = '█'.repeat(barLen) + '░'.repeat(30 - barLen);
      const relPath = path.relative(rootDir, entity.filePath);

      process.stdout.write(
        `${String(idx + 1).padStart(3)}. ` +
          `${entity.kind.padEnd(12)} ` +
          `${entity.name.padEnd(maxName)} ` +
          `${String(loc).padStart(6)} LOC  ${bar}  ${relPath}\n`
      );
    });

    process.stdout.write(`${'='.repeat(120)}\n`);
    process.stdout.write(`Total entities scanned: ${entities.length}\n`);
  });
}

mainAsync();
