/**
 * Codemod: extract-command-metadata
 *
 * For every class that `implements ICommand<` in packages/service/src/commands/**:
 *   1. Extracts all ICommandDescriptor metadata fields into a standalone
 *      `export const <ClassName>Metadata = { ... } satisfies ICommandDescriptor`
 *      placed directly above the class.
 *   2. If the class has a `static readonly schema`, that schema initializer is
 *      also extracted to a plain `const _<className>Schema` placed above the
 *      metadata const (avoiding forward-reference issues).
 *   3. Adds `static readonly metadata = <ClassName>Metadata` to the class.
 *   4. Updates every instance metadata property to delegate to the const:
 *        readonly key = <ClassName>Metadata.key;
 *   5. Adds `ICommandDescriptor` to the existing `@ai-team/core` import if missing.
 *
 * Usage (from workspace root):
 *   pnpm dlx tsx scripts/extract-command-metadata.ts
 *   pnpm dlx tsx scripts/extract-command-metadata.ts --dry-run
 *   pnpm dlx tsx scripts/extract-command-metadata.ts --file packages/service/src/commands/com/ask.command.ts
 *   pnpm dlx tsx scripts/extract-command-metadata.ts --file packages/service/src/commands/com/ask.command.ts --dry-run
 */

import { Project, SourceFile, ClassDeclaration, SyntaxKind } from 'ts-morph';
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
})().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});

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

  // Delegate instance metadata properties to the const.
  for (const prop of updated
    .getProperties()
    .filter((p) => !p.isStatic() && METADATA_FIELDS.has(p.getName()))) {
    (prop as any).setInitializer(`${metaConstName}.${prop.getName()}`);
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
