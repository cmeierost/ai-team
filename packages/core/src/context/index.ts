/**
 * Context manager - handles file permissions and context control
 */

import { minimatch } from 'minimatch';
import type { AccessEngine, AccessVerdict } from '@ai-team/access';
import {
  Agent,
  ContextLevel,
  FileTreeConfig,
  PermissionConfig,
  PermissionError,
} from '../types/index.js';
import { normalizeWorkspaceRelativePath, toWorkspaceRelativePath } from '../storage/path-safety.js';

/** A file annotated with its read/write permission state for a specific agent */
export interface AnnotatedFile {
  /** Workspace-relative path */
  path: string;
  /** Whether the agent can read this file */
  readable: boolean;
  /** Whether the agent can write this file */
  writable: boolean;
}

/** Global workspace-level permission overrides loaded from config.json fileTree */
export interface GlobalPermissions {
  readPaths: string[];
  writePaths: string[];
  createPaths: string[];
  deletePaths: string[];
}

export class ContextManager {
  private readonly workspaceRoot: string;
  private readonly globalPerms: GlobalPermissions;
  private readonly patternMatchCache = new Map<string, boolean>();

  /**
   * Optional AccessEngine. When provided, canRead/canWrite/canCreate/canDelete
   * delegate to the engine for richer verdicts and delegation support.
   */
  readonly engine?: AccessEngine;

  /**
   * @param workspaceRoot - Absolute workspace root
   * @param globalPerms - Optional global read/write patterns from config.json fileTree.
   *                       When provided, these patterns are merged with every agent's permissions.
   * @param engine - Optional AccessEngine for delegated evaluation.
   */
  constructor(workspaceRoot: string, globalPerms?: GlobalPermissions, engine?: AccessEngine) {
    this.workspaceRoot = workspaceRoot;
    this.globalPerms = globalPerms ?? {
      readPaths: [],
      writePaths: [],
      createPaths: [],
      deletePaths: [],
    };
    this.engine = engine;
  }

  /**
   * Create a ContextManager pre-loaded with global permissions from a FileTreeConfig.
   */
  static fromConfig(
    workspaceRoot: string,
    fileTreeConfig?: FileTreeConfig,
    engine?: AccessEngine,
  ): ContextManager {
    return new ContextManager(
      workspaceRoot,
      {
        readPaths: fileTreeConfig?.readPaths ?? [],
        writePaths: fileTreeConfig?.writePaths ?? [],
        createPaths: fileTreeConfig?.createPaths ?? [],
        deletePaths: fileTreeConfig?.deletePaths ?? [],
      },
      engine,
    );
  }

  /**
   * Check if an agent has read permission for a file (agent + global patterns)
   * @param agent - Agent to check permissions for
   * @param filePath - Absolute or workspace-relative file path
   * @returns True if agent can read the file
   */
  canRead(agent: Agent, filePath: string): boolean {
    if (this.engine) {
      return this.checkViaEngine(agent, filePath, 'read');
    }

    const relativePath = this.getRelativePath(filePath);
    if (relativePath === null) return false;

    // Write permission always implies read permission.
    if (this.canWrite(agent, filePath)) return true;

    // Global read patterns
    if (this.matchesPatterns(relativePath, this.globalPerms.readPaths)) return true;
    // Agent-level read patterns
    if (agent.permissions && this.matchesPatterns(relativePath, agent.permissions.read)) return true;
    return false;
  }

  /**
   * Check if an agent has write permission for a file (agent + global patterns)
   * @param agent - Agent to check permissions for
   * @param filePath - Absolute or workspace-relative file path
   * @returns True if agent can write the file
   */
  canWrite(agent: Agent, filePath: string): boolean {
    if (this.engine) {
      return this.checkViaEngine(agent, filePath, 'write');
    }

    const relativePath = this.getRelativePath(filePath);
    if (relativePath === null) return false;
    // Global write patterns
    if (this.matchesPatterns(relativePath, this.globalPerms.writePaths)) return true;
    // Agent-level write patterns
    if (agent.permissions && this.matchesPatterns(relativePath, agent.permissions.write)) return true;
    return false;
  }

  canCreate(agent: Agent, filePath: string): boolean {
    if (this.engine) {
      return this.checkViaEngine(agent, filePath, 'create');
    }

    const relativePath = this.getRelativePath(filePath);
    if (relativePath === null) return false;
    if (this.matchesPatterns(relativePath, this.globalPerms.createPaths)) return true;
    if (agent.permissions && this.matchesPatterns(relativePath, agent.permissions.create ?? [])) return true;
    return false;
  }

