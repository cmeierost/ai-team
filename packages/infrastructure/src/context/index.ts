import {
  PermissionError,
  ContextRuntime,
  normalizePath,
  canRead,
  canWrite,
  canList,
  WorkspaceFs,
  WorkspaceCodeEdit,
  WorkspaceSearch,
  getCachedFileTree,
} from 'fs-context';
import type { AccessPatternSet, PermissionChecker } from 'fs-context';
import {
  type PermissionConfig,
  type AnnotatedFile,
  type IFileAnnotationService,
  type IFileTreeService,
  type FileTreeNode,
  type GetFileTreeOptions,
  type IWorkspaceAccessRuntime,
  type IWorkspaceFs,
  type IWorkspaceFsFactory,
  type IConfigurationStorage,
  type FileTypeGroupConfig,
} from '@ai-team/core';

function toPatternSet(permissions: PermissionConfig | undefined): AccessPatternSet {
  return {
    list: permissions?.list ?? [],
    read: permissions?.read ?? [],
    write: permissions?.write ?? [],
  };
}

// ---------------------------------------------------------------------------
// Single-file checks — pattern matching (no allFiles needed)
// ---------------------------------------------------------------------------

export function canReadPath(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  filePath: string
): boolean {
  return canRead(normalizePath(filePath, workspaceRoot), toPatternSet(permissions));
}

export function canWritePath(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  filePath: string
): boolean {
  return canWrite(normalizePath(filePath, workspaceRoot), toPatternSet(permissions));
}

export function canListPath(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  filePath: string
): boolean {
  // When no explicit list patterns are configured, fall back to read access.
  // Explicit list: [] (set to empty) preserves the default-open behaviour.
  if (permissions?.list === undefined) {
    return canReadPath(workspaceRoot, permissions, filePath);
  }
  return canList(normalizePath(filePath, workspaceRoot), toPatternSet(permissions));
}

export function assertCanReadPath(
  workspaceRoot: string,
  contextId: string,
  permissions: PermissionConfig | undefined,
  filePath: string
): void {
  if (!canReadPath(workspaceRoot, permissions, filePath))
    throw new PermissionError(contextId, filePath);
}

export function assertCanWritePath(
  workspaceRoot: string,
  contextId: string,
  permissions: PermissionConfig | undefined,
  filePath: string
): void {
  if (!canWritePath(workspaceRoot, permissions, filePath))
    throw new PermissionError(contextId, filePath);
}

// ---------------------------------------------------------------------------
// Runtime factory — resolve patterns once against a known file list.
// Use this when you own a session and want O(1) lookups across many files.
// ---------------------------------------------------------------------------

/** Build a ContextRuntime with this agent's permissions pre-resolved. */
export function createAgentRuntime(
  contextId: string,
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  allFiles: readonly string[]
): ContextRuntime {
  const normalizedFiles = allFiles.map((f) => normalizePath(f, workspaceRoot));
  const runtime = new ContextRuntime();
  runtime.registerFromPatterns(contextId, toPatternSet(permissions), normalizedFiles);
  return runtime;
}

// ---------------------------------------------------------------------------
// Batch operations — build a one-shot runtime so each lookup is O(1) Set.has()
// ---------------------------------------------------------------------------

export function getReadableFiles(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  allFiles: string[]
): string[] {
  const runtime = createAgentRuntime('__ctx', workspaceRoot, permissions, allFiles);
  return allFiles.filter((f) => runtime.canRead('__ctx', normalizePath(f, workspaceRoot)));
}

export function getWritableFiles(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  allFiles: string[]
): string[] {
  const runtime = createAgentRuntime('__ctx', workspaceRoot, permissions, allFiles);
  return allFiles.filter((f) => runtime.canWrite('__ctx', normalizePath(f, workspaceRoot)));
}

export function getAnnotatedFiles(
  workspaceRoot: string,
  permissions: PermissionConfig | undefined,
  allFiles: string[]
): AnnotatedFile[] {
  const runtime = createAgentRuntime('__ctx', workspaceRoot, permissions, allFiles);
  return allFiles.map((filePath) => {
    const rel = normalizePath(filePath, workspaceRoot);
    return {
      path: filePath,
      readable: runtime.canRead('__ctx', rel),
      listable: runtime.canList('__ctx', rel),
      writable: runtime.canWrite('__ctx', rel),
    };
  });
}

export function validateEditProposal(
  workspaceRoot: string,
  contextId: string,
  permissions: PermissionConfig | undefined,
  filePaths: string[]
): { allowed: boolean; blockedFiles: string[]; message?: string } {
  const runtime = createAgentRuntime(contextId, workspaceRoot, permissions, filePaths);
  const blockedFiles = filePaths.filter(
    (f) => !runtime.canWrite(contextId, normalizePath(f, workspaceRoot))
  );
  if (blockedFiles.length === 0) return { allowed: true, blockedFiles: [] };
  return {
    allowed: false,
    blockedFiles,
    message: `Context ${contextId} cannot write to ${blockedFiles.length} file(s): ${blockedFiles.join(', ')}`,
  };
}

