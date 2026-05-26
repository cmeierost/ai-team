import path from 'node:path';

/**
 * Normalize a file path to a workspace-relative POSIX-style path.
 *
 * - Converts Windows backslashes to forward slashes
 * - Strips a leading `workspaceRoot` prefix
 * - Strips leading `/` so result is always relative (e.g. `src/foo.ts`)
 * - Collapses `.` and `..` segments
 */
export function normalizePath(filePath: string, workspaceRoot: string): string {
  // Normalize separators to POSIX
  let p = filePath.replace(/\\/g, '/');
  let root = workspaceRoot.replace(/\\/g, '/');

  // Strip trailing slash from root
  if (root.endsWith('/')) root = root.slice(0, -1);

  // Strip Windows drive letter for comparison (case-insensitive)
  const stripDrive = (s: string) => s.replace(/^[A-Za-z]:/, '');

  const pNoDrive = stripDrive(p);
  const rootNoDrive = stripDrive(root);

  if (pNoDrive.startsWith(rootNoDrive + '/')) {
    p = pNoDrive.slice(rootNoDrive.length + 1);
  } else if (pNoDrive === rootNoDrive) {
    p = '';
  } else {
    // Already relative or outside workspace — normalize as-is
    p = pNoDrive;
  }

  return normalizeRelativePosixPath(p);
}

/**
 * Normalize a path that is already workspace-relative (no root stripping needed).
 *
 * - Converts backslashes to forward slashes
 * - Collapses `.` and `..` via `path.posix.normalize`
 * - Strips leading `./` and `/`
 * - Returns `''` for the root/empty case
 */
export function normalizeRelativePosixPath(filePath: string): string {
  let p = filePath.replaceAll('\\', '/');
  p = path.posix.normalize(p);
  if (p.startsWith('./')) p = p.slice(2);
  if (p.startsWith('/')) p = p.slice(1);
  if (p === '.') p = '';
  // Case-insensitive on Windows (NTFS) to prevent permission bypass via casing
  if (process.platform === 'win32') p = p.toLowerCase();
  return p;
}

/**
 * Resolve a possibly-relative path against a cwd, then normalize to workspace-relative.
 */
export function resolveAndNormalize(
  filePath: string,
  cwd: string,
  workspaceRoot: string,
): string {
  const p = filePath.replace(/\\/g, '/');

  // If already absolute, normalize directly
  if (path.isAbsolute(filePath) || /^[A-Za-z]:/.test(filePath)) {
    return normalizePath(filePath, workspaceRoot);
  }

  // Relative: resolve against cwd first
  const cwdPosix = cwd.replace(/\\/g, '/');
  const resolved = cwdPosix.endsWith('/')
    ? cwdPosix + p
    : cwdPosix + '/' + p;

  return normalizePath(resolved, workspaceRoot);
}

/**
 * Extract the file-name (basename) from a workspace-relative path.
 */
export function fileName(wsRelativePath: string): string {
  return path.posix.basename(wsRelativePath);
}

// ---------------------------------------------------------------------------
// Workspace boundary utilities (merged from path-safety.ts)
// ---------------------------------------------------------------------------

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
