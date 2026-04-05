/**
 * @aspect/engine — TypeScript / JavaScript language profile
 *
 * Provides all TypeScript- and JavaScript-specific knowledge for the
 * structural analysis pipeline. This includes:
 *
 *   - Source file extensions (.ts, .tsx, .js, .jsx, .mts, .cjs, …)
 *   - Ecosystem config files (package.json, tsconfig.json, .eslintrc, …)
 *   - Test file patterns (.test., .spec., __tests__, …)
 *   - Entity kind mapping (interface → contract, class → logic, …)
 *   - JSX/TSX presentation detection
 *   - TypeScript declaration file detection (.d.ts)
 *   - Framework-specific extensions (.vue, .svelte)
 *
 * To add a new language, create a similar file that implements
 * LanguageProfile and pass it to the pipeline.
 */

import type { LanguageProfile } from '../language-profile.js';
import type { CodeContentRole, ContentSignal, ClassifiableEntity } from '../2-code-classification.js';

// ── File classification data ────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts',
  '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte',
]);

const CONFIG_FILE_NAMES = new Set([
  // Node / npm / pnpm / yarn
  'package.json', '.npmrc', '.nvmrc', '.node-version',
  '.yarnrc', '.yarnrc.yml', 'pnpm-workspace.yaml',
  // TypeScript
  'tsconfig.json', 'tsconfig.build.json', 'tsconfig.app.json',
  'tsconfig.node.json', 'tsconfig.lib.json',
  // Linters / formatters
  '.eslintrc', '.eslintrc.json', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.yml',
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
  '.prettierrc', '.prettierrc.json', '.prettierrc.js', '.prettierrc.yml',
  'prettier.config.js', 'prettier.config.mjs',
  '.prettierignore', '.eslintignore',
  // Bundlers / build tools
  'rollup.config.js', 'rollup.config.mjs', 'rollup.config.ts',
  'webpack.config.js', 'webpack.config.ts',
  'vite.config.ts', 'vite.config.js', 'vite.config.mts',
  'esbuild.config.js', 'esbuild.config.mjs',
  'turbo.json',
  // Testing
  'jest.config.js', 'jest.config.ts', 'jest.config.mjs',
  'vitest.config.ts', 'vitest.config.js', 'vitest.config.mts',
  'vitest.workspace.ts',
  'playwright.config.ts', 'playwright.config.js',
  'cypress.config.ts', 'cypress.config.js',
  // Frameworks
  'next.config.js', 'next.config.mjs', 'next.config.ts',
  'nuxt.config.ts', 'nuxt.config.js',
  'svelte.config.js', 'astro.config.mjs',
  'remix.config.js', 'gatsby-config.js',
  // CSS / PostCSS
  'postcss.config.js', 'postcss.config.mjs', 'postcss.config.cjs',
  'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.mjs',
  '.browserslistrc',
  // Babel
  'babel.config.js', 'babel.config.json', '.babelrc',
  // Storybook
  '.storybook/main.js', '.storybook/main.ts',
  // Nx / Lerna
  'nx.json', 'lerna.json', 'project.json',
]);

const CONFIG_FILE_PATTERNS: RegExp[] = [
  /^tsconfig.*\.json$/,
  /^\.?eslint/,
  /^\.?prettier/,
  /^jest\./,
  /^vitest\./,
  /^vite\./,
  /^webpack\./,
  /^rollup\./,
  /^babel\./,
  /^postcss\./,
  /^tailwind\./,
  /^next\.config/,
  /^nuxt\.config/,
];

const TEST_FILE_PATTERNS: RegExp[] = [
  /\.test\.[^.]+$/,
  /\.spec\.[^.]+$/,
  /\.e2e\.[^.]+$/,
  /\.integration\.[^.]+$/,
  /\.unit\.[^.]+$/,
  /\b__tests__\b/,
  /\b__test__\b/,
  /\b__mocks__\b/,
  /\b__fixtures__\b/,
  /\b__snapshots__\b/,
  /\.stories\.[^.]+$/,
  /\.story\.[^.]+$/,
];

const TEST_DIR_PATTERNS: RegExp[] = [
  /^tests?\//,
  /\/tests?\//,
  /^specs?\//,
  /\/specs?\//,
  /^__tests__\//,
  /\/__tests__\//,
];