// ---------------------------------------------------------------------------
// Pattern-based PermissionChecker — lightweight adapter for workspace facades.
// Evaluates permissions per-call against glob patterns (no pre-resolved file index).
// ---------------------------------------------------------------------------

/**
 * PermissionChecker backed by pattern matching.
 *
 * Unlike ContextRuntime (which pre-resolves all files into Sets for O(1) lookups),
 * this evaluates each check against the agent's glob patterns on the fly.
 * Suitable for tool execution where each call checks a single path.
 */
export class PatternPermissionChecker implements PermissionChecker {
  constructor(
    private readonly workspaceRoot: string,
    private readonly permissions: PermissionConfig | undefined
  ) {}

  canRead(_contextId: string, filePath: string): boolean {
    return canReadPath(this.workspaceRoot, this.permissions, filePath);
  }

  canWrite(_contextId: string, filePath: string): boolean {
    return canWritePath(this.workspaceRoot, this.permissions, filePath);
  }

  canList(_contextId: string, filePath: string): boolean {
    return canListPath(this.workspaceRoot, this.permissions, filePath);
  }
}

// ---------------------------------------------------------------------------
// Facade factories — construct permission-aware workspace accessors.
// ---------------------------------------------------------------------------

/** Create a WorkspaceFs for an agent using pattern-based permission checks. */
export function createWorkspaceFs(
  workspaceRoot: string,
  agentId: string,
  permissions: PermissionConfig | undefined
): WorkspaceFs {
  return new WorkspaceFs(
    workspaceRoot,
    agentId,
    new PatternPermissionChecker(workspaceRoot, permissions)
  );
}

/** Create a WorkspaceCodeEdit for an agent using pattern-based permission checks. */
export function createWorkspaceCodeEdit(
  workspaceRoot: string,
  agentId: string,
  permissions: PermissionConfig | undefined
): WorkspaceCodeEdit {
  return new WorkspaceCodeEdit(
    workspaceRoot,
    agentId,
    new PatternPermissionChecker(workspaceRoot, permissions)
  );
}

/** Create a WorkspaceSearch for an agent using pattern-based permission checks. */
export function createWorkspaceSearch(
  workspaceRoot: string,
  agentId: string,
  permissions: PermissionConfig | undefined
): WorkspaceSearch {
  return new WorkspaceSearch(
    workspaceRoot,
    agentId,
    new PatternPermissionChecker(workspaceRoot, permissions)
  );
}

export class FileAnnotationServiceImpl implements IFileAnnotationService {
  getAnnotatedFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): AnnotatedFile[] {
    return getAnnotatedFiles(workspaceRoot, permissions, allFiles);
  }

  getWritableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[] {
    return getWritableFiles(workspaceRoot, permissions, allFiles);
  }

  getReadableFiles(
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[]
  ): string[] {
    return getReadableFiles(workspaceRoot, permissions, allFiles);
  }
}

export class FileTreeServiceImpl implements IFileTreeService {
  getCachedFileTree(workspaceRoot: string, options?: GetFileTreeOptions): Promise<FileTreeNode> {
    return getCachedFileTree(workspaceRoot, options ?? {});
  }
}

export class InfrastructureWorkspaceAccessRuntime implements IWorkspaceAccessRuntime {
  constructor(
    private readonly configurationStorage?: IConfigurationStorage
  ) {}

  async createAgentRuntime(
    contextId: string,
    workspaceRoot: string,
    permissions: PermissionConfig | undefined,
    allFiles: readonly string[]
  ): Promise<ContextRuntime> {
    return createAgentRuntime(contextId, workspaceRoot, permissions, allFiles);
  }

  async analyzeWorkspacePermissionOverlapAsync(
    workspaceRoot: string,
    options?: {
      mode?: 'files' | 'patterns';
      agentId?: string;
      maxDepth?: number;
    }
  ): Promise<unknown> {
    const { analyzeWorkspacePermissionOverlap } = await import('./perm-overlap.js');
    let fileTypeGroupsFromConfig: Record<string, FileTypeGroupConfig> | undefined;
    try {
      fileTypeGroupsFromConfig = this.configurationStorage?.get('fileTypeGroups') as Record<string, FileTypeGroupConfig> | undefined;
    } catch {
      fileTypeGroupsFromConfig = undefined;
    }

    return analyzeWorkspacePermissionOverlap(workspaceRoot, options, fileTypeGroupsFromConfig);
  }
}

export class InfrastructureWorkspaceFsFactory implements IWorkspaceFsFactory {
  constructor(private readonly workspaceRoot: string) {}

  async create(agentId: string, permissions: PermissionConfig | undefined): Promise<IWorkspaceFs> {
    return createWorkspaceFs(this.workspaceRoot, agentId, permissions);
  }
}
