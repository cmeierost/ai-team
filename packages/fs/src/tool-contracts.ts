/**
 * Access contracts for filesystem-facing tools.
 *
 * These contracts declare the minimum right required to operate on a target path.
 * They are intentionally lightweight and runtime-friendly so other packages can
 * reuse them for tool descriptor registration and tests.
 */

export type FsAccessRight = 'read' | 'write' | 'create' | 'delete' | 'list';

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
] as const;

export type FsToolName = (typeof FS_TOOL_NAMES)[number];

/**
 * Canonical right mapping for fs_* tools.
 *
 * Policy decisions:
 * - list/tree/search/info/exists are list-right operations
 * - read/write/create/delete map directly to their matching rights
 */
export const FS_TOOL_REQUIRED_RIGHT: Record<FsToolName, FsAccessRight> = {
  fs_read_file: 'read',
  fs_read_lines: 'read',
  fs_write_file: 'write',
  fs_create_file: 'create',
  fs_delete_path: 'delete',
  fs_mkdir: 'create',
  fs_exists: 'list',
  fs_info: 'list',
  fs_list: 'list',
  fs_tree: 'list',
  fs_search_content: 'list',
  fs_search_metadata: 'list',
};

export const FS_LIST_RIGHT_TOOLS: readonly FsToolName[] = FS_TOOL_NAMES.filter(
  (toolName) => FS_TOOL_REQUIRED_RIGHT[toolName] === 'list',
);