// ── Code content classification data ────────────────────────────────────

const CONTRACT_ENTITY_KINDS = new Set(['interface', 'type-alias']);
const LOGIC_ENTITY_KINDS = new Set(['class', 'function', 'method', 'enum']);
const PROPERTY_ENTITY_KINDS = new Set(['field', 'property']);

const DECLARATION_EXTENSIONS = new Set(['.d.ts', '.d.mts', '.d.cts']);

// ── Extension-based signals ─────────────────────────────────────────────

function collectExtensionSignals(filePath: string, ext: string): ContentSignal[] {
  const signals: ContentSignal[] = [];
  const lowerExt = ext.toLowerCase();
  const norm = filePath.replace(/\\/g, '/').toLowerCase();

  if (lowerExt === '.tsx' || lowerExt === '.jsx') {
    signals.push({
      signal: 'jsx-extension',
      role: 'presentation',
      weight: 0.30,
      description: 'JSX/TSX file — likely contains UI rendering',
    });
  }

  if (lowerExt === '.vue') {
    signals.push({
      signal: 'component-framework',
      role: 'presentation',
      weight: 0.70,
      description: 'Vue single-file component',
    });
  }

  if (lowerExt === '.svelte') {
    signals.push({
      signal: 'component-framework',
      role: 'presentation',
      weight: 0.70,
      description: 'Svelte component file',
    });
  }

  if (norm.endsWith('.d.ts') || norm.endsWith('.d.mts') || norm.endsWith('.d.cts')) {
    signals.push({
      signal: 'declaration-file',
      role: 'contract',
      weight: 0.60,
      description: 'TypeScript declaration file — pure type definitions',
    });
  }

  return signals;
}

// ── Composition adjustment (JSX handling) ───────────────────────────────

function adjustComposition(
  composition: Partial<Record<CodeContentRole, number>>,
  ext: string,
  entities: ClassifiableEntity[],
): Partial<Record<CodeContentRole, number>> {
  const result = { ...composition };
  const lowerExt = ext.toLowerCase();

  // JSX element counting — split logic entities that contain JSX into
  // presentation + logic proportionally
  let extraPresentation = 0;
  let logicReduction = 0;

  for (const e of entities) {
    const jsxCount = e.jsxElementCount ?? 0;
    if (jsxCount > 0) {
      const loc = e.linesOfCode ?? 10;
      const jsxLines = jsxCount * 3;
      const presentationRatio = Math.min(1, jsxLines / Math.max(1, loc));
      extraPresentation += presentationRatio;
      logicReduction += presentationRatio;
    }
  }

  if (extraPresentation > 0) {
    const total = (result.contract ?? 0) + (result.logic ?? 0) + (result.presentation ?? 0) + extraPresentation;
    if (total > 0) {
      if (result.logic) result.logic = Math.max(0, result.logic - logicReduction / total);
      result.presentation = (result.presentation ?? 0) + extraPresentation / total;
    }
  }

  // TSX/JSX baseline: even without explicit JSX data, these files get a
  // small presentation weight if they have logic but no presentation
  if ((lowerExt === '.tsx' || lowerExt === '.jsx') &&
      (result.presentation ?? 0) === 0 && (result.logic ?? 0) > 0) {
    const logic = result.logic!;
    result.presentation = Math.round(logic * 0.15 * 100) / 100;
    result.logic = Math.round(logic * 0.85 * 100) / 100;
  }

  return result;
}

// ── Profile export ──────────────────────────────────────────────────────

export const TYPESCRIPT_PROFILE: LanguageProfile = {
  id: 'typescript',
  name: 'TypeScript / JavaScript',

  codeExtensions: CODE_EXTENSIONS,
  configFileNames: CONFIG_FILE_NAMES,
  configFilePatterns: CONFIG_FILE_PATTERNS,
  testFilePatterns: TEST_FILE_PATTERNS,
  testDirPatterns: TEST_DIR_PATTERNS,

  contractEntityKinds: CONTRACT_ENTITY_KINDS,
  logicEntityKinds: LOGIC_ENTITY_KINDS,
  propertyEntityKinds: PROPERTY_ENTITY_KINDS,
  declarationExtensions: DECLARATION_EXTENSIONS,

  collectExtensionSignals,
  adjustComposition,
};
