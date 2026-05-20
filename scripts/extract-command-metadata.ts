/**
 * Codemod: extract-command-metadata
 *
 * ── Phase 1 (default) ──────────────────────────────────────────────────────
 * For every class that `implements ICommand<` in packages/service/src/commands/**:
 *   1. Extracts all metadata fields into:
 *        export const <ClassName>Metadata = { … } satisfies Omit<ICommand, …>;
 *   2. Extracts the `static readonly schema` initializer to a local const so the
 *      metadata const can reference it without a forward dependency.
 *   3. Adds `static readonly metadata = <ClassName>Metadata` and
 *      `readonly metadata = <ClassName>Metadata` to the class.
 *   4. Adds a declaration-merge block so the class still satisfies the current
 *      (flat) ICommand interface while we transition.
 *   5. Removes individual instance metadata properties from the class body.
 *
 * ── Phase 2a  --fix-callsites ──────────────────────────────────────────────
 * Run BEFORE --update-core.  Rewrites `receiver.propName` → `receiver.metadata.propName`
 * everywhere the receiver is typed as ICommand (or a class implementing it).
 *
 * ── Phase 2b  --update-core ────────────────────────────────────────────────
 * Edits packages/core/src/types/command-types.ts:
 *   - Promotes `ICommandDescriptor` to the metadata shape (adds `key` + `aliases`,
 *     removes `formatForLlm`).
 *   - Simplifies `ICommand` to `{ readonly metadata: ICommandDescriptor, matchesIntent?,
 *     formatForLlm?, execute }`.
 *
 * ── Phase 2c  --cleanup-merges ─────────────────────────────────────────────
 * Run AFTER --update-core.  Removes declaration-merge scaffolding from already-
 * transformed command files and changes `satisfies Omit<ICommand, …>` →
 * `satisfies ICommandDescriptor`.
 *
 * ── Recommended migration order ────────────────────────────────────────────
 *   1.  pnpm dlx tsx scripts/extract-command-metadata.ts
 *       # (Phase 1: transforms all command files)
 *   2.  pnpm dlx tsx scripts/extract-command-metadata.ts --fix-callsites
 *       # (Phase 2a: updates callsites while ICommand still has flat fields)
 *   3.  pnpm dlx tsx scripts/extract-command-metadata.ts --update-core --cleanup-merges
 *       # (Phase 2b+2c: promotes ICommandDescriptor, simplifies ICommand, cleans up files)
 *   4.  pnpm --filter @ai-team/service build  # verify
 *
 * ── Flags ───────────────────────────────────────────────────────────────────
 *   --dry-run        Print Prettier-formatted output; write nothing.
 *   --file <path>    Only process a single file (Phase 1 only).
 *   --fix-callsites  Phase 2a.
 *   --update-core    Phase 2b.
 *   --cleanup-merges Phase 2c.
 */

import { Project, SourceFile, ClassDeclaration, SyntaxKind, Node, Type } from 'ts-morph';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import * as prettier from 'prettier';

// ── Config ────────────────────────────────────────────────────────────────────

/** All fields from ICommandDescriptor + ICommand that count as "metadata". */
const METADATA_FIELDS = new Set([
  'key',
  'aliases',
  'description',
  'summary',
  'availableIn',
  'group',
  'cli',
  'path',
  'usage',
  'help',
  'llm',
  'input',
  'workflowInputBindings',
  'permissionCheck',
  'examples',
  'tags',
  'intents',
  'intentExamples',
  'parameters',
]);

const DRY_RUN = process.argv.includes('--dry-run');

// --file <relative-or-absolute-path>  →  only process that one file
const fileArgIdx = process.argv.indexOf('--file');
const targetFile =
  fileArgIdx === -1 ? null : path.resolve(process.cwd(), process.argv[fileArgIdx + 1]);

