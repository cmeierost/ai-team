import { describe, it, expect } from 'vitest';
import { parseMarkdownFile, toSlug } from './md-parser.js';

// ── 1. Headings → file entity + section entities + contain relationships ────

describe('parseMarkdownFile', () => {
  it('parses markdown with headings into file + section entities and contain relationships', () => {
    const md = `# Introduction

Some text here.

## Getting Started

More text.
`;
    const { entities, relationships } = parseMarkdownFile(md, 'docs/guide.md');

    // File entity
    const fileEntity = entities.find((e) => e.kind === 'file');
    expect(fileEntity).toBeDefined();
    expect(fileEntity!.id).toBe('file:docs/guide.md');
    expect(fileEntity!.name).toBe('docs/guide.md');

    // Section entities
    const sections = entities.filter((e) => e.kind === 'section');
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe('Introduction');
    expect(sections[1].name).toBe('Getting Started');

    // Contain relationships
    const containRels = relationships.filter((r) => r.kind === 'contain');
    expect(containRels).toHaveLength(2);
  });

  // ── 2. Section nesting: h1 → h2 → h3 ───────────────────────────────────

  it('builds correct parent-child hierarchy for nested headings', () => {
    const md = `# Top Level

## Second Level

### Third Level

Some content.
`;
    const { entities, relationships } = parseMarkdownFile(md, 'README.md');

    const h1 = entities.find((e) => e.kind === 'section' && e.name === 'Top Level')!;
    const h2 = entities.find((e) => e.kind === 'section' && e.name === 'Second Level')!;
    const h3 = entities.find((e) => e.kind === 'section' && e.name === 'Third Level')!;

    // h1 is child of file
    expect(h1.parentEntityId).toBe('file:README.md');
    // h2 is child of h1
    expect(h2.parentEntityId).toBe(h1.id);
    // h3 is child of h2
    expect(h3.parentEntityId).toBe(h2.id);

    // h1 contains h2
    expect(h1.childEntityIds).toContain(h2.id);
    // h2 contains h3
    expect(h2.childEntityIds).toContain(h3.id);

    // hierarchy kinds
    expect(h1.hierarchyKind).toBe('container');
    expect(h2.hierarchyKind).toBe('container');
    expect(h3.hierarchyKind).toBe('member');

    // entity depths match heading level
    expect(h1.entityDepth).toBe(1);
    expect(h2.entityDepth).toBe(2);
    expect(h3.entityDepth).toBe(3);

    // contain relationships exist
    const containRels = relationships.filter((r) => r.kind === 'contain');
    expect(containRels).toHaveLength(3); // file→h1, h1→h2, h2→h3
  });

  // ── 3. Relative links to code files ─────────────────────────────────────

  it('extracts relative links to code files as reference relationships', () => {
    const md = `# Auth Module

See [auth handler](../src/auth/index.ts) for details.

Also check [styles](../src/styles/main.css).
`;
    const { relationships } = parseMarkdownFile(md, 'docs/auth.md');

    const refs = relationships.filter((r) => r.kind === 'reference');
    expect(refs).toHaveLength(2);

    const tsRef = refs.find((r) => r.targetFilePath === 'src/auth/index.ts');
    expect(tsRef).toBeDefined();
    expect(tsRef!.targetEntityId).toBe('file:src/auth/index.ts');
    expect(tsRef!.resolutionKind).toBe('proxy');
    expect(tsRef!.thirdParty).toBe(false);

    const cssRef = refs.find((r) => r.targetFilePath === 'src/styles/main.css');
    expect(cssRef).toBeDefined();
    expect(cssRef!.resolutionKind).toBe('proxy');
  });

  // ── 4. Relative links to other docs ─────────────────────────────────────

  it('extracts relative links to other markdown docs as reference relationships', () => {
    const md = `# Overview

Read the [API guide](./api-guide.md) for more info.

Also see [contributing](../CONTRIBUTING.mdx).
`;
    const { relationships } = parseMarkdownFile(md, 'docs/overview.md');

    const refs = relationships.filter((r) => r.kind === 'reference');
    expect(refs).toHaveLength(2);

    const mdRef = refs.find((r) => r.targetFilePath === 'docs/api-guide.md');
    expect(mdRef).toBeDefined();
    expect(mdRef!.targetEntityId).toBe('file:docs/api-guide.md');
    expect(mdRef!.resolutionKind).toBe('proxy');

    const mdxRef = refs.find((r) => r.targetFilePath === 'CONTRIBUTING.mdx');
    expect(mdxRef).toBeDefined();
    expect(mdxRef!.targetEntityId).toBe('file:CONTRIBUTING.mdx');
  });

  // ── 5. External URLs → thirdParty + unresolved ──────────────────────────

  it('extracts external URLs as reference with thirdParty=true and unresolved', () => {
    const md = `# Resources

Check [Node.js](https://nodejs.org) and [MDN](https://developer.mozilla.org).
`;
    const { relationships } = parseMarkdownFile(md, 'docs/resources.md');

    const refs = relationships.filter((r) => r.kind === 'reference');
    expect(refs).toHaveLength(2);

    for (const ref of refs) {
      expect(ref.thirdParty).toBe(true);
      expect(ref.resolutionKind).toBe('unresolved');
      expect(ref.targetEntityId).toBeNull();
      expect(ref.targetFilePath).toBeNull();
    }
  });

  // ── 6. Image references ─────────────────────────────────────────────────

  it('extracts image references as reference relationships to asset files', () => {
    const md = `# Diagram

![Architecture](./images/arch.png)

![Logo](../assets/logo.svg)
`;
    const { relationships } = parseMarkdownFile(md, 'docs/diagrams.md');

    const refs = relationships.filter((r) => r.kind === 'reference');
    expect(refs).toHaveLength(2);

    const pngRef = refs.find((r) => r.targetFilePath === 'docs/images/arch.png');
    expect(pngRef).toBeDefined();
    expect(pngRef!.targetEntityId).toBe('file:docs/images/arch.png');
    expect(pngRef!.resolutionKind).toBe('proxy');

    const svgRef = refs.find((r) => r.targetFilePath === 'assets/logo.svg');
    expect(svgRef).toBeDefined();
    expect(svgRef!.targetEntityId).toBe('file:assets/logo.svg');
  });

  // ── 7. Section line counts ──────────────────────────────────────────────

  it('computes section line counts correctly', () => {
    const md = `# Header

Line one.
Line two.

Line four after blank.

## Another

Content here.
`;
    const { entities } = parseMarkdownFile(md, 'test.md');

    const header = entities.find((e) => e.kind === 'section' && e.name === 'Header')!;
    expect(header.rawCounts).toBeDefined();
    // Section "Header" spans lines 1-7 (before "## Another" at line 8)
    // Lines 1-7: "# Header", "", "Line one.", "Line two.", "", "Line four after blank.", ""
    // Content lines (non-blank): 4; Blank lines: 3
    expect(header.rawCounts!.linesOfCode).toBe(4);
    expect(header.rawCounts!.blankLines).toBe(3);

    const another = entities.find((e) => e.kind === 'section' && e.name === 'Another')!;
    expect(another.rawCounts).toBeDefined();
    // Section "Another" spans lines 8-11: "## Another", "", "Content here.", ""
    // Content: 2; Blank: 2 (empty line + trailing newline)
    expect(another.rawCounts!.linesOfCode).toBe(2);
    expect(another.rawCounts!.blankLines).toBe(2);

    // File entity: 11 total lines, 6 content, 5 blank
    const file = entities.find((e) => e.kind === 'file')!;
    expect(file.rawCounts!.linesOfCode).toBe(6);
  });

  // ── 8. Deterministic entity IDs ─────────────────────────────────────────

  it('produces deterministic slug-based entity IDs', () => {
    const md = `# API Overview

## Authentication Flow
`;
    const { entities } = parseMarkdownFile(md, 'docs/architecture.md');

    const section1 = entities.find((e) => e.name === 'API Overview')!;
    expect(section1.id).toBe('md-section:docs/architecture.md:api-overview:1');

    const section2 = entities.find((e) => e.name === 'Authentication Flow')!;
    expect(section2.id).toBe('md-section:docs/architecture.md:authentication-flow:3');
  });

  // ── 9. Empty markdown file → only file entity ──────────────────────────

  it('returns only file entity for an empty markdown file', () => {
    const md = '';
    const { entities, relationships } = parseMarkdownFile(md, 'empty.md');

    expect(entities).toHaveLength(1);
    expect(entities[0].kind).toBe('file');
    expect(entities[0].id).toBe('file:empty.md');
    expect(relationships).toHaveLength(0);
  });

  // ── 10. Heading slug collisions → unique IDs via line number ────────────

  it('handles heading slug collisions with unique IDs via line number', () => {
    const md = `# Usage

First usage section.

# Usage

Second usage section.
`;
    const { entities } = parseMarkdownFile(md, 'docs/usage.md');

    const sections = entities.filter((e) => e.kind === 'section');
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe('Usage');
    expect(sections[1].name).toBe('Usage');

    // IDs are unique because of line number
    expect(sections[0].id).not.toBe(sections[1].id);
    expect(sections[0].id).toContain(':usage:');
    expect(sections[1].id).toContain(':usage:');

    // They should have different line numbers in the ID
    const id1Line = sections[0].id.split(':').pop();
    const id2Line = sections[1].id.split(':').pop();
    expect(id1Line).not.toBe(id2Line);
  });
});

// ── toSlug helper tests ───────────────────────────────────────────────────

describe('toSlug', () => {
  it('converts heading text to kebab-case', () => {
    expect(toSlug('API Overview')).toBe('api-overview');
    expect(toSlug('Getting Started!')).toBe('getting-started');
    expect(toSlug('CamelCase Example')).toBe('camelcase-example');
    expect(toSlug('  Spaces  Everywhere  ')).toBe('spaces-everywhere');
  });
});
