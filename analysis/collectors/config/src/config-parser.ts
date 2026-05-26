/**
 * Config file parser — extracts entities and relationships from config files
 * (package.json, tsconfig.json, eslint configs, etc.)
 *
 * Config files are tooling artifacts, not runtime code. The goal is to capture:
 * - Which packages a project depends on (dependency relationships)
 * - Config inheritance chains (extends/references)
 * - Script definitions (build/test/lint commands)
 */

import type { Entity, Relationship, SourceRange } from '@aspect/contracts';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ConfigParseResult {
  entities: Entity[];
  relationships: Relationship[];
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

interface TsConfig {
  extends?: string | string[];
  references?: Array<{ path: string }>;
  compilerOptions?: Record<string, unknown>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeRange(line: number): SourceRange {
  return { startLine: line, startColumn: 1, endLine: line, endColumn: 1 };
}

const DEFAULT_CLASSIFICATION: Entity['classification'] = {
  isAbstract: false,
  isInterface: false,
  isConcrete: true,
  isTypeOnly: false,
  isExported: false,
  visibility: null,
};

function makeFileEntity(relativePath: string, totalLines: number): Entity {
  return {
    id: `file:${relativePath}`,
    kind: 'file',
    name: relativePath.split('/').pop() ?? relativePath,
    filePath: relativePath,
    sourceRange: { startLine: 1, startColumn: 1, endLine: totalLines, endColumn: 1 },
    classification: { ...DEFAULT_CLASSIFICATION },
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    role: 'infrastructure',
  };
}

function makeRelationship(
  sourceEntityId: string,
  targetEntityId: string | null,
  kind: Relationship['kind'],
  sourceFilePath: string,
  targetFilePath: string | null,
  line: number,
  opts?: { thirdParty?: boolean; resolutionKind?: Relationship['resolutionKind'] },
): Relationship {
  return {
    sourceEntityId,
    targetEntityId,
    kind,
    sourceFilePath,
    targetFilePath: targetFilePath ?? null,
    sourceRange: makeRange(line),
    targetRange: null,
    resolutionKind: opts?.resolutionKind ?? (targetEntityId ? 'resolved' : 'unresolved'),
    targetClassification: 'unknown',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: true,
    thirdParty: opts?.thirdParty ?? false,
    typeOnly: false,
    dynamic: false,
  };
}

// ── Parsers ─────────────────────────────────────────────────────────────────

/**
 * Parse a package.json file. Extracts:
 * - The file entity
 * - Dependency references (all dep groups → third-party references)
 * - Script entries as child "field" entities
 */
export function parsePackageJson(content: string, relativePath: string): ConfigParseResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const fileEntity = makeFileEntity(relativePath, totalLines);
  const fileId = fileEntity.id;

  const entities: Entity[] = [fileEntity];
  const relationships: Relationship[] = [];

  let pkg: PackageJson;
  try {
    pkg = JSON.parse(content) as PackageJson;
  } catch {
    return { entities, relationships };
  }

  // Extract dependency references
  const depGroups: Array<[string, Record<string, string> | undefined]> = [
    ['dependencies', pkg.dependencies],
    ['devDependencies', pkg.devDependencies],
    ['peerDependencies', pkg.peerDependencies],
    ['optionalDependencies', pkg.optionalDependencies],
  ];

  for (const [groupName, deps] of depGroups) {
    if (!deps) continue;
    const groupLine = findJsonKey(lines, groupName);

    for (const depName of Object.keys(deps)) {
      const depLine = findJsonKey(lines, depName, groupLine);
      const isWorkspace = deps[depName]?.startsWith('workspace:');

      relationships.push(makeRelationship(
        fileId,
        isWorkspace ? `pkg:${depName}` : null,
        'reference',
        relativePath,
        null,
        depLine,
        {
          thirdParty: !isWorkspace,
          resolutionKind: isWorkspace ? 'proxy' : 'unresolved',
        },
      ));
    }
  }

  // Extract script definitions as field entities
  if (pkg.scripts) {
    for (const scriptName of Object.keys(pkg.scripts)) {
      const scriptLine = findJsonKey(lines, scriptName);
      const scriptId = `config-field:${relativePath}:scripts.${scriptName}`;
      entities.push({
        id: scriptId,
        kind: 'field',
        name: `scripts.${scriptName}`,
        filePath: relativePath,
        sourceRange: makeRange(scriptLine),
        classification: { ...DEFAULT_CLASSIFICATION },
        parentEntityId: fileId,
        childEntityIds: [],
        entityDepth: 1,
        hierarchyKind: 'member',
        role: 'infrastructure',
      });
      relationships.push({
        sourceEntityId: fileId,
        targetEntityId: scriptId,
        kind: 'contain',
        sourceFilePath: relativePath,
        targetFilePath: relativePath,
        sourceRange: makeRange(scriptLine),
        targetRange: null,
        resolutionKind: 'resolved',
        targetClassification: 'unknown',
        targetIsAbstraction: false,
        crossModule: false,
        crossPackage: false,
        thirdParty: false,
        typeOnly: false,
        dynamic: false,
      });
    }
    fileEntity.childEntityIds = entities
      .filter(e => e.parentEntityId === fileId)
      .map(e => e.id);
    if (fileEntity.childEntityIds.length > 0) {
      fileEntity.hierarchyKind = 'container';
    }
  }

  return { entities, relationships };
}

/**
 * Parse a tsconfig.json file. Extracts:
 * - The file entity
 * - "extends" reference (config inheritance)
 * - "references" entries (project references)
 */
export function parseTsConfig(content: string, relativePath: string): ConfigParseResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const fileEntity = makeFileEntity(relativePath, totalLines);
  const fileId = fileEntity.id;

  const entities: Entity[] = [fileEntity];
  const relationships: Relationship[] = [];

  let config: TsConfig;
  try {
    // Strip comments (tsconfig supports jsonc)
    const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    config = JSON.parse(cleaned) as TsConfig;
  } catch {
    return { entities, relationships };
  }

  // extends → config inheritance
  const extendsList = Array.isArray(config.extends) ? config.extends : config.extends ? [config.extends] : [];
  for (const ext of extendsList) {
    const line = findJsonKey(lines, 'extends');
    relationships.push(makeRelationship(
      fileId,
      null,
      'extend',
      relativePath,
      ext,
      line,
      { resolutionKind: 'proxy' },
    ));
  }

  // references → project references
  if (config.references) {
    const refLine = findJsonKey(lines, 'references');
    for (const ref of config.references) {
      relationships.push(makeRelationship(
        fileId,
        null,
        'reference',
        relativePath,
        ref.path,
        refLine,
        { resolutionKind: 'proxy' },
      ));
    }
  }

  return { entities, relationships };
}