// ── Phase 2 flags ─────────────────────────────────────────────────────────────
/**
 * --update-core   : Promotes ICommandDescriptor to the metadata shape and simplifies ICommand.
 * --cleanup-merges: Removes interface-merge blocks from already-transformed command files,
 *                   changes `satisfies Omit<ICommand, …>` → `satisfies ICommandDescriptor`.
 * --fix-callsites : Replaces `cmd.key` / `cmd.description` etc. → `cmd.metadata.*`
 *                   for every variable typed as ICommand (or a class implementing it).
 *
 * Recommended run order:
 *   1. (no flags)         — Phase 1: transform all command files
 *   2. --fix-callsites    — fix callsites while ICommand still exposes the flat fields
 *   3. --update-core      — promote ICommandDescriptor, simplify ICommand
 *   4. --cleanup-merges   — remove interface-merge scaffolding from command files
 */
const UPDATE_CORE = process.argv.includes('--update-core');
const CLEANUP_MERGES = process.argv.includes('--cleanup-merges');
const FIX_CALLSITES = process.argv.includes('--fix-callsites');

// ── Setup ─────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const project = new Project({ skipAddingFilesFromTsConfig: true });

if (targetFile) {
  project.addSourceFileAtPath(targetFile);
} else {
  project.addSourceFilesAtPaths(
    path.posix.join(root.replaceAll('\\', '/'), 'packages/service/src/commands/**/*.ts')
  );
}

// ── Main loop ─────────────────────────────────────────────────────────────────

let modifiedCount = 0;
let alreadyDoneCount = 0;
const modifiedPaths: string[] = [];

void (async () => {
  await runPhase1();
  if (FIX_CALLSITES) await runCallsiteFixer();
  if (UPDATE_CORE) await runCoreUpdate();
  if (CLEANUP_MERGES) await runMergeCleanup();
})().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

// ── Phase 1: transform command files ─────────────────────────────────────────

async function runPhase1(): Promise<void> {
  for (const sf of project.getSourceFiles()) {
    const filePath = sf.getFilePath();
    if (filePath.includes('.test.') || filePath.includes('.spec.')) continue;
    if (!sf.getFullText().includes('implements ICommand<')) continue;

    const result = transformFile(sf);
    if (result === 'modified') {
      modifiedCount++;
      modifiedPaths.push(filePath);
      if (DRY_RUN) {
        const prettierConfig = await prettier.resolveConfig(filePath);
        const formatted = await prettier.format(sf.getFullText(), {
          ...prettierConfig,
          filepath: filePath,
        });
        const separator = '─'.repeat(72);
        console.log(`\n${separator}`);
        console.log(`// ${path.relative(root, filePath)}`);
        console.log(separator);
        console.log(formatted);
      } else {
        console.log(`OK  ${path.relative(root, filePath)}`);
      }
    }
  }

  if (DRY_RUN) {
    console.log(
      `\n[dry-run] Would modify ${modifiedCount} file(s). ${alreadyDoneCount} already had static metadata. No files written.`
    );
  } else {
    await project.save();
    if (modifiedPaths.length > 0) {
      const quotedPaths = modifiedPaths.map((p) => `"${p}"`).join(' ');
      execSync(`pnpm exec prettier --write ${quotedPaths}`, {
        cwd: root,
        stdio: 'inherit',
      });
    }
    console.log(
      `\nDone -- modified ${modifiedCount} file(s). ${alreadyDoneCount} already had static metadata.`
    );
  }
}

// ── File transformer ──────────────────────────────────────────────────────────

function transformFile(sf: SourceFile): 'modified' | 'unchanged' {
  // Collect class names before any mutations so indices stay stable.
  const classNames = sf
    .getClasses()
    .filter((cls) =>
      cls.getImplements().some((impl) => impl.getExpression().getText().startsWith('ICommand'))
    )
    .map((cls) => cls.getName())
    .filter((n): n is string => Boolean(n));

  if (classNames.length === 0) return 'unchanged';

  let changed = false;

  // Process in reverse document order so insertions above later classes
  // don't disturb the positions of earlier ones.
  for (const name of [...classNames].reverse()) {
    if (processClass(name, sf)) changed = true;
  }

  if (!changed) return 'unchanged';

  return 'modified';
}

