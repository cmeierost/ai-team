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

  // Collapse . and .. via path.posix
  p = path.posix.normalize(p);

  // Strip leading ./
  if (p.startsWith('./')) p = p.slice(2);
  // Strip leading /
  if (p.startsWith('/')) p = p.slice(1);
  // Root becomes empty string
  if (p === '.') p = '';

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