  canDelete(agent: Agent, filePath: string): boolean {
    if (this.engine) {
      return this.checkViaEngine(agent, filePath, 'delete');
    }

    const relativePath = this.getRelativePath(filePath);
    if (relativePath === null) return false;
    if (this.matchesPatterns(relativePath, this.globalPerms.deletePaths)) return true;
    if (agent.permissions && this.matchesPatterns(relativePath, agent.permissions.delete ?? [])) return true;
    return false;
  }

  /**
   * Assert that an agent has read permission (throws if not)
   * @param agent - Agent to check
   * @param filePath - File path
   * @throws {PermissionError} If agent lacks permission
   */
  assertCanRead(agent: Agent, filePath: string): void {
    if (!this.canRead(agent, filePath)) {
      throw new PermissionError(agent.id, filePath);
    }
  }

  /**
   * Assert that an agent has write permission (throws if not)
   * @param agent - Agent to check
   * @param filePath - File path
   * @throws {PermissionError} If agent lacks permission
   */
  assertCanWrite(agent: Agent, filePath: string): void {
    if (!this.canWrite(agent, filePath)) {
      throw new PermissionError(agent.id, filePath);
    }
  }

  /**
   * Get all files an agent can read
   * @param agent - Agent
   * @param allFiles - List of all files in workspace
   * @returns Filtered list of readable files
   */
  getReadableFiles(agent: Agent, allFiles: string[]): string[] {
    return allFiles.filter(file => this.canRead(agent, file));
  }

  /**
   * Get all files an agent can write
   * @param agent - Agent
   * @param allFiles - List of all files in workspace
   * @returns Filtered list of writable files
   */
  getWritableFiles(agent: Agent, allFiles: string[]): string[] {
    return allFiles.filter(file => this.canWrite(agent, file));
  }

  /**
   * Annotate every file with its read/write permissions for a given agent.
   * @param agent - Agent to check permissions for
   * @param allFiles - Workspace-relative file paths
   * @returns Annotated list with per-file read + write booleans
   */
  getAnnotatedFiles(agent: Agent, allFiles: string[]): AnnotatedFile[] {
    return allFiles.map(filePath => ({
      path: filePath,
      readable: this.canRead(agent, filePath),
      writable: this.canWrite(agent, filePath),
    }));
  }

  /**
   * Validate if an agent can write to all files in an edit proposal
   * @param agent - Agent proposing the edit
   * @param filePaths - List of file paths to be modified
   * @returns Validation result with blocked files and suggestions
   */
  validateEditProposal(agent: Agent, filePaths: string[]): {
    allowed: boolean;
    blockedFiles: string[];
    message?: string;
  } {
    const blockedFiles: string[] = [];

    for (const filePath of filePaths) {
      if (!this.canWrite(agent, filePath)) {
        blockedFiles.push(filePath);
      }
    }

    if (blockedFiles.length === 0) {
      return { allowed: true, blockedFiles: [] };
    }

    return {
      allowed: false,
      blockedFiles,
      message: `Agent ${agent.id} cannot write to ${blockedFiles.length} file(s): ${blockedFiles.join(', ')}`,
    };
  }

  /**
   * Get permission guidance for a file - suggests which agents might have access
   * @param filePath - File path to check
   * @param allAgents - List of all agents in the team
   * @returns List of agents that can write to this file
   */
  getPermissionGuidance(filePath: string, allAgents: Agent[]): {
    canWrite: Agent[];
    suggestions: string[];
  } {
    const canWrite: Agent[] = [];
    const suggestions: string[] = [];

    for (const agent of allAgents) {
      if (this.canWrite(agent, filePath)) {
        canWrite.push(agent);
      }
    }

    if (canWrite.length === 0) {
      suggestions.push(
        'No agents currently have permission to modify this file.',
        'Consider expanding an existing agent\'s permissions or creating a new agent.'
      );
    } else if (canWrite.length === 1) {
      suggestions.push(
        `Only ${canWrite[0].name} (${canWrite[0].id}) can modify this file.`,
        'Consider delegating this task to that agent.'
      );
    } else {
      const names = canWrite.map(a => a.name).join(', ');
      suggestions.push(
        `${canWrite.length} agents can modify this file: ${names}`,
        'Consider delegating to one of these agents or coordinating with them.'
      );
    }

    return { canWrite, suggestions };
  }