// ── Class transformer ─────────────────────────────────────────────────────────

function buildInsertBlock(
  cls: ClassDeclaration,
  className: string,
  metaProps: ReturnType<ClassDeclaration['getProperties']>
): { insertBlock: string; metaConstName: string; schemaVar: string | null } {
  const schemaProp = cls.getStaticProperty('schema');
  const schemaInitText =
    schemaProp && 'getInitializer' in schemaProp
      ? (schemaProp as any).getInitializer()?.getText()
      : undefined;
  const schemaVar = schemaInitText ? `_${lowerFirst(className)}Schema` : null;

  const entries = metaProps.map((prop) => {
    let val = (prop as any).getInitializer()?.getText() ?? 'undefined';
    if (schemaVar) {
      val = val.replace(
        new RegExp(String.raw`\b${escapeRegex(className)}\.schema\b`, 'g'),
        schemaVar
      );
    }
    return `  ${prop.getName()}: ${val}`;
  });

  const metaConstName = `${className}Metadata`;
  const schemaPart =
    schemaVar && schemaInitText ? `const ${schemaVar} = ${schemaInitText};\n\n` : '';
  const metaPart = [
    `export const ${metaConstName} = {`,
    ...entries.map((e) => `${e},`),
    `} satisfies Omit<ICommand, 'execute' | 'matchesIntent'>;`,
    '',
    `// Declare-merge: satisfies ICommand without repeating each field on the class.`,
    `// When ICommand is refactored to use a \`metadata\` property, remove this merge.`,
    `type _${className}Meta = typeof ${metaConstName};`,
    `export interface ${className} extends _${className}Meta {}`,
    '',
    '',
  ].join('\n');

  return { insertBlock: schemaPart + metaPart, metaConstName, schemaVar };
}

function applyMutation(
  sf: SourceFile,
  className: string,
  insertBlock: string,
  metaConstName: string,
  schemaVar: string | null
): void {
  sf.insertStatements(
    sf
      .getStatements()
      .findIndex(
        (s) =>
          s.getKind() === SyntaxKind.ClassDeclaration &&
          (s as ClassDeclaration).getName() === className
      ),
    insertBlock
  );

  const updated = sf.getClasses().find((c) => c.getName() === className);
  if (!updated) return;

  if (schemaVar) {
    (updated.getStaticProperty('schema') as any)?.setInitializer(schemaVar);
  }

  const schemaMember = updated.getStaticProperty('schema');
  const insertIdx = schemaMember ? updated.getMembers().indexOf(schemaMember as any) + 1 : 0;

  updated.insertMember(insertIdx, `static readonly metadata = ${metaConstName};`);
  updated.insertMember(insertIdx + 1, `readonly metadata = ${metaConstName};`);

  // Remove individual instance metadata properties — satisfied via interface merge.
  for (const prop of [
    ...updated.getProperties().filter((p) => !p.isStatic() && METADATA_FIELDS.has(p.getName())),
  ].reverse()) {
    prop.remove();
  }
}

