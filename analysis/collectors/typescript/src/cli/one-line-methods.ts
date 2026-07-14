#!/usr/bin/env node
import path from 'node:path';
import {
  findOneLineMethodsAsync,
  type OneLineMethodFinding,
  type OneLineMethodKind,
} from '../one-line-methods.js';

interface CliOptions {
  rootDir?: string;
  format?: 'text' | 'json';
  includeExtensions?: string[];
  excludePathSubstrings?: string[];
  kind?: OneLineMethodKind | 'all';
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
  process.stdout.write('\nAspect one-line method analyzer\n\n');
  process.stdout.write('Usage:\n');
  process.stdout.write('  aspect-one-line-methods [rootDir] [options]\n\n');
  process.stdout.write('Options:\n');
  process.stdout.write('  --format <text|json>              Output format (default: text)\n');
  process.stdout.write(
    '  --kind <all|single-statement|forwarder|passthrough-forwarder|free-function-forwarder|free-function-passthrough-forwarder>\n'
  );
  process.stdout.write('                                   Filter findings by classification\n');
  process.stdout.write(
    '  --include-ext <csv>              File extensions (default: ts,tsx,js,jsx,mjs,cjs)\n'
  );
  process.stdout.write(
    '  --exclude <csv>                  Exclude path substrings (default: node_modules,/dist/,/build/,/coverage/,/.git/)\n'
  );
  process.stdout.write('  --help                            Show this help\n\n');
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
    kind: 'all',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = argv[i + 1];

    if (arg === '--') {
      continue;
    }

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
        i += 1;
        break;
      case '--kind': {
        const allowed = [
          'all',
          'single-statement',
          'forwarder',
          'passthrough-forwarder',
          'free-function-forwarder',
          'free-function-passthrough-forwarder',
        ] as const;
        if (!next || !allowed.includes(next as (typeof allowed)[number])) {
          throw new TypeError(`Invalid --kind value: ${next ?? ''}`);
        }
        options.kind = next as CliOptions['kind'];
        i += 1;
        break;
      }
      case '--include-ext':
        options.includeExtensions = parseCsv(next);
        i += 1;
        break;
      case '--exclude':
        options.excludePathSubstrings = parseCsv(next);
        i += 1;
        break;
      default:
        throw new TypeError(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function formatFindingText(finding: OneLineMethodFinding, cwd: string): string {
  const relativePath = path.relative(cwd, finding.filePath).replaceAll('\\', '/');
  const target =
    finding.callType === 'this-call' && finding.callTarget
      ? ` -> this.${finding.callTarget}()`
      : finding.callType === 'free-function-call' && finding.callTarget
        ? ` -> ${finding.callTarget}()`
        : '';
  return [
    `${relativePath}:${finding.line}`,
    `  ${finding.visibility} ${finding.isAsync ? 'async ' : ''}${finding.methodName}(${finding.params.join(', ')})`,
    `  kind: ${finding.kind}${target}`,
    `  interface: ${finding.interfaceRequirement ?? 'n/a'}${
      finding.requiredByInterfaces?.length ? ` (${finding.requiredByInterfaces.join(', ')})` : ''
    }`,
    `  relation: ${finding.targetPackageRelation ?? 'n/a'}  usage: ${finding.targetUsageCount ?? 'n/a'}  urgency: ${finding.inlineUrgency ?? 'n/a'}`,
    finding.inlineReason ? `  reason: ${finding.inlineReason}` : undefined,
    `  stmt: ${finding.statement}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}

async function mainAsync(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const invokeCwd = process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD) : process.cwd();
  const rootDir = args.rootDir ? path.resolve(invokeCwd, args.rootDir) : invokeCwd;

  const findings = await findOneLineMethodsAsync({
    rootDir,
    includeExtensions: args.includeExtensions,
    excludePathSubstrings: args.excludePathSubstrings,
  });

  const filtered =
    args.kind && args.kind !== 'all' ? findings.filter((f) => f.kind === args.kind) : findings;

  if (args.format === 'json') {
    process.stdout.write(
      `${JSON.stringify(
        {
          rootDir,
          total: filtered.length,
          byKind: {
            'single-statement': filtered.filter((f) => f.kind === 'single-statement').length,
            forwarder: filtered.filter((f) => f.kind === 'forwarder').length,
            'free-function-forwarder': filtered.filter((f) => f.kind === 'free-function-forwarder')
              .length,
            'free-function-passthrough-forwarder': filtered.filter(
              (f) => f.kind === 'free-function-passthrough-forwarder'
            ).length,
            'passthrough-forwarder': filtered.filter((f) => f.kind === 'passthrough-forwarder')
              .length,
          },
          byUrgency: {
            high: filtered.filter((f) => f.inlineUrgency === 'high').length,
            medium: filtered.filter((f) => f.inlineUrgency === 'medium').length,
            low: filtered.filter((f) => f.inlineUrgency === 'low').length,
            avoid: filtered.filter((f) => f.inlineUrgency === 'avoid').length,
          },
          findings: filtered,
        },
        null,
        2
      )}\n`
    );
    return;
  }

  const byKind = {
    'single-statement': filtered.filter((f) => f.kind === 'single-statement').length,
    forwarder: filtered.filter((f) => f.kind === 'forwarder').length,
    'free-function-forwarder': filtered.filter((f) => f.kind === 'free-function-forwarder').length,
    'free-function-passthrough-forwarder': filtered.filter(
      (f) => f.kind === 'free-function-passthrough-forwarder'
    ).length,
    'passthrough-forwarder': filtered.filter((f) => f.kind === 'passthrough-forwarder').length,
  };
  const byUrgency = {
    high: filtered.filter((f) => f.inlineUrgency === 'high').length,
    medium: filtered.filter((f) => f.inlineUrgency === 'medium').length,
    low: filtered.filter((f) => f.inlineUrgency === 'low').length,
    avoid: filtered.filter((f) => f.inlineUrgency === 'avoid').length,
  };

  process.stdout.write(`\nroot: ${rootDir}\n`);
  process.stdout.write(`total findings: ${filtered.length}\n`);
  process.stdout.write(`single-statement: ${byKind['single-statement']}\n`);
  process.stdout.write(`forwarder: ${byKind.forwarder}\n`);
  process.stdout.write(`free-function-forwarder: ${byKind['free-function-forwarder']}\n`);
  process.stdout.write(
    `free-function-passthrough-forwarder: ${byKind['free-function-passthrough-forwarder']}\n`
  );
  process.stdout.write(`passthrough-forwarder: ${byKind['passthrough-forwarder']}\n\n`);
  process.stdout.write(`urgency high: ${byUrgency.high}\n`);
  process.stdout.write(`urgency medium: ${byUrgency.medium}\n`);
  process.stdout.write(`urgency low: ${byUrgency.low}\n`);
  process.stdout.write(`urgency avoid: ${byUrgency.avoid}\n\n`);

  for (const finding of filtered) {
    process.stdout.write(`${formatFindingText(finding, invokeCwd)}\n\n`);
  }
}

try {
  installBrokenPipeGuard();
  await mainAsync();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`aspect-one-line-methods: ${message}\n`);
  process.exit(1);
}
