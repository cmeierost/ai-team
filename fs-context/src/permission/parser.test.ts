import { describe, it, expect } from 'vitest';
import { parsePermFile } from './parser.js';

describe('parser', () => {
  it('parses empty content', () => {
    const result = parsePermFile('', '');
    expect(result.sections.list).toEqual([]);
    expect(result.sections.read).toEqual([]);
    expect(result.sections.write).toEqual([]);
    expect(result.meta).toEqual({});
  });

  it('parses implicit patterns as list section', () => {
    const result = parsePermFile('docs/**\nsrc/**', '');
    expect(result.sections.list).toHaveLength(2);
    expect(result.sections.list[0].kind).toBe('allow');
    expect(result.sections.list[0].pattern).toBe('docs/**');
    expect(result.sections.list[1].pattern).toBe('src/**');
  });

  it('parses section headers', () => {
    const content = '[read]\nsrc/web/**\n\n[write]\nsrc/app/**';
    const result = parsePermFile(content, '');
    expect(result.sections.list).toEqual([]);
    expect(result.sections.read).toHaveLength(1);
    expect(result.sections.read[0].pattern).toBe('src/web/**');
    expect(result.sections.write).toHaveLength(1);
    expect(result.sections.write[0].pattern).toBe('src/app/**');
  });

  it('parses negative patterns', () => {
    const result = parsePermFile('[read]\nsrc/**\n!*.json', '');
    expect(result.sections.read).toHaveLength(2);
    expect(result.sections.read[0].kind).toBe('allow');
    expect(result.sections.read[1].kind).toBe('deny');
    expect(result.sections.read[1].pattern).toBe('*.json');
  });

  it('parses bypass patterns (+)', () => {
    const result = parsePermFile('[read]\n+dist/report/**', '');
    expect(result.sections.read).toHaveLength(1);
    expect(result.sections.read[0].kind).toBe('allow');
    expect(result.sections.read[0].bypass).toBe(true);
    expect(result.sections.read[0].pattern).toBe('dist/report/**');
  });

  it('parses inherit sentinel (*)', () => {
    const result = parsePermFile('[write]\n*\n!*.json', '');
    expect(result.sections.write).toHaveLength(2);
    expect(result.sections.write[0].kind).toBe('inherit');
    expect(result.sections.write[1].kind).toBe('deny');
  });

  it('strips YAML frontmatter', () => {
    const content = '---\nid: test-ctx\nname: Test Context\n---\ndocs/**';
    const result = parsePermFile(content, '');
    expect(result.meta.id).toBe('test-ctx');
    expect(result.meta.name).toBe('Test Context');
    expect(result.sections.list).toHaveLength(1);
    expect(result.sections.list[0].pattern).toBe('docs/**');
  });

  it('skips comments and blank lines', () => {
    const content = '# comment\n; another comment\n\ndocs/**';
    const result = parsePermFile(content, '');
    expect(result.sections.list).toHaveLength(1);
  });

  it('scopes patterns to baseDir', () => {
    const result = parsePermFile('src/**', 'packages/web');
    expect(result.sections.list[0].pattern).toBe('packages/web/src/**');
  });

  it('preserves line order', () => {
    const content = '[write]\nsrc/app/**\n!*.json\ndocs/**';
    const result = parsePermFile(content, '');
    expect(result.sections.write).toHaveLength(3);
    expect(result.sections.write[0].kind).toBe('allow');
    expect(result.sections.write[1].kind).toBe('deny');
    expect(result.sections.write[2].kind).toBe('allow');
  });

  it('ignores invalid section names', () => {
    const content = '[unknown]\nfoo/**\n[read]\nsrc/**';
    const result = parsePermFile(content, '');
    expect(result.sections.read).toHaveLength(1);
    // [unknown] patterns are dropped
    expect(result.sections.list).toEqual([]);
  });
});
