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