  /**
   * Get a list of files from a proposal that the agent cannot write to
   * @param agent - Agent to check
   * @param filePaths - File paths in the proposal
   * @returns List of blocked files with details
   */
  getBlockedFiles(agent: Agent, filePaths: string[]): Array<{
    filePath: string;
    relativePath: string;
    reason: string;
  }> {
    const blocked: Array<{
      filePath: string;
      relativePath: string;
      reason: string;
    }> = [];

    for (const filePath of filePaths) {
      if (!this.canWrite(agent, filePath)) {
        const relativePath = this.getRelativePath(filePath) ?? normalizeWorkspaceRelativePath(filePath);
        const writePatterns = agent.permissions?.write || [];

        const reason = writePatterns.length === 0
          ? 'Agent has no write permissions configured'
          : `File does not match any write patterns: ${writePatterns.join(', ')}`;

        blocked.push({
          filePath,
          relativePath,
          reason,
        });
      }
    }

    return blocked;
  }

  /**
   * Generate default permissions based on context level
   * @param contextLevel - Agent's context level
   * @param features - Agent's assigned features
   * @returns Default permission configuration
   */
  generateDefaultPermissions(
    contextLevel: ContextLevel,
    features?: string[]
  ): PermissionConfig {
    switch (contextLevel) {
      case ContextLevel.TASK:
        // Junior dev - only assigned files (must be explicitly granted)
        return {
          read: [],
          write: [],
          create: [],
          delete: [],
        };

      case ContextLevel.MODULE:
        // Senior dev - specific modules
        return {
          read: features?.map(f => `${f}/**/*`) || [],
          write: features?.map(f => `${f}/**/*`) || [],
          create: features?.map(f => `${f}/**/*`) || [],
          delete: [],
        };

      case ContextLevel.FEATURE:
        // Team lead - feature areas + related tests/docs
        return {
          read: [
            ...(features?.map(f => `${f}/**/*`) || []),
            'docs/**/*',
            'tests/**/*',
          ],
          write: features?.map(f => `${f}/**/*`) || [],
          create: features?.map(f => `${f}/**/*`) || [],
          delete: [],
        };

      case ContextLevel.REPOSITORY:
        // Architect - read entire codebase, write to architecture docs
        return {
          read: ['**/*'],
          write: [
            'docs/architecture/**/*',
            'docs/design/**/*',
            '.ai-team/**/*',
          ],
          create: [
            'docs/architecture/**/*',
            'docs/design/**/*',
            '.ai-team/**/*',
          ],
          delete: [],
        };

      case ContextLevel.ORGANIZATION:
        // Executive - strategic docs only
        return {
          read: [
            'README.md',
            'docs/**/*',
            '.ai-team/**/*',
          ],
          write: [
            '.ai-team/meetings/**/*',
            '**/agent.md',
            '**/*.agent.md',
          ],
          create: [
            '.ai-team/meetings/**/*',
            '.ai-team/agents/**/*',
          ],
          delete: [],
          manage_agents: true,
        };

      default:
        return { read: [], write: [], create: [], delete: [] };
    }
  }

  // ── AccessEngine delegation ────────────────────────────────────

  /**
   * Delegate a single-path permission check to the AccessEngine.
   * Used internally by canRead/canWrite/canCreate/canDelete when an engine is present.
   */
  private checkViaEngine(agent: Agent, filePath: string, right: 'read' | 'write' | 'create' | 'delete'): boolean {
    const verdict = this.engine!.checkPath(filePath, right, this.workspaceRoot, agent.id);
    return verdict.allowed;
  }

  /**
   * Return a full AccessVerdict for a single-path check via the engine.
   * Useful for callers that need alternative-context information.
   * Returns undefined when no engine is configured.
   */
  checkPathDetailed(agent: Agent, filePath: string, right: 'read' | 'write' | 'create' | 'delete'): AccessVerdict | undefined {
    if (!this.engine) return undefined;
    return this.engine.checkPath(filePath, right, this.workspaceRoot, agent.id);
  }

  /**
   * Convert absolute path to workspace-relative path
   */
  private getRelativePath(absolutePath: string): string | null {
    return toWorkspaceRelativePath(this.workspaceRoot, absolutePath);
  }

  /**
   * Check if a path matches any of the given glob patterns
   */
  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    if (patterns.length === 0) return false;

    const normalizedFilePath = normalizeWorkspaceRelativePath(filePath);
    return patterns.some((pattern) => {
      const normalizedPattern = normalizeWorkspaceRelativePath(pattern);
      const cacheKey = `${normalizedFilePath}\u0000${normalizedPattern}`;
      const cached = this.patternMatchCache.get(cacheKey);
      if (cached !== undefined) return cached;

      const matched = minimatch(normalizedFilePath, normalizedPattern);
      this.patternMatchCache.set(cacheKey, matched);
      return matched;
    });
  }
}
