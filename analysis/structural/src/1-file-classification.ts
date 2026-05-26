/**
 * @aspect/engine — Step 1: File classification
 *
 * Classifies files purely by their path and extension.
 * No AST analysis, no coupling metrics.
 *
 * Language-specific knowledge (which extensions are code, which files
 * are config/test) can be injected via MergedFileHints from language
 * profiles. Without hints, falls back to broad built-in defaults.
 *
 * Every file falls into exactly one category: code, test, config,
 * documentation, ai_config, style, markup, data, script, binary, unknown.
 */

import type { MergedFileHints } from './language-profile.js';

// ── Public types ────────────────────────────────────────────────────────

export type FileCategory =
  | 'code'
  | 'test'
  | 'config'
  | 'documentation'
  | 'ai_config'
  | 'style'
  | 'markup'
  | 'data'
  | 'script'
  | 'binary'
  | 'unknown';

export interface FileClassification {
  category: FileCategory;
  confidence: number;
  reason: string;
}

// ── Universal extension maps (not language-specific) ────────────────────

const STYLE_EXTENSIONS = new Set([
  '.css', '.scss', '.sass', '.less', '.styl', '.stylus',
]);

const MARKUP_EXTENSIONS = new Set([
  '.html', '.htm',
  '.ejs', '.hbs', '.handlebars', '.pug', '.jade',
  '.njk', '.mustache', '.liquid',
]);

const DATA_EXTENSIONS = new Set([
  '.json', '.jsonc', '.json5',
  '.yaml', '.yml', '.toml',
  '.xml', '.csv', '.tsv',
  '.graphql', '.gql',
  '.proto', '.avsc',
]);

const SCRIPT_EXTENSIONS = new Set([
  '.sh', '.bash', '.zsh', '.fish',
  '.ps1', '.psm1', '.psd1',
  '.bat', '.cmd',
]);

const DOC_EXTENSIONS = new Set([
  '.md', '.mdx', '.txt', '.rst',
  '.adoc', '.asciidoc', '.org',
]);

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.svg', '.webp', '.avif', '.tiff',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.zip', '.tar', '.gz', '.br', '.bz2', '.7z', '.rar',
  '.mp3', '.mp4', '.wav', '.ogg', '.webm', '.flac', '.avi', '.mov',
  '.wasm', '.node', '.dll', '.so', '.dylib', '.exe', '.o', '.a',
]);

const LOCK_FILE_NAMES = new Set([
  'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock',
  'composer.lock', 'gemfile.lock', 'cargo.lock',
  'poetry.lock', 'pipfile.lock', 'go.sum',
]);

// ── Universal config/test patterns (cross-language conventions) ─────────

const UNIVERSAL_CONFIG_FILE_NAMES = new Set([
  'makefile', 'dockerfile', 'vagrantfile', 'procfile',
  '.editorconfig', '.gitignore', '.gitattributes', '.dockerignore',
  'renovate.json', 'dependabot.yml',
  'docker-compose.yml', 'docker-compose.yaml',
]);

const UNIVERSAL_CONFIG_FILE_PATTERNS: RegExp[] = [
  /\.config\.[^.]+$/,
  /\.conf\.[^.]+$/,
  /\.rc\.[^.]+$/,
  /^\.env/,
  /^docker-compose/,
  /^nginx\.conf/,
];

const UNIVERSAL_TEST_DIR_PATTERNS: RegExp[] = [
  /^tests?\//,
  /\/tests?\//,
  /^specs?\//,
  /\/specs?\//,
];

const AI_CONFIG_PATTERNS = [
  /\.agent\.md$/i,
  /\.ai-team\b/,
  /\.github\/copilot/i,
  /\/AGENTS\.md$|^AGENTS\.md$/,
  /copilot-instructions\.md$/i,
];

// ── Built-in defaults (backwards compatibility) ─────────────────────────
// Used when no language profiles are provided. Includes a broad set of
// known code extensions so the classifier works out of the box.

const BUILTIN_CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.rb', '.java', '.kt', '.kts', '.scala',
  '.cs', '.fs', '.vb',
  '.go', '.rs', '.c', '.cpp', '.cc', '.h', '.hpp',
  '.swift', '.m', '.mm',
  '.php', '.lua', '.r', '.jl',
  '.dart', '.elm', '.ex', '.exs', '.erl', '.hrl',
  '.hs', '.ml', '.mli', '.clj', '.cljs',
  '.vue', '.svelte',
]);

const BUILTIN_CONFIG_FILE_NAMES = new Set([
  ...UNIVERSAL_CONFIG_FILE_NAMES,
  // JS/TS ecosystem defaults for backwards compatibility
  '.npmrc', '.nvmrc', '.node-version', '.python-version',
  '.ruby-version', '.tool-versions', '.prettierignore', '.eslintignore',
  'rakefile', 'gemfile', 'brewfile', 'cakefile', 'gruntfile', 'gulpfile',
]);

const BUILTIN_CONFIG_FILE_PATTERNS: RegExp[] = [
  ...UNIVERSAL_CONFIG_FILE_PATTERNS,
  /^\.?eslint/, /^\.?prettier/,
  /^tsconfig/, /^jest\./, /^vitest\./, /^vite\./, /^webpack\./,
  /^rollup\./, /^babel\./, /^postcss\./, /^tailwind\./,
  /^next\.config/, /^nuxt\.config/, /^turbo\.json$/,
  /^\.browserslistrc$/,
];

const BUILTIN_TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.[^.]+$/, /\.spec\.[^.]+$/,
  /\.e2e\.[^.]+$/, /\.integration\.[^.]+$/, /\.unit\.[^.]+$/,
  /\b__tests__\b/, /\b__test__\b/, /\b__mocks__\b/,
  /\b__fixtures__\b/, /\b__snapshots__\b/,
];

