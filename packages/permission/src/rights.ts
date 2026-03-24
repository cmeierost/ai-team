/**
 * File-access rights.
 *
 * `read`   — read file content
 * `write`  — modify existing file content
 * `create` — create a new file or directory
 * `delete` — remove a file or directory
 * `list`   — list directory contents / see metadata
 */
export type Right = 'read' | 'write' | 'create' | 'delete' | 'list';

export const ALL_RIGHTS: readonly Right[] = ['read', 'write', 'create', 'delete', 'list'] as const;

/** allow or deny */
export type Effect = 'allow' | 'deny';

/** Resource kind the rule targets. */
export type ResourceKind = 'file' | 'directory' | 'any';

/**
 * A single access rule.
 *
 * Binds a right to a workspace-relative path pattern with an effect.
 * Optionally restricts by file-name pattern (e.g. `*.md`).
 */
export interface AccessRule {
  /** Which right this rule governs. */
  right: Right;

  /** allow or deny */
  effect: Effect;

  /**
   * Workspace-relative glob pattern for the path.
   * Examples: `src/**`, `docs/*.md`, `**`
   */
  pathPattern: string;

  /**
   * Optional file-name-only pattern applied after pathPattern matches.
   * Useful for `create` rules: allow `create` in `docs/` but only for `*.md`.
   */
  filePattern?: string;

  /** Whether this targets files, directories, or both. Default: 'any'. */
  resourceKind?: ResourceKind;

  /** Optional human-readable label for diagnostics. */
  label?: string;
}
