/**
 * Context manager - handles file permissions and context control
 */

import { minimatch } from 'minimatch';
import path from 'path';
import {
  Agent,
  ContextLevel,
  PermissionConfig,
  PermissionError,
} from '../types/index.js';

/** A file annotated with its read/write permission state for a specific agent */
export interface AnnotatedFile {
  /** Workspace-relative path */
  path: string;
  /** Whether the agent can read this file */
  readable: boolean;
  /** Whether the agent can write this file */
  writable: boolean;
}

export class ContextManager {
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
  }

  /**
   * Check if an agent has read permission for a file
   * @param agent - Agent to check permissions for
   * @param filePath - Absolute file path
   * @returns True if agent can read the file
   */
  canRead(agent: Agent, filePath: string): boolean {
    if (!agent.permissions) {
      return false;
    }

    const relativePath = this.getRelativePath(filePath);
    return this.matchesPatterns(relativePath, agent.permissions.read);
  }

  /**
   * Check if an agent has write permission for a file
   * @param agent - Agent to check permissions for
   * @param filePath - Absolute file path
   * @returns True if agent can write the file
   */
  canWrite(agent: Agent, filePath: string): boolean {
    if (!agent.permissions) {
      return false;
    }

    const relativePath = this.getRelativePath(filePath);
    return this.matchesPatterns(relativePath, agent.permissions.write);
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
      suggestions.push('No agents currently have permission to modify this file.');
      suggestions.push('Consider expanding an existing agent\'s permissions or creating a new agent.');
    } else if (canWrite.length === 1) {
      suggestions.push(`Only ${canWrite[0].name} (${canWrite[0].id}) can modify this file.`);
      suggestions.push('Consider delegating this task to that agent.');
    } else {
      const names = canWrite.map(a => a.name).join(', ');
      suggestions.push(`${canWrite.length} agents can modify this file: ${names}`);
      suggestions.push('Consider delegating to one of these agents or coordinating with them.');
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
        const relativePath = this.getRelativePath(filePath);
        const writePatterns = agent.permissions?.write || [];

        let reason = 'No write patterns match this file';
        if (writePatterns.length === 0) {
          reason = 'Agent has no write permissions configured';
        } else {
          reason = `File does not match any write patterns: ${writePatterns.join(', ')}`;
        }

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
        };

      case ContextLevel.MODULE:
        // Senior dev - specific modules
        return {
          read: features?.map(f => `${f}/**/*`) || [],
          write: features?.map(f => `${f}/**/*`) || [],
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
            '.ai-team/agents/**/*',
          ],
          manage_agents: true,
        };

      default:
        return { read: [], write: [] };
    }
  }

  /**
   * Convert absolute path to workspace-relative path
   */
  private getRelativePath(absolutePath: string): string {
    return path.relative(this.workspaceRoot, absolutePath);
  }

  /**
   * Check if a path matches any of the given glob patterns
   */
  private matchesPatterns(filePath: string, patterns: string[]): boolean {
    return patterns.some(pattern => minimatch(filePath, pattern));
  }
}
