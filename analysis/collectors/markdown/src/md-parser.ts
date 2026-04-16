import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString as mdastToString } from 'mdast-util-to-string';
import type { Root, Content, Heading, Link, Image } from 'mdast';
import type { Entity, Relationship, SourceRange } from '@aspect/contracts';

// ── Slug helper ─────────────────────────────────────────────────────────────

export function toSlug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ── Constants ───────────────────────────────────────────────────────────────

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.scss', '.less', '.sass',
  '.html', '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.py', '.rb', '.go', '.rs', '.java', '.c', '.cpp', '.h',
  '.sh', '.bash', '.zsh', '.ps1',
]);

const DOC_EXTENSIONS = new Set(['.md', '.mdx']);

const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.bmp',
]);

// ── Default classification / relationship fields ────────────────────────────

const DEFAULT_CLASSIFICATION: Entity['classification'] = {
  isAbstract: false,
  isInterface: false,
  isConcrete: true,
  isTypeOnly: false,
  isExported: false,
  visibility: null,
};

function makeRelationshipDefaults(sourceFilePath: string): Omit<
  Relationship,
  'sourceEntityId' | 'targetEntityId' | 'kind' | 'sourceRange'
> {
  return {
    sourceFilePath,
    resolutionKind: 'proxy',
    targetClassification: 'unknown',
    targetIsAbstraction: false,
    crossModule: false,
    crossPackage: false,
    thirdParty: false,
    typeOnly: false,
    dynamic: false,
  };
}

// ── Section tracking ────────────────────────────────────────────────────────

interface SectionInfo {
  entity: Entity;
  depth: number; // heading depth (1–6)
  startLine: number;
}

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseMarkdownFile(
  content: string,
  relativePath: string,
): { entities: Entity[]; relationships: Relationship[] } {
  const processor = unified().use(remarkParse);
  const tree = processor.parse(content) as Root;

  const lines = content.split('\n');
  const totalLines = lines.length;

  const entities: Entity[] = [];
  const relationships: Relationship[] = [];

  // ── File entity ───────────────────────────────────────────────────────
  const fileEntityId = `file:${relativePath}`;
  const contentLines = lines.filter((l) => l.trim() !== '').length;
  const blankLines = totalLines - contentLines;

  const fileEntity: Entity = {
    id: fileEntityId,
    kind: 'file',
    name: relativePath,
    filePath: relativePath,
    sourceRange: { startLine: 1, startColumn: 0, endLine: totalLines, endColumn: 0 },
    role: 'unknown',
    parentEntityId: null,
    childEntityIds: [],
    entityDepth: 0,
    hierarchyKind: 'root',
    classification: { ...DEFAULT_CLASSIFICATION },
    rawCounts: {
      linesOfCode: contentLines,
      blankLines,
      commentLines: null,
    },
  };
  entities.push(fileEntity);

  // ── Walk MDAST for sections ───────────────────────────────────────────
  const sectionStack: SectionInfo[] = [];
  const sectionEntities: Map<string, Entity> = new Map();

  // Collect heading nodes in document order
  const headingNodes: Heading[] = [];
  walkNodes(tree.children, (node) => {
    if (node.type === 'heading') headingNodes.push(node as Heading);
  });

  // Create section entities from headings
  for (let i = 0; i < headingNodes.length; i++) {
    const heading = headingNodes[i];
    const headingText = mdastToString(heading);
    const slug = toSlug(headingText);
    const startLine = heading.position?.start.line ?? 1;
    const startCol = heading.position?.start.column ?? 1;

    // Determine end line: either the start of the next heading or end of file
    const endLine =
      i + 1 < headingNodes.length
        ? (headingNodes[i + 1].position?.start.line ?? totalLines) - 1
        : totalLines;

    const sectionId = `md-section:${relativePath}:${slug}:${startLine}`;

    // Compute line counts for this section
    const sectionLines = lines.slice(startLine - 1, endLine);
    const sectionContentLines = sectionLines.filter((l) => l.trim() !== '').length;
    const sectionBlankLines = sectionLines.length - sectionContentLines;

    const sectionEntity: Entity = {
      id: sectionId,
      kind: 'section',
      name: headingText,
      filePath: relativePath,
      sourceRange: {
        startLine,
        startColumn: startCol - 1,
        endLine,
        endColumn: 0,
      },
      role: 'unknown',
      parentEntityId: null,
      childEntityIds: [],
      entityDepth: heading.depth,
      hierarchyKind: 'member',
      classification: { ...DEFAULT_CLASSIFICATION },
      rawCounts: {
        linesOfCode: sectionContentLines,
        blankLines: sectionBlankLines,
        commentLines: null,
      },
    };

    // Resolve parent from section stack
    while (sectionStack.length > 0 && sectionStack[sectionStack.length - 1].depth >= heading.depth) {
      sectionStack.pop();
    }

    if (sectionStack.length > 0) {
      const parent = sectionStack[sectionStack.length - 1];
      sectionEntity.parentEntityId = parent.entity.id;
      parent.entity.childEntityIds.push(sectionId);
      parent.entity.hierarchyKind = 'container';
    } else {
      // Top-level section → child of file
      sectionEntity.parentEntityId = fileEntityId;
      fileEntity.childEntityIds.push(sectionId);
    }

    sectionStack.push({ entity: sectionEntity, depth: heading.depth, startLine });
    sectionEntities.set(sectionId, sectionEntity);
    entities.push(sectionEntity);

    // contain relationship
    relationships.push({
      sourceEntityId: sectionEntity.parentEntityId!,
      targetEntityId: sectionId,
      kind: 'contain',
      sourceFilePath: relativePath,
      targetFilePath: relativePath,
      sourceRange: sectionEntity.sourceRange,
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

  // Update file hierarchyKind if it has children
  if (fileEntity.childEntityIds.length > 0) {
    fileEntity.hierarchyKind = 'container';
  }

  // ── Walk MDAST for links, images, code ────────────────────────────────
  walkNodes(tree.children, (node) => {
    if (node.type === 'link') {
      processLink(node as Link, relativePath, entities, relationships);
    } else if (node.type === 'image') {
      processImage(node as Image, relativePath, entities, relationships);
    }
  });

  return { entities, relationships };
}

// ── Link processing ─────────────────────────────────────────────────────────

function processLink(
  node: Link,
  relativePath: string,
  entities: Entity[],
  relationships: Relationship[],
): void {
  const href = node.url;
  if (!href) return;

  const nodeLine = node.position?.start.line ?? 1;
  const sourceSection = findContainingSection(nodeLine, entities, relativePath);
  const sourceEntityId = sourceSection?.id ?? `file:${relativePath}`;
  const sourceRange: SourceRange = {
    startLine: node.position?.start.line ?? 1,
    startColumn: (node.position?.start.column ?? 1) - 1,
    endLine: node.position?.end.line ?? 1,
    endColumn: (node.position?.end.column ?? 1) - 1,
  };

  const defaults = makeRelationshipDefaults(relativePath);

  if (/^https?:\/\//i.test(href)) {
    // External URL
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: null,
      kind: 'reference',
      sourceRange,
      targetFilePath: null,
      resolutionKind: 'unresolved',
      thirdParty: true,
    });
    return;
  }

  // Strip fragment
  const cleanHref = href.split('#')[0];
  if (!cleanHref) return;

  // Resolve relative path
  const targetPath = resolveRelativePath(relativePath, cleanHref);
  const ext = getExtension(cleanHref);

  if (DOC_EXTENSIONS.has(ext)) {
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: `file:${targetPath}`,
      kind: 'reference',
      sourceRange,
      targetFilePath: targetPath,
      resolutionKind: 'proxy',
    });
  } else if (CODE_EXTENSIONS.has(ext)) {
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: `file:${targetPath}`,
      kind: 'reference',
      sourceRange,
      targetFilePath: targetPath,
      resolutionKind: 'proxy',
    });
  } else if (IMAGE_EXTENSIONS.has(ext)) {
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: `file:${targetPath}`,
      kind: 'reference',
      sourceRange,
      targetFilePath: targetPath,
      resolutionKind: 'proxy',
    });
  } else if (ext) {
    // Some other file type
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: `file:${targetPath}`,
      kind: 'reference',
      sourceRange,
      targetFilePath: targetPath,
      resolutionKind: 'proxy',
    });
  }
}

