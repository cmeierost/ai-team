#!/usr/bin/env node
import { detectFuzzyDuplicatesAsync, formatFuzzyDuplicateReport } from '../fuzzy-duplication.js';

interface CliOptions {
  rootDir?: string;
  includeExtensions?: string[];
  excludePatterns?: string[];
  minMatchLength?: number;
  fuzz?: number;
  gapTolerance?: number;
  maxGapBridges?: number;
  maxHoleSize?: number;
  processSameFile?: boolean;
  maxFileBytes?: number;
  format?: 'text' | 'json';
}

function printHelp(): void {
  process.stdout.write(`\nAspect fuzzy duplicate detector\n\n`);
  process.stdout.write(`Usage:\n`);
  process.stdout.write(`  aspect-fuzzy-dup [rootDir] [options]\n\n`);
  process.stdout.write(`Options:\n`);
  process.stdout.write(`  --format <text|json>           Output format (default: text)\n`);
  process.stdout.write(
    `  --include-ext <csv>            File extensions to include (default: ts,tsx,js,jsx,mjs,cjs)\n`
  );
  process.stdout.write(
    `  --exclude <csv>                Exclude path substrings (default: node_modules,dist,build,.git,coverage)\n`
  );
  process.stdout.write(
    `  --match-length <n>             Minimum matching lines per block (default: 6)\n`
  );
  process.stdout.write(`  --fuzz <0-255>                 Simhash hamming threshold (default: 2)\n`);
  process.stdout.write(`  --gap-tolerance <n>            Gap bridge lookahead (default: 1)\n`);
  process.stdout.write(`  --max-gap-bridges <n>          Max gap bridges per block (default: 1)\n`);
  process.stdout.write(
    `  --max-hole-size <n>            Max consecutive in-place holes (default: 1)\n`
  );
  process.stdout.write(`  --process-same-file            Enable same-file duplicate detection\n`);
  process.stdout.write(
    `  --max-file-bytes <n>           Skip files bigger than N bytes (default: 1000000)\n`
  );
  process.stdout.write(`  --help                         Show this help\n\n`);
}

function parseInteger(flag: string, value: string | undefined): number {
  if (!value) {
    throw new TypeError(`Missing value for ${flag}`);
  }
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    throw new TypeError(`Invalid number for ${flag}: ${value}`);
  }
  return n;
}

function parseCsv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
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
      case '-h':
        printHelp();
        process.exit(0);
        break;
      case '--format':
        if (next !== 'text' && next !== 'json') {
          throw new TypeError(`Invalid --format value: ${next ?? ''}`);
        }
        options.format = next;
        i++;
        break;
      case '--include-ext':
        options.includeExtensions = parseCsv(next);
        i++;
        break;
      case '--exclude':
        options.excludePatterns = parseCsv(next);
        i++;
        break;
      case '--match-length':
        options.minMatchLength = parseInteger(arg, next);
        i++;
        break;
      case '--fuzz':
        options.fuzz = parseInteger(arg, next);
        i++;
        break;
      case '--gap-tolerance':
        options.gapTolerance = parseInteger(arg, next);
        i++;
        break;
      case '--max-gap-bridges':
        options.maxGapBridges = parseInteger(arg, next);
        i++;
        break;
      case '--max-hole-size':
        options.maxHoleSize = parseInteger(arg, next);
        i++;
        break;
      case '--process-same-file':
        options.processSameFile = true;
        break;
      case '--max-file-bytes':
        options.maxFileBytes = parseInteger(arg, next);
        i++;
        break;
      default:
        throw new TypeError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

async function mainAsync(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const report = await detectFuzzyDuplicatesAsync({
    rootDir: args.rootDir,
    includeExtensions: args.includeExtensions,
    excludePatterns: args.excludePatterns,
    minMatchLength: args.minMatchLength,
    fuzz: args.fuzz,
    gapTolerance: args.gapTolerance,
    maxGapBridges: args.maxGapBridges,
    maxHoleSize: args.maxHoleSize,
    processSameFile: args.processSameFile,
    maxFileBytes: args.maxFileBytes,
  });

  if (args.format === 'json') {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(`${formatFuzzyDuplicateReport(report)}\n`);
}

try {
  await mainAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`aspect-fuzzy-dup: ${message}\n`);
  process.exit(1);
}
