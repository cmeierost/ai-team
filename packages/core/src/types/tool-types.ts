/**
 * Declarative permission descriptor attached to each tool.
 * ToolManager reads this to call ContextManager once in canExecute()
 * rather than having each tool do its own permission check internally.
 */
export type PermissionDescriptor =
  | { type: 'none' }
  | { type: 'file-read'; argsPath: string }
  | { type: 'file-write'; argsPath: string }
  | { type: 'agent-delegation'; argsPath: string }
  | { type: 'manage-agents' };