function processClass(className: string, sf: SourceFile): boolean {
  const cls = sf.getClasses().find((c) => c.getName() === className);
  if (!cls) return false;

  // Skip if already transformed.
  if (cls.getStaticMembers().some((m) => 'getName' in m && (m as any).getName() === 'metadata')) {
    alreadyDoneCount++;
    console.log(`   skip ${className} -- static metadata already present`);
    return false;
  }

  const metaProps = cls
    .getProperties()
    .filter((p) => !p.isStatic() && METADATA_FIELDS.has(p.getName()));

  if (metaProps.length === 0) return false;

  const { insertBlock, metaConstName, schemaVar } = buildInsertBlock(cls, className, metaProps);

  const clsIdx = sf
    .getStatements()
    .findIndex(
      (s) =>
        s.getKind() === SyntaxKind.ClassDeclaration &&
        (s as ClassDeclaration).getName() === className
    );

  if (clsIdx === -1) {
    console.warn(`   [warn] ${className} not found as top-level statement -- skipping`);
    return false;
  }

  applyMutation(sf, className, insertBlock, metaConstName, schemaVar);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

/** Apply all merge-cleanup transformations to a command file's source text. */
function applyMergeCleanup(text: string): string {
  // 1. Remove the Declare-merge comment + type alias + interface declaration.
  const mergeBlockRe =
    /\n\/\/ Declare-merge:[^\n]*\n\/\/ When ICommand[^\n]*\ntype _\w+Meta = typeof \w+Metadata;\nexport interface \w+ extends _\w+Meta \{\}\n/g;
  let out = text.replace(mergeBlockRe, '\n');

  // 2. Change satisfies type (ICommandDescriptor is already imported from @ai-team/core).
  out = out.replaceAll(
    "} satisfies Omit<ICommand, 'execute' | 'matchesIntent'>;",
    '} satisfies ICommandDescriptor;'
  );

  return out;
}

// ── Phase 2a: update core types ───────────────────────────────────────────────
/**
 * --update-core
 *
 * Edits packages/core/src/types/command-types.ts:
 *   - Adds `key` + `aliases` to `ICommandDescriptor` (it becomes the metadata shape).
 *   - Removes `formatForLlm` from `ICommandDescriptor` (moves to `ICommand`).
 *   - Simplifies `ICommand` to `{ readonly metadata: ICommandDescriptor, matchesIntent?,
 *     formatForLlm?, execute }`.
 */
async function runCoreUpdate(): Promise<void> {
  console.log('\n── Phase 2a: update-core ───────────────────────────────────────────────────\n');

  const coreTypesPath = path.join(root, 'packages/core/src/types/command-types.ts');
  const coreProject = new Project({ skipAddingFilesFromTsConfig: true });
  coreProject.addSourceFilesAtPaths([coreTypesPath]);

  const typesSf = coreProject.getSourceFileOrThrow(coreTypesPath);
  if (!typesSf.getInterface('ICommandDescriptor') || !typesSf.getInterface('ICommand')) {
    console.error('[update-core] Could not find ICommandDescriptor or ICommand — aborting.');
    return;
  }

  updateDescriptorToMetadataShape(typesSf);
  simplifyICommand(typesSf);

  if (DRY_RUN) {
    await printDryRunFile(typesSf.getFilePath(), typesSf.getFullText());
    console.log('[dry-run] update-core: no files written.');
  } else {
    await coreProject.save();
    execSync(`pnpm exec prettier --write "${coreTypesPath}"`, { cwd: root, stdio: 'inherit' });
    console.log('update-core: done.');
  }
}

/** Add `key` + `aliases` to ICommandDescriptor and move `formatForLlm` to ICommand. */
function updateDescriptorToMetadataShape(sf: SourceFile): void {
  const desc = sf.getInterfaceOrThrow('ICommandDescriptor');

  // Skip if already migrated.
  if (desc.getProperty('key')) return;

  // Remove formatForLlm from ICommandDescriptor (it moves to ICommand).
  const fmtMember = desc.getMembers().find(
    (m) => 'getName' in m && (m as { getName(): string }).getName() === 'formatForLlm'
  );
  fmtMember?.remove();

  // Add key + aliases as the first two fields.
  desc.insertProperty(0, { name: 'aliases', type: 'string[]', isReadonly: true, hasQuestionToken: true });
  desc.insertProperty(0, {
    name: 'key',
    type: 'string',
    isReadonly: true,
    docs: ['Canonical dispatch key (e.g. "ask", "files-tree").'],
  });
}

function simplifyICommand(sf: SourceFile): void {
  const iCmd = sf.getInterfaceOrThrow('ICommand');

  // Skip if already migrated.
  if (iCmd.getProperty('metadata')) return;

  while (iCmd.getExtends().length > 0) iCmd.removeExtends(0);

  for (const member of iCmd.getMembers()) {
    const name = 'getName' in member ? (member as { getName(): string }).getName() : null;
    if (name === 'key' || name === 'aliases') member.remove();
  }

  // Add formatForLlm (moved from ICommandDescriptor).
  iCmd.addMethod({
    name: 'formatForLlm',
    parameters: [{ name: 'result', type: 'TResult' }],
    returnType: 'unknown',
    hasQuestionToken: true,
  });

  iCmd.insertProperty(0, {
    name: 'metadata',
    type: 'ICommandDescriptor<TParams>',
    isReadonly: true,
    hasQuestionToken: false,
  });
}

async function printDryRunFile(fp: string, text: string): Promise<void> {
  const separator = '─'.repeat(72);
  const prettierConfig = await prettier.resolveConfig(fp);
  const formatted = await prettier.format(text, { ...prettierConfig, filepath: fp });
  console.log(`\n${separator}`);
  console.log(`// ${path.relative(root, fp)}`);
  console.log(separator);
  console.log(formatted);
}

// ── Phase 2b: fix callsites ───────────────────────────────────────────────────
/**
 * --fix-callsites
 *
 * Loads all source files in packages/{service,cli,api-server,vscode} (plus core
 * for type resolution) and rewrites every property access of the form
 *   `receiver.propName`
 * where `propName` ∈ METADATA_FIELDS AND the receiver's static type is ICommand
 * (or a class that implements ICommand) to
 *   `receiver.metadata.propName`
 *
 * Run BEFORE --update-core so the type-checker still sees the full flat ICommand
 * surface and can correctly identify ICommand-typed receivers.
 */
async function runCallsiteFixer(): Promise<void> {
  console.log('\n── Phase 2b: fix-callsites ─────────────────────────────────────────────────\n');

  const typeProject = new Project({ skipAddingFilesFromTsConfig: true });
  const rootPosix = root.replaceAll('\\', '/');
  for (const pkg of ['service', 'cli', 'api-server', 'vscode', 'core', 'api-contracts']) {
    typeProject.addSourceFilesAtPaths(`${rootPosix}/packages/${pkg}/src/**/*.ts`);
  }

  const csModifiedPaths: string[] = [];
  let csModifiedCount = 0;

  for (const sf of typeProject.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (fp.includes('.test.') || fp.includes('.spec.')) continue;

    // Quick check: does this file access any metadata field at all?
    const text = sf.getFullText();
    const hasCandidate = [...METADATA_FIELDS].some((f) => text.includes(`.${f}`));
    if (!hasCandidate) continue;

    const changed = fixCallsitesInFile(sf);
    if (!changed) continue;

    csModifiedCount++;
    csModifiedPaths.push(fp);

    if (DRY_RUN) {
      const prettierConfig = await prettier.resolveConfig(fp);
      const formatted = await prettier.format(sf.getFullText(), {
        ...prettierConfig,
        filepath: fp,
      });
      const separator = '─'.repeat(72);
      console.log(`\n${separator}`);
      console.log(`// ${path.relative(root, fp)}`);
      console.log(separator);
      console.log(formatted);
    } else {
      console.log(`OK  ${path.relative(root, fp)}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] fix-callsites: would modify ${csModifiedCount} file(s).`);
  } else {
    await typeProject.save();
    if (csModifiedPaths.length > 0) {
      const quotedPaths = csModifiedPaths.map((p) => `"${p}"`).join(' ');
      execSync(`pnpm exec prettier --write ${quotedPaths}`, { cwd: root, stdio: 'inherit' });
    }
    console.log(`\nfix-callsites: modified ${csModifiedCount} file(s).`);
  }
}

function fixCallsitesInFile(sf: SourceFile): boolean {
  // Collect candidates in reverse order so replacements don't shift positions.
  const candidates = sf
    .getDescendantsOfKind(SyntaxKind.PropertyAccessExpression)
    .filter((pa) => {
      const name = pa.getName();
      if (!METADATA_FIELDS.has(name)) return false;
      // Already `x.metadata.propName` → skip.
      const expr = pa.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) return true;
      const exprText = expr.getText();
      return !exprText.endsWith('.metadata');
    })
    .reverse();

  let changed = false;

  for (const pa of candidates) {
    const receiver = pa.getExpression();

    // Skip assignment LHS: `x.key = '...'`
    const parent = pa.getParentOrThrow();
    const binaryParent = parent.asKind(SyntaxKind.BinaryExpression);
    if (binaryParent?.getOperatorToken().getText() === '=') {
      continue;
    }

    try {
      const receiverType = receiver.getType();
      if (!isICommandLike(receiverType)) continue;

      pa.replaceWithText(`${receiver.getText()}.metadata.${pa.getName()}`);
      changed = true;
    } catch {
      // Type checker unavailable for this node — skip safely.
    }
  }

  return changed;
}

function isICommandLike(type: Type): boolean {
  try {
    const sym = type.getSymbol();
    if (sym?.getName() === 'ICommand') return true;

    // A class that `implements ICommand<…>` in its source text.
    if (sym) {
      for (const decl of sym.getDeclarations()) {
        if (
          Node.isClassDeclaration(decl) &&
          decl.getImplements().some((i) => i.getExpression().getText().startsWith('ICommand'))
        ) {
          return true;
        }
      }
    }

    // Union: treat as ICommand if any member is.
    if (type.isUnion()) return type.getUnionTypes().some(isICommandLike);
  } catch {
    // ignore type checker errors
  }
  return false;
}

// ── Phase 2c: cleanup interface merges ───────────────────────────────────────
/**
 * --cleanup-merges
 *
 * Run AFTER --update-core.  For every already-transformed command file that
 * still contains the interface-merge scaffolding:
 *
 *   type _XMeta = typeof XMetadata;
 *   export interface X extends _XMeta {}
 *
 * this phase:
 *   1. Removes those two declarations.
 *   2. Changes `satisfies Omit<ICommand, 'execute' | 'matchesIntent'>` →
 *      `satisfies ICommandMeta`.
 *   3. Adds `ICommandMeta` to the `@ai-team/core` import.
 */
async function runMergeCleanup(): Promise<void> {
  console.log('\n── Phase 2c: cleanup-merges ────────────────────────────────────────────────\n');

  const cleanProject = new Project({ skipAddingFilesFromTsConfig: true });
  cleanProject.addSourceFilesAtPaths(
    path.posix.join(root.replaceAll('\\', '/'), 'packages/service/src/commands/**/*.ts')
  );

  const cleanModifiedPaths: string[] = [];
  let cleanModifiedCount = 0;

  for (const sf of cleanProject.getSourceFiles()) {
    const fp = sf.getFilePath();
    if (fp.includes('.test.') || fp.includes('.spec.')) continue;

    const original = sf.getFullText();
    if (!original.includes('satisfies Omit<ICommand,')) continue;

    const cleaned = applyMergeCleanup(original);
    if (cleaned === original) continue;

    sf.replaceWithText(cleaned);
    cleanModifiedCount++;
    cleanModifiedPaths.push(fp);

    if (DRY_RUN) {
      await printDryRunFile(fp, sf.getFullText());
    } else {
      console.log(`OK  ${path.relative(root, fp)}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n[dry-run] cleanup-merges: would modify ${cleanModifiedCount} file(s).`);
  } else {
    await cleanProject.save();
    if (cleanModifiedPaths.length > 0) {
      const quotedPaths = cleanModifiedPaths.map((p) => `"${p}"`).join(' ');
      execSync(`pnpm exec prettier --write ${quotedPaths}`, { cwd: root, stdio: 'inherit' });
    }
    console.log(`\ncleanup-merges: modified ${cleanModifiedCount} file(s).`);
  }
}