// ── Image processing ────────────────────────────────────────────────────────

function processImage(
  node: Image,
  relativePath: string,
  entities: Entity[],
  relationships: Relationship[],
): void {
  const src = node.url;
  if (!src) return;

  const nodeLine = node.position?.start.line ?? 1;
  const sourceSection = findContainingSection(nodeLine, entities, relativePath);
  const sourceEntityId = sourceSection?.id ?? `file:${relativePath}`;
  const sourceRange: SourceRange = {
    startLine: node.position?.start.line ?? 1,
    startColumn: (node.position?.start.column ?? 1) - 1,
    endLine: node.position?.end.line ?? 1,
    endColumn: (node.position?.end.column ?? 1) - 1,
  };

  const defaults = makeRelationshipDefaults(relativePath);

  if (/^https?:\/\//i.test(src)) {
    relationships.push({
      ...defaults,
      sourceEntityId,
      targetEntityId: null,
      kind: 'reference',
      sourceRange,
      targetFilePath: null,
      resolutionKind: 'unresolved',
      thirdParty: true,
    });
    return;
  }

  const targetPath = resolveRelativePath(relativePath, src);

  relationships.push({
    ...defaults,
    sourceEntityId,
    targetEntityId: `file:${targetPath}`,
    kind: 'reference',
    sourceRange,
    targetFilePath: targetPath,
    resolutionKind: 'proxy',
  });
}

// ── Utilities ───────────────────────────────────────────────────────────────

function walkNodes(nodes: Content[], visitor: (node: Content) => void): void {
  for (const node of nodes) {
    visitor(node);
    if ('children' in node && Array.isArray(node.children)) {
      walkNodes(node.children as Content[], visitor);
    }
  }
}

function findContainingSection(
  line: number,
  entities: Entity[],
  relativePath: string,
): Entity | null {
  // Find the deepest section that contains this line
  let best: Entity | null = null;
  for (const entity of entities) {
    if (
      entity.kind === 'section' &&
      entity.filePath === relativePath &&
      entity.sourceRange.startLine <= line &&
      entity.sourceRange.endLine >= line
    ) {
      if (!best || entity.entityDepth > best.entityDepth) {
        best = entity;
      }
    }
  }
  return best;
}

function resolveRelativePath(fromPath: string, href: string): string {
  // fromPath: 'docs/api.md', href: '../src/auth/index.ts'
  // Split fromPath to get directory, then resolve
  const fromParts = fromPath.replace(/\\/g, '/').split('/');
  fromParts.pop(); // remove filename

  const hrefParts = href.replace(/\\/g, '/').split('/');
  const result = [...fromParts];

  for (const part of hrefParts) {
    if (part === '..') {
      result.pop();
    } else if (part !== '.' && part !== '') {
      result.push(part);
    }
  }

  return result.join('/');
}

function getExtension(href: string): string {
  const clean = href.split('#')[0].split('?')[0];
  const lastDot = clean.lastIndexOf('.');
  if (lastDot === -1) return '';
  return clean.slice(lastDot).toLowerCase();
}
