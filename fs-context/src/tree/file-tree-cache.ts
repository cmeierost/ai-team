import chokidar from 'chokidar';
import path from 'node:path';
import type { FSWatcher } from 'chokidar';
import type {
  FileTreeNode,
  FlatFileEntry,
  GetFileTreeOptions,
  ListWorkspaceFilesOptions,
} from './file-tree.js';
import { getFileTree, listWorkspaceFiles } from './file-tree.js';
import { SyncGitignoreMatcher } from './ignore.js';
import { emitFileWatcherEvent } from '../fs/file-events.js';

interface CacheEntry<T> {
  value: T;
  createdAt: number;
}

interface WorkspaceFileTreeCache {
  tree: Map<string, CacheEntry<FileTreeNode>>;
  flat: Map<string, CacheEntry<FlatFileEntry[]>>;
  watcher: FSWatcher | null;
  initPromise: Promise<void> | null;
  gitignoreMatcher: SyncGitignoreMatcher;
}

const MAX_CACHE_ENTRIES = 32;
const workspaceCaches = new Map<string, WorkspaceFileTreeCache>();

function normalizeOptions(options: GetFileTreeOptions): GetFileTreeOptions {
  return {
    maxDepth: options.maxDepth,
    includeHidden: options.includeHidden,
    ignoreGitignore: options.ignoreGitignore,
    excludeDirs: options.excludeDirs
      ? [...options.excludeDirs].sort((a, b) => a.localeCompare(b))
      : [],
    rootSubPath: options.rootSubPath,
    allowPaths: options.allowPaths
      ? [...options.allowPaths].sort((a, b) => a.localeCompare(b))
      : [],
  };
}

function getTreeCacheKey(options: GetFileTreeOptions): string {
  return JSON.stringify(normalizeOptions(options));
}

function getFlatCacheKey(options: ListWorkspaceFilesOptions): string {
  return JSON.stringify({
    ...normalizeOptions(options),
    filesOnly: options.filesOnly,
    extensions: options.extensions
      ? [...options.extensions].sort((a, b) => a.localeCompare(b))
      : [],
  });
}

function getOrCreateWorkspaceCache(workspaceRoot: string): WorkspaceFileTreeCache {
  const normalizedRoot = path.resolve(workspaceRoot);
  const existing = workspaceCaches.get(normalizedRoot);
  if (existing) return existing;

  const created: WorkspaceFileTreeCache = {
    tree: new Map(),
    flat: new Map(),
    watcher: null,
    initPromise: null,
    gitignoreMatcher: new SyncGitignoreMatcher(normalizedRoot),
  };

  workspaceCaches.set(normalizedRoot, created);
  return created;
}

function trimMap<T>(map: Map<string, CacheEntry<T>>): void {
  while (map.size > MAX_CACHE_ENTRIES) {
    const oldestKey = map.keys().next().value;
    if (!oldestKey) break;
    map.delete(oldestKey);
  }
}

function clearWorkspaceCache(cache: WorkspaceFileTreeCache): void {
  cache.tree.clear();
  cache.flat.clear();
}

function isAlwaysIgnoredWatchPath(targetPath: string): boolean {
  const normalized = targetPath.replaceAll('\\', '/');
  return (
    normalized.includes('/node_modules/') ||
    normalized.endsWith('/node_modules') ||
    normalized.includes('/.git/') ||
    normalized.endsWith('/.git')
  );
}

async function ensureWatcher(workspaceRoot: string, cache: WorkspaceFileTreeCache): Promise<void> {
  if (cache.watcher) return;
  if (cache.initPromise) return cache.initPromise;

  cache.initPromise = (async () => {
    const watcher = chokidar.watch(workspaceRoot, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 75,
        pollInterval: 25,
      },
      ignored: (watchPath, stats) => {
        if (isAlwaysIgnoredWatchPath(watchPath)) return true;
        if (path.basename(watchPath) === '.gitignore') return false;
        return cache.gitignoreMatcher.isIgnored(watchPath, stats?.isDirectory() ?? false);
      },
    });

    const invalidate = (
      watchPath: string,
      isDirectory: boolean,
      kind: 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'
    ) => {
      if (path.basename(watchPath) === '.gitignore') {
        cache.gitignoreMatcher.clear();
        clearWorkspaceCache(cache);
        emitFileWatcherEvent(watchPath, kind);
        return;
      }

      if (isAlwaysIgnoredWatchPath(watchPath)) return;
      if (cache.gitignoreMatcher.isIgnored(watchPath, isDirectory)) return;
      clearWorkspaceCache(cache);
      emitFileWatcherEvent(watchPath, kind);
    };

    watcher.on('add', (watchPath) => invalidate(watchPath, false, 'add'));
    watcher.on('change', (watchPath) => invalidate(watchPath, false, 'change'));
    watcher.on('unlink', (watchPath) => invalidate(watchPath, false, 'unlink'));
    watcher.on('addDir', (watchPath) => invalidate(watchPath, true, 'addDir'));
    watcher.on('unlinkDir', (watchPath) => invalidate(watchPath, true, 'unlinkDir'));

    watcher.on('error', () => {
      clearWorkspaceCache(cache);
    });

    cache.watcher = watcher;
  })();

  try {
    await cache.initPromise;
  } finally {
    cache.initPromise = null;
  }
}

export async function getCachedFileTree(
  workspaceRoot: string,
  options: GetFileTreeOptions = {}
): Promise<FileTreeNode> {
  const normalizedRoot = path.resolve(workspaceRoot);
  const cache = getOrCreateWorkspaceCache(normalizedRoot);
  await ensureWatcher(normalizedRoot, cache);

  const key = getTreeCacheKey(options);
  const cached = cache.tree.get(key);
  if (cached) return cached.value;

  const computed = await getFileTree(normalizedRoot, options);
  cache.tree.set(key, { value: computed, createdAt: Date.now() });
  trimMap(cache.tree);
  return computed;
}

export async function listCachedWorkspaceFiles(
  workspaceRoot: string,
  options: ListWorkspaceFilesOptions = {}
): Promise<FlatFileEntry[]> {
  const normalizedRoot = path.resolve(workspaceRoot);
  const cache = getOrCreateWorkspaceCache(normalizedRoot);
  await ensureWatcher(normalizedRoot, cache);

  const key = getFlatCacheKey(options);
  const cached = cache.flat.get(key);
  if (cached) return cached.value;

  const computed = await listWorkspaceFiles(normalizedRoot, options);
  cache.flat.set(key, { value: computed, createdAt: Date.now() });
  trimMap(cache.flat);
  return computed;
}

export async function clearFileTreeCache(workspaceRoot?: string): Promise<void> {
  if (workspaceRoot) {
    const normalizedRoot = path.resolve(workspaceRoot);
    const cache = workspaceCaches.get(normalizedRoot);
    if (!cache) return;
    clearWorkspaceCache(cache);
    return;
  }

  for (const cache of workspaceCaches.values()) {
    clearWorkspaceCache(cache);
  }
}

export async function disposeFileTreeCache(workspaceRoot?: string): Promise<void> {
  if (workspaceRoot) {
    const normalizedRoot = path.resolve(workspaceRoot);
    const cache = workspaceCaches.get(normalizedRoot);
    if (!cache) return;

    if (cache.watcher) {
      await cache.watcher.close();
    }
    workspaceCaches.delete(normalizedRoot);
    return;
  }

  await Promise.all(
    Array.from(workspaceCaches.values()).map(async (cache) => {
      if (cache.watcher) {
        await cache.watcher.close();
      }
    })
  );
  workspaceCaches.clear();
}
