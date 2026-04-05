/**
 * @aspect/engine — Language profile interface
 *
 * Defines the contract between the technology-agnostic structural
 * pipeline and language-specific knowledge providers.
 *
 * Each supported language/ecosystem provides a LanguageProfile that
 * plugs into steps 1 (file classification) and 2 (code classification).
 * The pipeline core stays technology-neutral — profiles inject the
 * language-specific parts.
 *
 * Example: TypeScript, C#, Python, Rust, Go — each gets a profile.
 * A polyglot repository uses multiple profiles simultaneously.
 */

import type { CodeContentRole } from './2-code-classification.js';

// The callback types reference step-2 types. We use `import type` to
// avoid runtime circular dependencies (types are erased at compile time).
import type { ContentSignal, ClassifiableEntity } from './2-code-classification.js';

// ── Language profile ────────────────────────────────────────────────────

export interface LanguageProfile {
  /** Unique identifier (e.g. 'typescript', 'csharp', 'python') */
  id: string;
  /** Human-readable name (e.g. 'TypeScript / JavaScript') */
  name: string;

  // ── File classification (step 1) ──────────────────────────────────

  /** File extensions this language treats as source code (e.g. '.ts', '.tsx') */
  codeExtensions: ReadonlySet<string>;
  /** Ecosystem-specific config file names (e.g. 'package.json', 'tsconfig.json') */
  configFileNames?: ReadonlySet<string>;
  /** Ecosystem-specific config file patterns */
  configFilePatterns?: readonly RegExp[];
  /** Test file patterns in path (e.g. /.test./, /.spec./) */
  testFilePatterns?: readonly RegExp[];
  /** Test directory patterns (e.g. /__tests__/) */
  testDirPatterns?: readonly RegExp[];

  // ── Code content classification (step 2) ──────────────────────────

  /** Entity kinds that represent type/contract definitions */
  contractEntityKinds?: ReadonlySet<string>;
  /** Entity kinds that represent runtime logic */
  logicEntityKinds?: ReadonlySet<string>;
  /** Entity kinds that represent properties/fields */
  propertyEntityKinds?: ReadonlySet<string>;
  /** Extensions indicating pure declaration/contract files (e.g. '.d.ts') */
  declarationExtensions?: ReadonlySet<string>;

  /**
   * Produce extra classification signals based on file extension.
   * Called during code classification for each code file.
   * Use for framework-specific signals (e.g. .tsx → presentation hint).
   */
  collectExtensionSignals?: (filePath: string, ext: string) => ContentSignal[];

  /**
   * Adjust entity composition after universal counting.
   * Use for language-specific entity interpretation
   * (e.g. JSX element counting for React presentation weight).
   */
  adjustComposition?: (
    composition: Partial<Record<CodeContentRole, number>>,
    ext: string,
    entities: ClassifiableEntity[],
  ) => Partial<Record<CodeContentRole, number>>;
}

// ── Merged file hints (for step 1) ──────────────────────────────────────

/**
 * Combined view of all active profiles for file classification.
 * Step 1 needs a merged set because any file in the repo could
 * belong to any language.
 */
export interface MergedFileHints {
  codeExtensions: ReadonlySet<string>;
  configFileNames: ReadonlySet<string>;
  configFilePatterns: readonly RegExp[];
  testFilePatterns: readonly RegExp[];
  testDirPatterns: readonly RegExp[];
}

/**
 * Merge multiple language profiles into a single file-classification
 * context. Unions all sets and concatenates all pattern arrays.
 */
export function mergeFileHints(profiles: LanguageProfile[]): MergedFileHints {
  const codeExts = new Set<string>();
  const configNames = new Set<string>();
  const configPatterns: RegExp[] = [];
  const testFilePatterns: RegExp[] = [];
  const testDirPatterns: RegExp[] = [];

  for (const p of profiles) {
    for (const ext of p.codeExtensions) codeExts.add(ext);
    if (p.configFileNames) for (const n of p.configFileNames) configNames.add(n);
    if (p.configFilePatterns) configPatterns.push(...p.configFilePatterns);
    if (p.testFilePatterns) testFilePatterns.push(...p.testFilePatterns);
    if (p.testDirPatterns) testDirPatterns.push(...p.testDirPatterns);
  }

  return {
    codeExtensions: codeExts,
    configFileNames: configNames,
    configFilePatterns: configPatterns,
    testFilePatterns,
    testDirPatterns,
  };
}

/**
 * Find the profile that owns a file extension.
 * Returns the first profile whose codeExtensions contains the extension.
 */
export function findProfileForExtension(
  ext: string,
  profiles: LanguageProfile[],
): LanguageProfile | undefined {
  return profiles.find((p) => p.codeExtensions.has(ext.toLowerCase()));
}
