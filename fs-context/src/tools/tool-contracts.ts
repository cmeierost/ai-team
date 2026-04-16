/**
 * Access contracts for filesystem-facing tools.
 *
 * These contracts declare the minimum right required to operate on a target path.
 * They are intentionally lightweight and runtime-friendly so other packages can
 * reuse them for tool descriptor registration and tests.
 */

export type FsAccessRight = 'read' | 'write' | 'list';

export const FS_TOOL_NAMES = [
  'fs_read_file',
  'fs_read_lines',
  'fs_write_file',
  'fs_create_file',
  'fs_delete_path',
  'fs_mkdir',
  'fs_exists',
  'fs_info',
  'fs_list',
  'fs_tree',
  'fs_search_content',
  'fs_search_metadata',
  'fs_edit',
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
  fs_read_file: 'read',
  fs_read_lines: 'read',
  fs_write_file: 'write',
  fs_create_file: 'write',
  fs_delete_path: 'write',
  fs_mkdir: 'write',
  fs_exists: 'list',
  fs_info: 'list',
  fs_list: 'list',
  fs_tree: 'list',
  fs_search_content: 'list',
  fs_search_metadata: 'list',
  fs_edit: 'write',
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

export const FS_LIST_RIGHT_TOOLS: readonly FsToolName[] = FS_TOOL_NAMES.filter(
  (toolName) => FS_TOOL_REQUIRED_RIGHT[toolName] === 'list',
);
