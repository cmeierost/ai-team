import type { Entity, Relationship } from '@aspect/contracts';
import postcss, { type Root } from 'postcss';
import postcssSCSS from 'postcss-scss';

export interface ParseResult {
  entities: Entity[];
  relationships: Relationship[];
}

/**
 * Parse a CSS/SCSS/LESS stylesheet and extract entities and relationships.
 */
export function parseStylesheet(
  filePath: string,
  content: string,
  relativePath: string,
): ParseResult {
  const isScss = filePath.endsWith('.scss');
  const syntax = isScss ? postcssSCSS : undefined;

  let root: Root;
  try {
    root = postcss().process(content, { syntax, from: filePath }).root;
  } catch {
    // If parsing fails, return just the file entity
    return {
      entities: [createFileEntity(relativePath, content)],
      relationships: [],
    };
  }

  const entities: Entity[] = [];
  const relationships: Relationship[] = [];

  const fileEntity = createFileEntity(relativePath, content);
  entities.push(fileEntity);

  root.walk((node) => {
    if (node.type === 'rule') {
      const selector = node.selector;
      const startLine = node.source?.start?.line ?? 1;
      const endLine = node.source?.end?.line ?? startLine;
      const startColumn = (node.source?.start?.column ?? 1) - 1;
      const endColumn = (node.source?.end?.column ?? 1) - 1;

      const entityId = `css-rule:${relativePath}:${selector}:${startLine}`;
      const entity: Entity = {
        id: entityId,
        kind: 'selector-rule',
        name: selector,
        filePath: relativePath,
        sourceRange: { startLine, startColumn, endLine, endColumn },
        parentEntityId: fileEntity.id,
        childEntityIds: [],
        entityDepth: 1,
        hierarchyKind: 'member',
        classification: cssClassification(),
      };
      entities.push(entity);
      fileEntity.childEntityIds.push(entityId);

      relationships.push({
        sourceEntityId: fileEntity.id,
        targetEntityId: entityId,
        kind: 'contain',
        sourceFilePath: relativePath,
        targetFilePath: relativePath,
        sourceRange: { startLine, startColumn, endLine, endColumn },
        resolutionKind: 'resolved',
        targetClassification: 'unknown',
        targetIsAbstraction: false,
        crossModule: false,
        crossPackage: false,
        thirdParty: false,
        typeOnly: false,
        dynamic: false,
      });

      // Scan declaration values inside this rule for var() references
      node.walkDecls((decl) => {
        extractVarReferences(decl.value, decl.source?.start?.line ?? startLine, relativePath, entityId, relationships);
        extractUrlReferences(decl.value, decl.source?.start?.line ?? startLine, relativePath, entityId, relationships);
      });
    }

    if (node.type === 'decl') {
      const prop = node.prop;
      if (prop.startsWith('--')) {
        const startLine = node.source?.start?.line ?? 1;
        const endLine = node.source?.end?.line ?? startLine;
        const startColumn = (node.source?.start?.column ?? 1) - 1;
        const endColumn = (node.source?.end?.column ?? 1) - 1;

        const entityId = `css-var:${relativePath}:${prop}`;

        // Avoid duplicate custom property entities (same name declared multiple times)
        if (!entities.some((e) => e.id === entityId)) {
          const entity: Entity = {
            id: entityId,
            kind: 'custom-property',
            name: prop,
            filePath: relativePath,
            sourceRange: { startLine, startColumn, endLine, endColumn },
            parentEntityId: fileEntity.id,
            childEntityIds: [],
            entityDepth: 1,
            hierarchyKind: 'member',
            classification: cssClassification(),
          };
          entities.push(entity);
          fileEntity.childEntityIds.push(entityId);

          relationships.push({
            sourceEntityId: fileEntity.id,
            targetEntityId: entityId,
            kind: 'contain',
            sourceFilePath: relativePath,
            targetFilePath: relativePath,
            sourceRange: { startLine, startColumn, endLine, endColumn },
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
      }

      // For top-level declarations (e.g. inside :root), also scan for var()/url()
      if (node.parent?.type === 'root') {
        extractVarReferences(node.value, node.source?.start?.line ?? 1, relativePath, fileEntity.id, relationships);
        extractUrlReferences(node.value, node.source?.start?.line ?? 1, relativePath, fileEntity.id, relationships);
      }
    }

    if (node.type === 'atrule') {
      const startLine = node.source?.start?.line ?? 1;
      const endLine = node.source?.end?.line ?? startLine;
      const startColumn = (node.source?.start?.column ?? 1) - 1;
      const endColumn = (node.source?.end?.column ?? 1) - 1;

      if (node.name === 'keyframes' || node.name === '-webkit-keyframes') {
        const animName = node.params.trim();
        const entityId = `css-keyframes:${relativePath}:${animName}`;
        const entity: Entity = {
          id: entityId,
          kind: 'keyframes',
          name: animName,
          filePath: relativePath,
          sourceRange: { startLine, startColumn, endLine, endColumn },
          parentEntityId: fileEntity.id,
          childEntityIds: [],
          entityDepth: 1,
          hierarchyKind: 'member',
          classification: cssClassification(),
        };
        entities.push(entity);
        fileEntity.childEntityIds.push(entityId);

        relationships.push({
          sourceEntityId: fileEntity.id,
          targetEntityId: entityId,
          kind: 'contain',
          sourceFilePath: relativePath,
          targetFilePath: relativePath,
          sourceRange: { startLine, startColumn, endLine, endColumn },
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

      if (node.name === 'mixin') {
        const mixinName = node.params.split('(')[0].trim();
        const entityId = `css-mixin:${relativePath}:${mixinName}`;
        const entity: Entity = {
          id: entityId,
          kind: 'mixin',
          name: mixinName,
          filePath: relativePath,
          sourceRange: { startLine, startColumn, endLine, endColumn },
          parentEntityId: fileEntity.id,
          childEntityIds: [],
          entityDepth: 1,
          hierarchyKind: 'member',
          classification: cssClassification(),
        };
        entities.push(entity);
        fileEntity.childEntityIds.push(entityId);

        relationships.push({
          sourceEntityId: fileEntity.id,
          targetEntityId: entityId,
          kind: 'contain',
          sourceFilePath: relativePath,
          targetFilePath: relativePath,
          sourceRange: { startLine, startColumn, endLine, endColumn },
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

      if (node.name === 'import' || node.name === 'use') {
        const target = extractImportTarget(node.params);
        relationships.push({
          sourceEntityId: fileEntity.id,
          targetEntityId: target ? `file:${target}` : null,
          kind: 'import',
          sourceFilePath: relativePath,
          targetFilePath: target ?? null,
          sourceRange: { startLine, startColumn, endLine, endColumn },
          resolutionKind: target ? 'proxy' : 'unresolved',
          targetClassification: 'unknown',
          targetIsAbstraction: false,
          crossModule: true,
          crossPackage: false,
          thirdParty: false,
          typeOnly: false,
          dynamic: false,
        });
      }
    }
  });

  return { entities, relationships };
}

function createFileEntity(relativePath: string, content: string): Entity {
  const lines = content.split('\n');
  return {
    id: `file:${relativePath}`,
    kind: 'file',
    name: relativePath.split('/').pop() ?? relativePath,
    filePath: relativePath,
    sourceRange: {
      startLine: 1,
      startColumn: 0,
      endLine: lines.length,
      endColumn: (lines[lines.length - 1]?.length ?? 0),
    },
    parentEntityId: null,
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    classification: {
      isAbstract: false,
      isInterface: false,
      isConcrete: true,
      isTypeOnly: false,
      isExported: true,
      visibility: null,
    },
  };
}

function cssClassification(): Entity['classification'] {
  return {
    isAbstract: false,
    isInterface: false,
    isConcrete: true,
    isTypeOnly: false,
    isExported: true,
    visibility: null,
  };
}

function extractImportTarget(params: string): string | null {
  // Handle: @import "file.css"; @import url("file.css"); @use "module";
  const match = params.match(/(?:url\(\s*)?['"]([^'"]+)['"]\s*\)?/);
  return match?.[1] ?? null;
}

const VAR_REGEX = /var\(\s*(--[\w-]+)\s*(?:,\s*[^)]+)?\)/g;

function extractVarReferences(
  value: string,
  line: number,
  relativePath: string,
  sourceEntityId: string,
  relationships: Relationship[],
): void {
  let match: RegExpExecArray | null;
  VAR_REGEX.lastIndex = 0;
  while ((match = VAR_REGEX.exec(value)) !== null) {
    const varName = match[1];
    relationships.push({
      sourceEntityId,
      targetEntityId: `css-var:${relativePath}:${varName}`,
      kind: 'use',
      sourceFilePath: relativePath,
      targetFilePath: relativePath,
      sourceRange: { startLine: line, startColumn: 0, endLine: line, endColumn: 0 },
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
}

const URL_REGEX = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;

function extractUrlReferences(
  value: string,
  line: number,
  relativePath: string,
  sourceEntityId: string,
  relationships: Relationship[],
): void {
  let match: RegExpExecArray | null;
  URL_REGEX.lastIndex = 0;
  while ((match = URL_REGEX.exec(value)) !== null) {
    const urlTarget = match[1].trim();
    // Skip data URIs and absolute URLs
    if (urlTarget.startsWith('data:') || urlTarget.startsWith('http://') || urlTarget.startsWith('https://')) {
      continue;
    }
    const isResolved = !urlTarget.startsWith('#');
    relationships.push({
      sourceEntityId,
      targetEntityId: isResolved ? `file:${urlTarget}` : null,
      kind: 'reference',
      sourceFilePath: relativePath,
      targetFilePath: isResolved ? urlTarget : null,
      sourceRange: { startLine: line, startColumn: 0, endLine: line, endColumn: 0 },
      resolutionKind: isResolved ? 'proxy' : 'unresolved',
      targetClassification: 'unknown',
      targetIsAbstraction: false,
      crossModule: false,
      crossPackage: false,
      thirdParty: false,
      typeOnly: false,
      dynamic: false,
    });
  }
}
