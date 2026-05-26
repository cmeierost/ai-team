/**
 * File-access rights.
 *
 * `read`  — read file content
 * `write` — modify, create, or delete files
 * `list`  — list directory contents / see metadata
 */
export type Right = 'read' | 'write' | 'list';

export const ALL_RIGHTS: readonly Right[] = ['read', 'write', 'list'] as const;

/** allow or deny */
export type Effect = 'allow' | 'deny';

/**
 * A single permission rule.
 *
 * Binds a right to a workspace-relative path pattern with an effect.
 */
export interface PermissionRule {
  /** Which right this rule governs. */
  right: Right;

  /** allow or deny */
  effect: Effect;

  /**
   * Workspace-relative glob pattern for the path.
   * Examples: `src/**`, `docs/*.md`, `**`
   */
  pathPattern: string;

  /** Optional human-readable label for diagnostics. */
  label?: string;
}
