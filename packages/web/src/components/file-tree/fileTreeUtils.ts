import type { AgentFilesResponse, FilePatternsResponse } from '../../types';
import type { FileAccessFilter, FlatFile, PatternGroup, TreeNode } from './fileTreeTypes';

export function buildTree(files: FlatFile[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', isDir: true, children: [] };

  for (const file of files) {
    const parts = file.path.split('\\').join('/').split('/');
    let node = root;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const isLast = index === parts.length - 1;
      let child = node.children.find((candidate) => candidate.name === part);
      if (!child) {
        const partPath = parts.slice(0, index + 1).join('/');
        child = { name: part, path: partPath, isDir: !isLast, children: [] };
        if (isLast) {
          child.file = file;
        }
        node.children.push(child);
      }
      node = child;
    }
  }

  const sortChildren = (current: TreeNode) => {
    current.children.sort((left, right) => {
      if (left.isDir !== right.isDir) {
        return left.isDir ? -1 : 1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
    });
    current.children.forEach(sortChildren);
  };

  sortChildren(root);
  return root.children;
}

export function getExt(name: string): string {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
}

const extensionIcons: Record<string, string> = {
  ts: '𝘛',
  tsx: '⚛',
  js: '𝙅',
  jsx: '⚛',
  json: '{}',
  md: '📄',
  css: '🎨',
  html: '🌐',
  yml: '⚙',
  yaml: '⚙',
  sh: '⚡',
  env: '🔑',
};

export function fileIcon(name: string, isDir: boolean): string {
  if (isDir) {
    return '📁';
  }
  return extensionIcons[getExt(name)] ?? '📄';
}

export function filterFiles(files: AgentFilesResponse['files'], filter: FileAccessFilter, search: string): FlatFile[] {
  const normalizedSearch = search.trim().toLowerCase();

  return files
    .filter((file) => {
      if (filter === 'read' && !file.readable) {
        return false;
      }
      if (filter === 'write' && !file.writable) {
        return false;
      }
      if (normalizedSearch) {
        return file.path.toLowerCase().includes(normalizedSearch);
      }
      return true;
    })
    .map((file) => ({
      path: file.path,
      readable: file.readable,
      writable: file.writable,
    }));
}

export function getAccessCounts(files: AgentFilesResponse['files']) {
  return {
    readCount: files.filter((file) => file.readable).length,
    writeCount: files.filter((file) => file.writable).length,
  };
}

export function getVisiblePatternGroups(data: AgentFilesResponse | null, patterns: FilePatternsResponse | null): PatternGroup[] {
  const agentReadPatterns = patterns?.agent?.readPaths ?? data?.readPatterns ?? [];
  const agentWritePatterns = patterns?.agent?.writePaths ?? data?.writePatterns ?? [];
  const globalReadPatterns = patterns?.global.readPaths ?? [];
  const globalWritePatterns = patterns?.global.writePaths ?? [];

  const groups: PatternGroup[] = [
    { label: 'Agent Read', scope: 'agent', mode: 'read', values: agentReadPatterns },
    { label: 'Agent Write', scope: 'agent', mode: 'write', values: agentWritePatterns },
    { label: 'Global Read', scope: 'global', mode: 'read', values: globalReadPatterns },
    { label: 'Global Write', scope: 'global', mode: 'write', values: globalWritePatterns },
  ];

  return groups.filter((group) => group.values.length > 0);
}
