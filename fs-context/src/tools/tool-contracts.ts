/**
 * Access contracts for filesystem-facing tools.
 *
 * These contracts declare the minimum right required to operate on a target path.
 * They are intentionally lightweight and runtime-friendly so other packages can
 * reuse them for tool descriptor registration and tests.
 */

export type FsAccessRight = 'read' | 'write' | 'list';

export const FS_TOOL_NAMES = [
  'fs_read',
  'fs_write',
  'fs_delete_path',
  'fs_mkdir',
  'fs_info',
  'fs_tree',
  'fs_search',
  'bash',
  'fs_copy',
  'fs_move',
  'fs_rename',
  'fs_hash',
  'fs_diff',
  'fs_batch_read',
  'fs_symlink',
  'fs_temp',
  'fs_find',
] as const;

export type FsToolName = (typeof FS_TOOL_NAMES)[number];

/**
 * Canonical right mapping for fs_* tools.
 *
 * Policy decisions:
 * - list/tree/search/info/exists are list-right operations
 * - read maps to read; write/create/delete/edit/bash map to write
 */
export const FS_TOOL_REQUIRED_RIGHT: Record<FsToolName, FsAccessRight> = {
  fs_read: 'read',
  fs_write: 'write',
  fs_delete_path: 'write',
  fs_mkdir: 'write',
  fs_info: 'list',
  fs_tree: 'list',
  fs_search: 'list',
  bash: 'write',
  fs_copy: 'write',
  fs_move: 'write',
  fs_rename: 'write',
  fs_hash: 'read',
  fs_diff: 'read',
  fs_batch_read: 'read',
  fs_symlink: 'write',
  fs_temp: 'write',
  fs_find: 'list',
};

export const FS_LIST_RIGHT_TOOLS = new Set<FsToolName>(
  Object.entries(FS_TOOL_REQUIRED_RIGHT)
    .filter(([, right]) => right === 'list')
    .map(([name]) => name as FsToolName)
);
