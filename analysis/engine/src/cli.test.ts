import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCliArgs, formatHelp, run } from './cli.js';

// ── parseCliArgs ────────────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('returns correct defaults when no arguments are provided', () => {
    const args = parseCliArgs([]);

    expect(args.format).toBe('json');
    expect(args.quiet).toBe(false);
    expect(args.help).toBe(false);
    expect(args.version).toBe(false);
    expect(args.noThirdParty).toBe(false);
    expect(args.noTypeOnly).toBe(false);
    expect(args.root).toBeUndefined();
    expect(args.output).toBeUndefined();
    expect(args.src).toBeUndefined();
    expect(args.aspects).toBeUndefined();
    expect(args.modules).toBeUndefined();
    expect(args.coverage).toBeUndefined();
    expect(args.include).toBeUndefined();
    expect(args.positionals).toEqual([]);
  });

  it('parses --format sarif correctly', () => {
    const args = parseCliArgs(['--format', 'sarif']);
    expect(args.format).toBe('sarif');
  });

  it('parses -f shorthand correctly', () => {
    const args = parseCliArgs(['-f', 'dot']);
    expect(args.format).toBe('dot');
  });

  it('parses -o output flag correctly', () => {
    const args = parseCliArgs(['-o', 'report.json']);
    expect(args.output).toBe('report.json');
  });

  it('parses --output long form correctly', () => {
    const args = parseCliArgs(['--output', 'out/result.sarif']);
    expect(args.output).toBe('out/result.sarif');
  });

  it('parses --root flag correctly', () => {
    const args = parseCliArgs(['--root', '/some/project']);
    expect(args.root).toBe('/some/project');
  });

  it('parses -r shorthand for root', () => {
    const args = parseCliArgs(['-r', '/other/dir']);
    expect(args.root).toBe('/other/dir');
  });

  it('parses --src flag correctly', () => {
    const args = parseCliArgs(['--src', 'lib,src']);
    expect(args.src).toBe('lib,src');
  });

  it('parses --aspects flag correctly', () => {
    const args = parseCliArgs(['--aspects', 'entityExtraction,dependencyGraph']);
    expect(args.aspects).toBe('entityExtraction,dependencyGraph');
  });

  it('parses --modules flag correctly', () => {
    const args = parseCliArgs(['--modules', 'modules.json']);
    expect(args.modules).toBe('modules.json');
  });

  it('parses --coverage flag correctly', () => {
    const args = parseCliArgs(['--coverage', 'coverage/lcov.info']);
    expect(args.coverage).toBe('coverage/lcov.info');
  });

  it('parses --include flag correctly', () => {
    const args = parseCliArgs(['--include', 'complexity,coupling']);
    expect(args.include).toBe('complexity,coupling');
  });

  it('parses --no-third-party boolean flag', () => {
    const args = parseCliArgs(['--no-third-party']);
    expect(args.noThirdParty).toBe(true);
  });

  it('parses --no-type-only boolean flag', () => {
    const args = parseCliArgs(['--no-type-only']);
    expect(args.noTypeOnly).toBe(true);
  });

  it('parses --quiet / -q flag', () => {
    expect(parseCliArgs(['--quiet']).quiet).toBe(true);
    expect(parseCliArgs(['-q']).quiet).toBe(true);
  });

  it('parses --help / -h flag', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
  });

  it('parses --version / -v flag', () => {
    expect(parseCliArgs(['--version']).version).toBe(true);
    expect(parseCliArgs(['-v']).version).toBe(true);
  });

  it('captures positional arguments', () => {
    const args = parseCliArgs(['/my/project', '--quiet']);
    expect(args.positionals).toContain('/my/project');
    expect(args.quiet).toBe(true);
  });

  it('handles combined short and long flags', () => {
    const args = parseCliArgs(['-f', 'graphml', '-o', 'out.xml', '-q', '--no-third-party', '.']);
    expect(args.format).toBe('graphml');
    expect(args.output).toBe('out.xml');
    expect(args.quiet).toBe(true);
    expect(args.noThirdParty).toBe(true);
    expect(args.positionals).toContain('.');
  });
});

// ── formatHelp ──────────────────────────────────────────────────────────

describe('formatHelp', () => {
  it('contains the command name', () => {
    expect(formatHelp()).toContain('aspect-analyze');
  });

  it('contains the Usage line', () => {
    expect(formatHelp()).toContain('Usage:');
  });

  it('documents the --format option', () => {
    const help = formatHelp();
    expect(help).toContain('--format');
    expect(help).toContain('json');
    expect(help).toContain('sarif');
    expect(help).toContain('dot');
    expect(help).toContain('graphml');
    expect(help).toContain('sonarqube');
  });

  it('documents the --output option', () => {
    expect(formatHelp()).toContain('--output');
  });

  it('documents the --help option', () => {
    expect(formatHelp()).toContain('--help');
  });

  it('contains an Examples section', () => {
    expect(formatHelp()).toContain('Examples:');
  });
});

// ── run() — help and version flags ──────────────────────────────────────

describe('run', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit');
    }) as never);
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('exits 0 and prints help when --help is passed', async () => {
    await expect(run(['--help'])).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('aspect-analyze');
    expect(printed).toContain('Usage:');
  });

  it('exits 0 and prints version when --version is passed', async () => {
    await expect(run(['--version'])).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(0);
    const printed = logSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('0.1.0');
  });

  it('exits 1 for unknown format', async () => {
    await expect(run(['--format', 'yaml'])).rejects.toThrow('process.exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const printed = errorSpy.mock.calls.map((c) => c[0]).join('\n');
    expect(printed).toContain('unknown format');
    expect(printed).toContain('yaml');
  });
});
