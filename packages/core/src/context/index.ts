/** A file annotated with its read/write permission state for a specific agent */
export interface AnnotatedFile {
  /** Workspace-relative path */
  path: string;
  /** Whether the agent can read this file */
  readable: boolean;
  /** Whether the agent can list/discover this file path */
  listable: boolean;
  /** Whether the agent can write this file */
  writable: boolean;
}
