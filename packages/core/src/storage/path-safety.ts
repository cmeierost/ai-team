import path from 'node:path';

/**
 * Normalize a workspace-relative path to forward-slash separators.
 */
export function normalizeWorkspaceRelativePath(relativePath: string): string {
  return relativePath.replaceAll('\\', '/');
}

/**
 * Return true when childPath is inside (or equal to) workspaceRoot.
 */
export function isInsideWorkspaceRoot(workspaceRoot: string, childPath: string): boolean {
  const root = path.resolve(workspaceRoot);
  const absolute = path.resolve(childPath);
  const relative = path.relative(root, absolute);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Resolve an input path against workspaceRoot and reject paths outside the workspace.
 *
 * - Absolute paths must already be inside workspaceRoot.
 * - Relative paths are resolved against workspaceRoot.
 */
export function resolveInsideWorkspace(workspaceRoot: string, inputPath: string): string | null {
  const root = path.resolve(workspaceRoot);
  const absolute = path.isAbsolute(inputPath) ? path.resolve(inputPath) : path.resolve(root, inputPath);
  if (!isInsideWorkspaceRoot(root, absolute)) return null;
  return absolute;
}

/**
 * Convert an absolute or workspace-relative path into a normalized workspace-relative path.
 * Returns null for paths outside the workspace.
 */
export function toWorkspaceRelativePath(workspaceRoot: string, inputPath: string): string | null {
  const absolute = resolveInsideWorkspace(workspaceRoot, inputPath);
  if (!absolute) return null;
  return normalizeWorkspaceRelativePath(path.relative(path.resolve(workspaceRoot), absolute));
}
