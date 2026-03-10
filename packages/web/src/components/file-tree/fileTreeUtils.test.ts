import { describe, expect, it } from 'vitest';
import type { AgentFilesResponse, FilePatternsResponse } from '../../types';
import { buildTree, fileIcon, filterFiles, getAccessCounts, getVisiblePatternGroups } from './fileTreeUtils';

const files: AgentFilesResponse['files'] = [
  { path: 'src/components/FileTree.tsx', readable: true, writable: true },
  { path: 'src/components/ContextPanel.tsx', readable: true, writable: false },
  { path: 'README.md', readable: true, writable: false },
];

describe('fileTreeUtils', () => {
  it('builds a directory-first sorted tree', () => {
    const tree = buildTree(files);

    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md']);
    expect(tree[0]?.children[0]?.name).toBe('components');
    expect(tree[0]?.children[0]?.children.map((node) => node.name)).toEqual(['ContextPanel.tsx', 'FileTree.tsx']);
  });

  it('filters files by permission and search', () => {
    expect(filterFiles(files, 'read', '').length).toBe(3);
    expect(filterFiles(files, 'write', '').map((file) => file.path)).toEqual(['src/components/FileTree.tsx']);
    expect(filterFiles(files, 'all', 'context').map((file) => file.path)).toEqual(['src/components/ContextPanel.tsx']);
  });

  it('returns icons, counts, and visible pattern groups', () => {
    expect(fileIcon('folder', true)).toBe('📁');
    expect(fileIcon('component.tsx', false)).toBe('⚛');
    expect(getAccessCounts(files)).toEqual({ readCount: 3, writeCount: 1 });

    const patterns: FilePatternsResponse = {
      global: { allowPaths: [], readPaths: ['docs/**'], writePaths: [] },
      agent: { id: 'daniel-navarro', readPaths: ['src/**'], writePaths: ['src/components/**'] },
    };

    expect(getVisiblePatternGroups({ agent: 'daniel-navarro', readPatterns: [], writePatterns: [], files }, patterns)).toEqual([
      { label: 'Agent Read', scope: 'agent', mode: 'read', values: ['src/**'] },
      { label: 'Agent Write', scope: 'agent', mode: 'write', values: ['src/components/**'] },
      { label: 'Global Read', scope: 'global', mode: 'read', values: ['docs/**'] },
    ]);
  });
});