/**
 * Parse a generic JSON/YAML config file that may have an "extends" field.
 * Covers eslint, prettier, babel, jest configs, etc.
 */
export function parseGenericConfig(content: string, relativePath: string): ConfigParseResult {
  const lines = content.split('\n');
  const totalLines = lines.length;
  const fileEntity = makeFileEntity(relativePath, totalLines);
  const entities: Entity[] = [fileEntity];
  const relationships: Relationship[] = [];

  // Only attempt JSON parse for .json/.jsonc files
  if (relativePath.endsWith('.json') || relativePath.endsWith('.jsonc')) {
    try {
      const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
      const obj = JSON.parse(cleaned) as Record<string, unknown>;
      if (typeof obj.extends === 'string') {
        const line = findJsonKey(lines, 'extends');
        relationships.push(makeRelationship(
          fileEntity.id, null, 'extend', relativePath, obj.extends, line,
          { resolutionKind: 'proxy' },
        ));
      }
    } catch { /* not valid json */ }
  }

  return { entities, relationships };
}

// ── Line finder ─────────────────────────────────────────────────────────────

/** Find the 1-based line number of a JSON key in the raw text. */
function findJsonKey(lines: string[], key: string, afterLine = 0): number {
  const pattern = `"${key}"`;
  for (let i = afterLine; i < lines.length; i++) {
    if (lines[i].includes(pattern)) return i + 1;
  }
  return 1;
}