const BUILTIN_TEST_DIR_PATTERNS: RegExp[] = [
  ...UNIVERSAL_TEST_DIR_PATTERNS,
  /^__tests__\//, /\/__tests__\//,
];

// ── Helpers ─────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function getExtension(filePath: string): string {
  const base = filePath.split('/').pop() ?? '';
  const dotIdx = base.indexOf('.');
  return dotIdx >= 0 ? base.slice(dotIdx).toLowerCase() : '';
}

function getFileName(filePath: string): string {
  return (filePath.split('/').pop() ?? '').toLowerCase();
}

function matchesAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

// ── Main classifier ─────────────────────────────────────────────────────

/**
 * Classify a file by its path and extension alone.
 * Pure function — no side effects, no file system access.
 *
 * @param filePath  Relative or absolute file path
 * @param hints     Optional merged file hints from language profiles.
 *                  When omitted, uses broad built-in defaults.
 */
export function classifyByFilename(
  filePath: string,
  hints?: MergedFileHints,
): FileClassification {
  const norm = normalizePath(filePath);
  const ext = getExtension(norm);
  const fileName = getFileName(norm);

  // Resolve effective sets: profile hints → universal + built-in fallback
  const codeExts = hints?.codeExtensions ?? BUILTIN_CODE_EXTENSIONS;
  const configNames = unionSets(UNIVERSAL_CONFIG_FILE_NAMES, hints?.configFileNames ?? BUILTIN_CONFIG_FILE_NAMES);
  const configPatterns = concatArrays(UNIVERSAL_CONFIG_FILE_PATTERNS, hints?.configFilePatterns ?? BUILTIN_CONFIG_FILE_PATTERNS);
  const testFilePatterns = hints?.testFilePatterns ?? BUILTIN_TEST_FILE_PATTERNS;
  const testDirPatterns = concatArrays(UNIVERSAL_TEST_DIR_PATTERNS, hints?.testDirPatterns ?? BUILTIN_TEST_DIR_PATTERNS);

  // ── Classification cascade (order matters) ──────────────────────────

  if (matchesAny(norm, AI_CONFIG_PATTERNS)) {
    return { category: 'ai_config', confidence: 0.95, reason: 'AI agent/copilot configuration file' };
  }
  if (LOCK_FILE_NAMES.has(fileName)) {
    return { category: 'binary', confidence: 0.99, reason: `Generated lock file (${fileName})` };
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    return { category: 'binary', confidence: 0.99, reason: `Binary/asset file (${ext})` };
  }
  if (matchesAny(fileName, testFilePatterns) || matchesAny(norm, testFilePatterns)) {
    return { category: 'test', confidence: 0.95, reason: 'Test file name pattern' };
  }
  if (matchesAny(norm, testDirPatterns)) {
    return { category: 'test', confidence: 0.80, reason: 'File in test directory' };
  }
  if (configNames.has(fileName)) {
    return { category: 'config', confidence: 0.95, reason: `Known config file (${fileName})` };
  }
  if (matchesAny(fileName, configPatterns)) {
    return { category: 'config', confidence: 0.90, reason: 'Config file name pattern' };
  }
  if (DOC_EXTENSIONS.has(ext)) {
    return { category: 'documentation', confidence: 0.90, reason: `Documentation file (${ext})` };
  }
  if (STYLE_EXTENSIONS.has(ext)) {
    return { category: 'style', confidence: 0.95, reason: `Stylesheet (${ext})` };
  }
  if (MARKUP_EXTENSIONS.has(ext)) {
    return { category: 'markup', confidence: 0.90, reason: `Markup/template file (${ext})` };
  }
  if (DATA_EXTENSIONS.has(ext)) {
    return { category: 'data', confidence: 0.85, reason: `Data file (${ext})` };
  }
  if (SCRIPT_EXTENSIONS.has(ext)) {
    return { category: 'script', confidence: 0.85, reason: `Script file (${ext})` };
  }
  if (codeExts.has(ext)) {
    return { category: 'code', confidence: 0.90, reason: `Source code (${ext})` };
  }
  return { category: 'unknown', confidence: 0, reason: 'Unrecognised file type' };
}

// ── Set utilities ───────────────────────────────────────────────────────

function unionSets<T>(...sets: ReadonlySet<T>[]): ReadonlySet<T> {
  const result = new Set<T>();
  for (const s of sets) for (const v of s) result.add(v);
  return result;
}

function concatArrays<T>(...arrays: readonly (readonly T[])[]): readonly T[] {
  // Deduplicate by reference (patterns are singletons)
  const seen = new Set<T>();
  const result: T[] = [];
  for (const arr of arrays) {
    for (const item of arr) {
      if (!seen.has(item)) {
        seen.add(item);
        result.push(item);
      }
    }
  }
  return result;
}

// ── Exports for testing and language-specific classifiers ───────────────

export {
  BUILTIN_CODE_EXTENSIONS as CODE_EXTENSIONS,
  STYLE_EXTENSIONS,
  MARKUP_EXTENSIONS,
  DATA_EXTENSIONS,
  BINARY_EXTENSIONS,
  DOC_EXTENSIONS,
  BUILTIN_CONFIG_FILE_NAMES as CONFIG_FILE_NAMES,
  BUILTIN_CONFIG_FILE_PATTERNS as CONFIG_FILE_PATTERNS,
  BUILTIN_TEST_FILE_PATTERNS as TEST_FILE_PATTERNS,
  BUILTIN_TEST_DIR_PATTERNS as TEST_DIR_PATTERNS,
  AI_CONFIG_PATTERNS,
};
