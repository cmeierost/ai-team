/**
 * Tool system - defines tools that agents can use
 * Mirrors VS Code Copilot capabilities (Feb 2026)
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { glob } from 'glob';
import { minimatch } from 'minimatch';
import { z } from 'zod';
import {
  getFileTree,
  listWorkspaceFiles,
  resolveInsideWorkspace,
  toWorkspaceRelativePath,
  type FileTreeNode,
} from '@ai-team/fs';
import {
  AgentTool,
  ToolContext,
} from '../types/index.js';
import { ContextManager } from '../context/index.js';
import { loadAgent, loadTeamConfig, saveAgent } from '../storage/index.js';
import { AgentManager } from '../agent/index.js';
import {
  downloadRandomAvatar,
  generateAvatarWithAI,
  buildAvatarPrompt,
  saveAvatarPreview,
  finalizeAvatar,
  updateAgentAvatar,
} from '../avatar/index.js';

const execFileAsync = promisify(execFile);

const DEFAULT_TOOL_TIMEOUT_MS = 60_000;
const MAX_SEMANTIC_FILE_SIZE_BYTES = 200_000;

export interface ToolExecutionRequest {
  toolName: string;
  params: unknown;
  context: ToolContext;
}

export interface ToolExecutionResult {
  ok: boolean;
  toolName: string;
  result?: unknown;
  error?: string;
}

export interface ToolExecutionOptions {
  timeoutMs?: number;
  onBeforeExecute?: (request: ToolExecutionRequest) => Promise<boolean> | boolean;
}

interface FsPathAccessEnvelope {
  allowed: boolean;
  deniedByIgnore?: boolean;
  blockedByPatterns?: string[];
  explanation: string;
  alternativeContexts: Array<{ contextId: string; allowedPaths: string[] }>;
}

function getAccessEngineOrDeny(context: ToolContext): { ok: true } | { ok: false; reason: string } {
  if (context.accessEngine) return { ok: true };
  return {
    ok: false,
    reason: 'AccessEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/access.',
  };
}

function canListViaAccessEngine(context: ToolContext, targetPath: string): boolean {
  if (!context.accessEngine) return false;
  return context.accessEngine.checkPath(
    targetPath,
    'list',
    context.workspaceRoot,
    context.agent.id,
  ).allowed;
}

function filterTreeByListAccess(context: ToolContext, node: FileTreeNode): FileTreeNode | null {
  const nodePath = node.relativePath || '.';
  if (!canListViaAccessEngine(context, nodePath)) {
    return null;
  }

  if (!node.children || node.children.length === 0) {
    return node;
  }

  const filteredChildren = node.children
    .map((child) => filterTreeByListAccess(context, child))
    .filter((child): child is FileTreeNode => child !== null);

  return {
    ...node,
    children: filteredChildren,
  };
}

function toFsPathAccessEnvelope(
  context: ToolContext,
  toolName:
    | 'fs_read_file'
    | 'fs_read_lines'
    | 'fs_write_file'
    | 'fs_create_file'
    | 'fs_delete_path'
    | 'fs_mkdir'
    | 'fs_exists'
    | 'fs_info'
    | 'fs_list'
    | 'fs_tree'
    | 'fs_search_content'
    | 'fs_search_metadata',
  targetPath: string,
): FsPathAccessEnvelope {
  if (!context.accessEngine) {
    return {
      allowed: false,
      explanation: 'AccessEngine is required for fs_* tools so all access patterns are evaluated by @ai-team/access.',
      alternativeContexts: [],
    };
  }

  const args =
    toolName === 'fs_read_file'
    || toolName === 'fs_read_lines'
    || toolName === 'fs_write_file'
    || toolName === 'fs_create_file'
      ? { filePath: targetPath }
      : { path: targetPath };

  const verdict = context.accessEngine.checkToolCall(toolName, args, context.workspaceRoot, context.agent.id);

  const blockedByPatterns = Array.from(
    new Set(
      verdict.paths
        .filter((pv) => !pv.allowed && pv.deniedBy?.pathPattern)
        .map((pv) => pv.deniedBy!.pathPattern),
    ),
  );

  return {
    allowed: verdict.allowed,
    deniedByIgnore: verdict.paths.some((pv) => pv.deniedByIgnore === true),
    blockedByPatterns,
    explanation: verdict.explanation,
    alternativeContexts: verdict.alternativeContexts.map((alt) => ({
      contextId: alt.contextId,
      allowedPaths: alt.allowedPaths,
    })),
  };
}

function resolveFsAbsolutePath(context: ToolContext, targetPath: string): string | null {
  return resolveInsideWorkspace(context.workspaceRoot, targetPath);
}

function toFsPathMeta(context: ToolContext, inputPath: string, absolutePath: string): {
  input: string;
  absolute: string;
  relative: string;
} {
  const relativePath = toWorkspaceRelativePath(context.workspaceRoot, absolutePath) ?? '';
  return {
    input: inputPath,
    absolute: absolutePath,
    relative: relativePath,
  };
}

const accessRightSchema = z.enum(['read', 'write', 'create', 'delete', 'list']);
type AccessRight = z.infer<typeof accessRightSchema>;

/**
 * Show which contexts can access a path for a given right.
 */
export const whoHasAccessTool: AgentTool = {
  name: 'who_has_access',
  description: 'Show which contexts/agents can access a path for a given right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath, right = 'list' } = params as { path: string; right?: AccessRight };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        right,
        contextIds: [],
        contexts: [],
        explanation: 'Path is outside workspace root.',
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        right,
        contextIds: [],
        contexts: [],
        explanation: engineCheck.reason,
      };
    }

    const contextIds = context.accessEngine!.whoCanAccess(targetPath, right, context.workspaceRoot);
    const contexts = contextIds.map((contextId) => ({
      contextId,
      label: context.accessEngine!.getContext(contextId)?.label,
    }));

    return {
      path: pathMeta,
      right,
      contextIds,
      contexts,
      explanation: contextIds.length > 0
        ? `${contextIds.length} context(s) can access this path with '${right}'.`
        : `No context can access this path with '${right}'.`,
    };
  },
};

/**
 * Check whether the current (or specified) context has access to a path/right.
 */
export const doIHaveAccessTool: AgentTool = {
  name: 'do_i_have_access',
  description: 'Check whether the current context (or an explicit context) has access to a path/right.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute workspace path to check'),
    right: accessRightSchema.optional().describe('Access right to evaluate (default: list)'),
    agentId: z.string().optional().describe('Optional context/agent ID override (defaults to current agent)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const {
      path: targetPath,
      right = 'list',
      agentId,
    } = params as { path: string; right?: AccessRight; agentId?: string };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        right,
        contextId: agentId || context.agent.id,
        allowed: false,
        allRights: [],
        explanation: 'Path is outside workspace root.',
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        right,
        contextId: agentId || context.agent.id,
        allowed: false,
        allRights: [],
        explanation: engineCheck.reason,
      };
    }

    const targetContextId = agentId || context.agent.id;
    const allRightsMap = context.accessEngine!.whatCanContextDo(targetContextId, [targetPath], context.workspaceRoot);
    const allRights = [...(allRightsMap.get(pathMeta.relative) ?? new Set<AccessRight>())];
    const verdict = context.accessEngine!.checkPath(targetPath, right, context.workspaceRoot, targetContextId);

    return {
      path: pathMeta,
      right,
      contextId: targetContextId,
      contextLabel: context.accessEngine!.getContext(targetContextId)?.label,
      allowed: verdict.allowed,
      allRights,
      explanation: verdict.explanation,
      alternativeContexts: verdict.alternativeContexts,
      deniedByIgnore: verdict.paths.some((pv) => pv.deniedByIgnore === true),
      blockedByPatterns: Array.from(new Set(
        verdict.paths
          .filter((pv) => !pv.allowed && pv.deniedBy?.pathPattern)
          .map((pv) => pv.deniedBy!.pathPattern),
      )),
    };
  },
};

// ============================================================================
// Core File Tools
// ============================================================================

/**
 * Read file contents with permission checking
 */
export const readFileTool: AgentTool = {
  name: 'read_file',
  description: 'Read contents of a file. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().optional().describe('1-based line number to start reading from'),
    endLine: z.number().optional().describe('1-based line number to end reading at'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, startLine, endLine } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanRead(context.agent, absolutePath);

    const content = await fs.readFile(absolutePath, 'utf-8');
    
    if (startLine !== undefined && endLine !== undefined) {
      const lines = content.split('\n');
      return lines.slice(startLine - 1, endLine).join('\n');
    }
    
    return content;
  },
};

/**
 * Search for files by glob pattern
 */
export const fileSearchTool: AgentTool = {
  name: 'file_search',
  description: 'Find files matching a glob pattern. Returns only files the agent has permission to read.',
  parameters: z.object({
    pattern: z.string().describe('Glob pattern to match files'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { pattern, maxResults = 100 } = params as any;
    
    const files = await glob(pattern, {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    return readableFiles.slice(0, maxResults);
  },
};

/**
 * Write or modify file contents
 */
export const writeFileTool: AgentTool = {
  name: 'write_file',
  description: 'Write or modify file contents. Requires write permission.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('New file content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context: ToolContext) {
    const { filePath, content, createDirectories = false } = params as any;
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);

    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanWrite(context.agent, absolutePath);

    if (createDirectories) {
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    }

    await fs.writeFile(absolutePath, content, 'utf-8');
    return { success: true, path: absolutePath };
  },
};

/**
 * Check whether a path exists with list-right access mediation.
 */
export const fsExistsTool: AgentTool = {
  name: 'fs_exists',
  description: 'Check whether a file or directory exists. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath } = params as { path: string };
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(context.workspaceRoot, targetPath);
    const relativePath = path.relative(context.workspaceRoot, absolutePath).replaceAll('\\', '/');

    if (!engineCheck.ok) {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        access: {
          allowed: false,
          explanation: engineCheck.reason,
          alternativeContexts: [],
        },
        delegation: {
          possible: false,
          contexts: [],
          unassignable: true,
        },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_exists', targetPath);
    if (!access.allowed) {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      await fs.stat(absolutePath);
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: true,
        access,
        delegation: {
          possible: false,
          contexts: [],
          unassignable: false,
        },
      };
    } catch {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        access,
        delegation: {
          possible: false,
          contexts: [],
          unassignable: false,
        },
      };
    }
  },
};

/**
 * Return path metadata with list-right access mediation.
 */
export const fsInfoTool: AgentTool = {
  name: 'fs_info',
  description: 'Get file/directory metadata and access envelope. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath } = params as { path: string };
    const absolutePath = path.isAbsolute(targetPath)
      ? targetPath
      : path.join(context.workspaceRoot, targetPath);
    const relativePath = path.relative(context.workspaceRoot, absolutePath).replaceAll('\\', '/');

    if (!engineCheck.ok) {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        info: null,
        access: {
          allowed: false,
          explanation: engineCheck.reason,
          alternativeContexts: [],
        },
        delegation: {
          possible: false,
          contexts: [],
          unassignable: true,
        },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_info', targetPath);
    if (!access.allowed) {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        info: null,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      const stats = await fs.stat(absolutePath);
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: true,
        info: {
          type: stats.isDirectory() ? 'directory' : stats.isFile() ? 'file' : 'other',
          size: stats.size,
          modifiedAt: stats.mtime.toISOString(),
          createdAt: stats.birthtime.toISOString(),
        },
        access,
        delegation: {
          possible: false,
          contexts: [],
          unassignable: false,
        },
      };
    } catch {
      return {
        path: {
          input: targetPath,
          absolute: absolutePath,
          relative: relativePath,
        },
        exists: false,
        info: null,
        access,
        delegation: {
          possible: false,
          contexts: [],
          unassignable: false,
        },
      };
    }
  },
};

/**
 * Read file contents through @ai-team/access (read right).
 */
export const fsReadFileTool: AgentTool = {
  name: 'fs_read_file',
  description: 'Read a file through @ai-team/access with structured access metadata.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    encoding: z.enum(['utf8']).optional().describe('Text encoding (default utf8)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { filePath, encoding = 'utf8' } = params as { filePath: string; encoding?: BufferEncoding };
    const absolutePath = resolveFsAbsolutePath(context, filePath);

    if (!absolutePath) {
      return {
        path: { input: filePath, absolute: '', relative: '' },
        content: null,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, filePath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        content: null,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_read_file', filePath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        content: null,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      const content = await fs.readFile(absolutePath, encoding);
      return {
        path: pathMeta,
        content,
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        content: null,
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Read a line range from a file through @ai-team/access (read right).
 */
export const fsReadLinesTool: AgentTool = {
  name: 'fs_read_lines',
  description: 'Read specific lines from a file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based start line'),
    endLine: z.number().int().min(1).describe('1-based end line (inclusive)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { filePath, startLine, endLine } = params as {
      filePath: string;
      startLine: number;
      endLine: number;
    };
    const absolutePath = resolveFsAbsolutePath(context, filePath);

    if (!absolutePath) {
      return {
        path: { input: filePath, absolute: '', relative: '' },
        lines: [],
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, filePath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        lines: [],
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_read_lines', filePath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        lines: [],
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      const content = await fs.readFile(absolutePath, 'utf8');
      const lines = content.split(/\r?\n/).slice(startLine - 1, endLine);
      return {
        path: pathMeta,
        startLine,
        endLine,
        lines,
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        lines: [],
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Write file contents through @ai-team/access (write right).
 */
export const fsWriteFileTool: AgentTool = {
  name: 'fs_write_file',
  description: 'Write file contents through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('File content to write'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { filePath, content, createDirectories = false } = params as {
      filePath: string;
      content: string;
      createDirectories?: boolean;
    };
    const absolutePath = resolveFsAbsolutePath(context, filePath);

    if (!absolutePath) {
      return {
        path: { input: filePath, absolute: '', relative: '' },
        written: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, filePath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        written: false,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_write_file', filePath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        written: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      if (createDirectories) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }
      await fs.writeFile(absolutePath, content, 'utf8');
      return {
        path: pathMeta,
        written: true,
        bytes: Buffer.byteLength(content, 'utf8'),
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        written: false,
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Create a new file through @ai-team/access (create right).
 */
export const fsCreateFileTool: AgentTool = {
  name: 'fs_create_file',
  description: 'Create a new file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { filePath, content = '', createDirectories = false } = params as {
      filePath: string;
      content?: string;
      createDirectories?: boolean;
    };
    const absolutePath = resolveFsAbsolutePath(context, filePath);

    if (!absolutePath) {
      return {
        path: { input: filePath, absolute: '', relative: '' },
        created: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, filePath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        created: false,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_create_file', filePath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        created: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      if (createDirectories) {
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      }
      await fs.writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' });
      return {
        path: pathMeta,
        created: true,
        bytes: Buffer.byteLength(content, 'utf8'),
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        created: false,
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Delete a file or directory through @ai-team/access (delete right).
 */
export const fsDeletePathTool: AgentTool = {
  name: 'fs_delete_path',
  description: 'Delete a file or directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        deleted: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        deleted: false,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_delete_path', targetPath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        deleted: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      await fs.rm(absolutePath, { recursive, force: false });
      return {
        path: pathMeta,
        deleted: true,
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        deleted: false,
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * Create a directory through @ai-team/access (create right).
 */
export const fsMkdirTool: AgentTool = {
  name: 'fs_mkdir',
  description: 'Create a directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    const absolutePath = resolveFsAbsolutePath(context, targetPath);

    if (!absolutePath) {
      return {
        path: { input: targetPath, absolute: '', relative: '' },
        created: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      };
    }

    const pathMeta = toFsPathMeta(context, targetPath, absolutePath);
    if (!engineCheck.ok) {
      return {
        path: pathMeta,
        created: false,
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const access = toFsPathAccessEnvelope(context, 'fs_mkdir', targetPath);
    if (!access.allowed) {
      return {
        path: pathMeta,
        created: false,
        access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      };
    }

    try {
      await fs.mkdir(absolutePath, { recursive });
      return {
        path: pathMeta,
        created: true,
        access,
      };
    } catch (error) {
      return {
        path: pathMeta,
        created: false,
        access,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};

/**
 * List directory entries through @ai-team/access (list right).
 */
export const fsListTool: AgentTool = {
  name: 'fs_list',
  description: 'List directory entries through @ai-team/access.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    includeHidden: z.boolean().optional().describe('Include hidden entries'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath = '.', includeHidden = false } = params as {
      path?: string;
      includeHidden?: boolean;
    };

    if (!engineCheck.ok) {
      return {
        path: targetPath,
        entries: [],
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const rootAccess = toFsPathAccessEnvelope(context, 'fs_list', targetPath);
    if (!rootAccess.allowed) {
      return {
        path: targetPath,
        entries: [],
        access: rootAccess,
        delegation: {
          possible: rootAccess.alternativeContexts.length > 0,
          contexts: rootAccess.alternativeContexts,
          unassignable: rootAccess.alternativeContexts.length === 0,
        },
      };
    }

    const tree = await getFileTree(context.workspaceRoot, {
      rootSubPath: targetPath,
      maxDepth: 1,
      includeHidden,
    });
    const children = tree.children ?? [];

    const entries = children
      .filter((child) => canListViaAccessEngine(context, child.relativePath || '.'))
      .map((child) => ({
        path: child.relativePath,
        name: child.name,
        isDirectory: child.isDirectory,
        size: child.size,
        modified: child.modified,
      }));

    return {
      path: targetPath,
      entries,
      access: rootAccess,
      delegation: {
        possible: false,
        contexts: [],
        unassignable: false,
      },
    };
  },
};

/**
 * Build a filtered workspace tree where every visible node passes @ai-team/access list checks.
 */
export const fsTreeTool: AgentTool = {
  name: 'fs_tree',
  description: 'Build directory tree with access checks enforced by @ai-team/access for all returned nodes.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxDepth: z.number().int().min(0).max(64).optional().describe('Maximum recursion depth (default 6)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const { path: targetPath = '.', maxDepth = 6, includeHidden = false } = params as {
      path?: string;
      maxDepth?: number;
      includeHidden?: boolean;
    };

    if (!engineCheck.ok) {
      return {
        path: targetPath,
        tree: null,
        access: {
          allowed: false,
          explanation: engineCheck.reason,
          alternativeContexts: [],
        },
      };
    }

    const rootAccess = toFsPathAccessEnvelope(context, 'fs_tree', targetPath);
    if (!rootAccess.allowed) {
      return {
        path: targetPath,
        tree: null,
        access: rootAccess,
        delegation: {
          possible: rootAccess.alternativeContexts.length > 0,
          contexts: rootAccess.alternativeContexts,
          unassignable: rootAccess.alternativeContexts.length === 0,
        },
      };
    }

    const rawTree = await getFileTree(context.workspaceRoot, {
      rootSubPath: targetPath,
      maxDepth,
      includeHidden,
    });
    const filteredTree = filterTreeByListAccess(context, rawTree);

    return {
      path: targetPath,
      tree: filteredTree,
      access: rootAccess,
      delegation: {
        possible: false,
        contexts: [],
        unassignable: false,
      },
    };
  },
};

/**
 * Search file contents with line-number results, filtering every candidate via list checks in @ai-team/access.
 */
export const fsSearchContentTool: AgentTool = {
  name: 'fs_search_content',
  description: 'Search file contents under a path. Every candidate path is checked through @ai-team/access.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Text to search for'),
    maxResults: z.number().int().min(1).max(500).optional().describe('Maximum number of matches to return'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const {
      path: targetPath = '.',
      query,
      maxResults = 100,
      caseSensitive = false,
    } = params as { path?: string; query: string; maxResults?: number; caseSensitive?: boolean };

    if (!engineCheck.ok) {
      return {
        path: targetPath,
        matches: [],
        access: {
          allowed: false,
          explanation: engineCheck.reason,
          alternativeContexts: [],
        },
      };
    }

    const rootAccess = toFsPathAccessEnvelope(context, 'fs_search_content', targetPath);
    if (!rootAccess.allowed) {
      return {
        path: targetPath,
        matches: [],
        access: rootAccess,
        delegation: {
          possible: rootAccess.alternativeContexts.length > 0,
          contexts: rootAccess.alternativeContexts,
          unassignable: rootAccess.alternativeContexts.length === 0,
        },
      };
    }

    const files = await listWorkspaceFiles(context.workspaceRoot, {
      rootSubPath: targetPath,
      filesOnly: true,
      maxDepth: 20,
    });

    const { GrepSearch } = await import('../code-analysis/index.js');
    const grep = new GrepSearch();
    const allFilePaths = files.map((file) => file.path);

    // Search first (workspace scope), then filter by AccessEngine list rights.
    const rawMatches = await grep.searchFiles(allFilePaths, query, {
      caseInsensitive: !caseSensitive,
    });

    const matches: Array<{ path: string; line: number; content: string }> = [];
    for (const match of rawMatches) {
      const relativePath = path.relative(context.workspaceRoot, match.filePath).replaceAll('\\', '/');
      if (!canListViaAccessEngine(context, relativePath)) continue;

      matches.push({
        path: relativePath,
        line: match.line,
        content: match.lineText,
      });

      if (matches.length >= maxResults) break;
    }

    return {
      path: targetPath,
      query,
      matches,
      access: rootAccess,
      delegation: {
        possible: false,
        contexts: [],
        unassignable: false,
      },
    };
  },
};

/**
 * Search metadata/path names, filtering every candidate via list checks in @ai-team/access.
 */
export const fsSearchMetadataTool: AgentTool = {
  name: 'fs_search_metadata',
  description: 'Search file metadata/path names under a path with @ai-team/access checks for all candidates.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Substring to match in file/directory names or paths'),
    maxResults: z.number().int().min(1).max(1000).optional().describe('Maximum number of matches to return'),
    includeDirectories: z.boolean().optional().describe('Include directory entries in results (default true)'),
  }),
  async execute(params, context: ToolContext) {
    const engineCheck = getAccessEngineOrDeny(context);
    const {
      path: targetPath = '.',
      query,
      maxResults = 200,
      includeDirectories = true,
    } = params as { path?: string; query: string; maxResults?: number; includeDirectories?: boolean };

    if (!engineCheck.ok) {
      return {
        path: targetPath,
        matches: [],
        access: {
          allowed: false,
          explanation: engineCheck.reason,
          alternativeContexts: [],
        },
      };
    }

    const rootAccess = toFsPathAccessEnvelope(context, 'fs_search_metadata', targetPath);
    if (!rootAccess.allowed) {
      return {
        path: targetPath,
        matches: [],
        access: rootAccess,
        delegation: {
          possible: rootAccess.alternativeContexts.length > 0,
          contexts: rootAccess.alternativeContexts,
          unassignable: rootAccess.alternativeContexts.length === 0,
        },
      };
    }

    const entries = await listWorkspaceFiles(context.workspaceRoot, {
      rootSubPath: targetPath,
      filesOnly: !includeDirectories,
      maxDepth: 20,
    });

    const needle = query.toLowerCase();
    const prefiltered = entries.filter((entry) => {
      const name = entry.name.toLowerCase();
      const rel = entry.relativePath.toLowerCase();
      return name.includes(needle) || rel.includes(needle);
    });

    const matches: Array<{ path: string; name: string; isDirectory: boolean; size?: number }> = [];
    for (const entry of prefiltered) {
      if (!canListViaAccessEngine(context, entry.relativePath)) continue;

      matches.push({
        path: entry.relativePath,
        name: entry.name,
        isDirectory: entry.isDirectory,
        size: entry.size,
      });

      if (matches.length >= maxResults) break;
    }

    return {
      path: targetPath,
      query,
      matches,
      access: rootAccess,
      delegation: {
        possible: false,
        contexts: [],
        unassignable: false,
      },
    };
  },
};

// ============================================================================
// Search & Analysis Tools
// ============================================================================

/**
 * Semantic search across codebase (placeholder - would integrate with vector DB)
 */
export const semanticSearchTool: AgentTool = {
  name: 'semantic_search',
  description: 'Search codebase semantically for relevant code and documentation.',
  parameters: z.object({
    query: z.string().describe('Natural language search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  async execute(params, context: ToolContext) {
    const { query, maxResults = 10 } = params as { query: string; maxResults?: number };

    const files = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}', {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    });

    const contextManager = new ContextManager(context.workspaceRoot);
    const readableFiles = contextManager.getReadableFiles(context.agent, files);

    const tokens: string[] = query
      .toLowerCase()
      .split(/[^a-z0-9_\-/]+/)
      .map((part: string) => part.trim())
      .filter((part: string) => part.length >= 2);

    const scored: Array<{ filePath: string; score: number; snippet: string }> = [];

    for (const filePath of readableFiles) {
      let stat;
      try {
        stat = await fs.stat(filePath);
      } catch {
        continue;
      }

      if (!stat.isFile() || stat.size > MAX_SEMANTIC_FILE_SIZE_BYTES) {
        continue;
      }

      let content: string;
      try {
        content = await fs.readFile(filePath, 'utf-8');
      } catch {
        continue;
      }

      const lower = content.toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (lower.includes(token)) {
          score += 1;
        }
      }

      if (score === 0) {
        continue;
      }

      const firstToken = tokens.find((token: string) => lower.includes(token));
      const tokenIndex = firstToken ? lower.indexOf(firstToken) : 0;
      const snippetStart = Math.max(0, tokenIndex - 120);
      const snippetEnd = Math.min(content.length, tokenIndex + 220);
      const snippet = content.slice(snippetStart, snippetEnd).trim();

      scored.push({
        filePath,
        score,
        snippet,
      });
    }

    scored.sort((a, b) => b.score - a.score);

    return {
      query,
      results: scored.slice(0, maxResults).map(entry => ({
        filePath: entry.filePath,
        score: entry.score,
        snippet: entry.snippet,
      })),
    };
  },
};

/**
 * Get compiler/linter errors
 */
export const getErrorsTool: AgentTool = {
  name: 'get_errors',
  description: 'Get compile or lint errors for specified files.',
  parameters: z.object({
    filePaths: z.array(z.string()).optional().describe('Files to check (omit for all files)'),
  }),
  async execute(params, context: ToolContext) {
    const { filePaths } = params as { filePaths?: string[] };
    const timeoutMs = 120_000;

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync('pnpm', ['-r', 'build'], {
        cwd: context.workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }),
      timeoutMs,
      `get_errors timed out after ${timeoutMs / 1000}s`,
    );

    const output = `${stdout}\n${stderr}`;
    const lines = output.split(/\r?\n/);

    const normalizedFilters = (filePaths || []).map(filePath => {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.join(context.workspaceRoot, filePath);
      return path.normalize(absolute);
    });

    const errors = lines
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter(line => /error\s+TS\d+|\berror\b/i.test(line))
      .filter(line => {
        if (normalizedFilters.length === 0) {
          return true;
        }

        const normalizedLine = path.normalize(line);
        return normalizedFilters.some(filterPath => normalizedLine.includes(filterPath));
      });

    return {
      errors,
    };
  },
};

// ============================================================================
// Agent Collaboration Tools
// ============================================================================

/**
 * Delegate task to another agent
 */
export const delegateToAgentTool: AgentTool = {
  name: 'delegate_to_agent',
  description: 'Delegate a task to another agent. Checks delegation permissions.',
  parameters: z.object({
    agentId: z.string().describe('Target agent ID'),
    task: z.string().describe('Task description'),
    context: z.array(z.string()).optional().describe('File paths for context'),
  }),
  async execute(params, context: ToolContext) {
    const { agentId, task, context: contextFiles } = params as any;
    
    // Check if agent can delegate to target
    if (!context.agent.delegatesTo?.includes(agentId)) {
      throw new Error(`Agent ${context.agent.id} cannot delegate to ${agentId}`);
    }

    return {
      delegatedTo: agentId,
      task,
      contextFiles,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Ask human for clarification
 */
export const askHumanTool: AgentTool = {
  name: 'ask_human',
  description: 'Ask the human developer a structured question. Supports input, confirm, select, checklist, and password modes.',
  parameters: z.object({
    question: z.string().min(1).describe('Question to ask the developer'),
    questionType: z.enum(['input', 'confirm', 'select', 'checklist', 'password']).optional().describe('Question mode (defaults to input)'),
    context: z.string().optional().describe('Optional additional context shown with the question'),
    choices: z.array(z.object({
      name: z.string().min(1),
      value: z.string().min(1),
    })).optional().describe('Required for select/checklist modes'),
    default: z.union([z.string(), z.boolean(), z.array(z.string())]).optional().describe('Optional default answer'),
    mask: z.string().optional().describe('Optional mask character for password mode'),
    allowEmpty: z.boolean().optional().describe('Allow empty input for input mode'),
  }).superRefine((value, refinementCtx) => {
    const questionType = value.questionType ?? 'input';
    if ((questionType === 'select' || questionType === 'checklist') && (!value.choices || value.choices.length === 0)) {
      refinementCtx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `choices are required when questionType is '${questionType}'`,
      });
    }
  }),
  async execute(params, context: ToolContext) {
    const { question, context: additionalContext, questionType = 'input', choices } = params as any;
    
    return {
      question,
      questionType,
      context: additionalContext,
      choices,
      requestedBy: context.agent.id,
      timestamp: new Date().toISOString(),
    };
  },
};

export const askQuestionTool: AgentTool = {
  ...askHumanTool,
  name: 'ask_question',
};

/**
 * Register a CLI command for an employee so it can be executed via run_cli_tool.
 */
export const registerCliTool: AgentTool = {
  name: 'register_cli_tool',
  description: 'Allow this employee to run a command-line tool by executable name (e.g. git, pnpm, node).',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name to allow (no args, e.g. git)'),
    employee: z.string().optional().describe('Optional target employee name/id/role (defaults to current agent)'),
  }),
  async execute(params, context: ToolContext) {
    const { command, employee } = params as { command: string; employee?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const teamConfig = await loadTeamConfig(context.workspaceRoot);
    const allowedGlobal = teamConfig?.allowedCliTools;
    if (allowedGlobal && allowedGlobal.length > 0) {
      const normalizedGlobal = new Set(allowedGlobal.map(normalizeExecutableName).filter(Boolean) as string[]);
      if (!normalizedGlobal.has(normalized)) {
        throw new Error(`Command '${normalized}' is not in global allowedCliTools. Ask HR to add it to .ai-team/config.json first.`);
      }
    }

    let targetAgent = context.agent;
    if (employee && employee.trim().length > 0) {
      const agentManager = new AgentManager(context.workspaceRoot);
      await agentManager.initialize();
      const matches = agentManager.resolveAgent(employee.trim());

      if (matches.length === 0) {
        throw new Error(`No employee found matching '${employee}'.`);
      }
      if (matches.length > 1) {
        throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
      }

      const candidate = matches[0];
      const canManage = context.agent.permissions?.manage_agents === true;
      const isManager = candidate.reportsTo === context.agent.id;
      const isSelf = candidate.id === context.agent.id;

      if (!canManage && !isManager && !isSelf) {
        throw new Error(`Agent ${context.agent.id} cannot grant CLI tools for ${candidate.id}.`);
      }

      targetAgent = candidate;
    }

    const agentRecord = await loadAgent(targetAgent.filePath);
    const current = new Set((agentRecord.cliTools || []).map(entry => normalizeExecutableName(entry)).filter(Boolean) as string[]);
    current.add(normalized);

    agentRecord.cliTools = [...current].sort();
    await saveAgent(agentRecord);

    if (targetAgent.id === context.agent.id) {
      context.agent.cliTools = agentRecord.cliTools;
    }

    return {
      employee: targetAgent.id,
      command: normalized,
      cliTools: agentRecord.cliTools,
      persisted: true,
    };
  },
};

/**
 * Update an employee-specific LLM profile (provider/model/params).
 */
export const updateEmployeeLlmTool: AgentTool = {
  name: 'update_employee_llm',
  description: 'Update another employee\'s LLM profile (model, provider, and generation params).',
  parameters: z.object({
    employee: z.string().min(1).describe('Target employee name/id/role'),
    provider: z.string().optional(),
    modelKey: z.string().optional(),
    model: z.string().optional(),
    baseUrl: z.string().url().optional(),
    temperature: z.number().optional(),
    maxTokens: z.number().int().positive().optional(),
    topP: z.number().optional(),
    presencePenalty: z.number().optional(),
    frequencyPenalty: z.number().optional(),
    stop: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    const {
      employee,
      provider,
      modelKey,
      model,
      baseUrl,
      temperature,
      maxTokens,
      topP,
      presencePenalty,
      frequencyPenalty,
      stop,
    } = params as {
      employee: string;
      provider?: string;
      modelKey?: string;
      model?: string;
      baseUrl?: string;
      temperature?: number;
      maxTokens?: number;
      topP?: number;
      presencePenalty?: number;
      frequencyPenalty?: number;
      stop?: string[];
    };

    const agentManager = new AgentManager(context.workspaceRoot);
    await agentManager.initialize();
    const matches = agentManager.resolveAgent(employee.trim());
    if (matches.length === 0) {
      throw new Error(`No employee found matching '${employee}'.`);
    }
    if (matches.length > 1) {
      throw new Error(`Multiple employees match '${employee}'. Please be more specific.`);
    }

    const target = matches[0];
    const canManage = context.agent.permissions?.manage_agents === true;
    const isManager = target.reportsTo === context.agent.id;
    const isSelf = target.id === context.agent.id;
    if (!canManage && !isManager && !isSelf) {
      throw new Error(`Agent ${context.agent.id} cannot update LLM settings for ${target.id}.`);
    }

    const record = await loadAgent(target.filePath);
    const currentProfile = record.llm || {};
    const currentParams = currentProfile.params || {};

    const nextParams = {
      ...currentParams,
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(topP !== undefined ? { topP } : {}),
      ...(presencePenalty !== undefined ? { presencePenalty } : {}),
      ...(frequencyPenalty !== undefined ? { frequencyPenalty } : {}),
      ...(stop !== undefined ? { stop } : {}),
    };

    const nextProfile = {
      ...currentProfile,
      ...(provider !== undefined ? { provider } : {}),
      ...(modelKey !== undefined ? { modelKey } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      params: Object.keys(nextParams).length > 0 ? nextParams : undefined,
    };

    record.llm = nextProfile;
    await saveAgent(record);

    return {
      employee: target.id,
      llm: nextProfile,
      persisted: true,
    };
  },
};

/**
 * Run a CLI tool that was previously allowed for this employee.
 */
export const runCliTool: AgentTool = {
  name: 'run_cli_tool',
  description: 'Execute an allowed command-line tool with args. Command must be registered first via register_cli_tool.',
  parameters: z.object({
    command: z.string().min(1).describe('Executable name, for example git'),
    args: z.array(z.string()).optional().describe('Command arguments as array, for example ["status", "--short"]'),
    cwd: z.string().optional().describe('Optional relative working directory (defaults to workspace root)'),
  }),
  async execute(params, context: ToolContext) {
    const { command, args = [], cwd } = params as { command: string; args?: string[]; cwd?: string };
    const normalized = normalizeExecutableName(command);
    if (!normalized) {
      throw new Error('Invalid command name. Provide executable only (for example: git).');
    }

    const allowed = new Set((context.agent.cliTools || []).map(entry => normalizeExecutableName(entry)).filter(Boolean) as string[]);
    if (!allowed.has(normalized)) {
      throw new Error(`Command '${normalized}' is not allowed for ${context.agent.name}. Register it first with register_cli_tool.`);
    }

    const execCwd = cwd
      ? path.resolve(context.workspaceRoot, cwd)
      : context.workspaceRoot;

    enforceCommandAreaScope(context, execCwd);

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync(normalized, args, {
        cwd: execCwd,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }),
      60_000,
      `run_cli_tool timed out after 60s (${normalized})`,
    );

    return {
      command: normalized,
      args,
      cwd: execCwd,
      stdout: stdout.trim(),
      stderr: stderr.trim() || undefined,
    };
  },
};

function normalizeExecutableName(command: string): string | undefined {
  const trimmed = command.trim();
  if (!trimmed) {
    return undefined;
  }

  if (trimmed.includes(' ') || trimmed.includes('/') || trimmed.includes('\\')) {
    return undefined;
  }

  return trimmed.toLowerCase();
}

function enforceCommandAreaScope(context: ToolContext, execCwd: string): void {
  if (!path.resolve(execCwd).startsWith(path.resolve(context.workspaceRoot))) {
    throw new Error('run_cli_tool cwd must stay inside the workspace root.');
  }

  const readPatterns = context.agent.permissions?.read;
  if (!readPatterns || readPatterns.length === 0) {
    return;
  }

  const relative = path.relative(context.workspaceRoot, execCwd).replace(/\\/g, '/');
  const relativePath = relative.length === 0 ? '.' : relative;
  const isAllowed = readPatterns.some(pattern =>
    minimatch(relativePath, pattern)
    || minimatch(`${relativePath}/**/*`, pattern)
    || minimatch(relativePath, pattern.replace(/\/\*\*\/*\*$/, '')),
  );

  if (!isAllowed) {
    throw new Error(`Command cwd '${relativePath}' is outside ${context.agent.name}'s responsibility scope.`);
  }
}

// ============================================================================
// HR Tools (restricted to HR Director)
// ============================================================================

/**
 * Create a new agent
 */
export const createAgentTool: AgentTool = {
  name: 'create_agent',
  description: 'Create a new virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    name: z.string(),
    role: z.string(),
    contextLevel: z.string(),
    reportsTo: z.string().optional(),
    features: z.array(z.string()).optional(),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to create agents`);
    }

    // Placeholder: Would call AgentManager.createAgent()
    return {
      action: 'create_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Archive an agent
 */
export const archiveAgentTool: AgentTool = {
  name: 'archive_agent',
  description: 'Archive (offboard) a virtual team member. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().describe('Agent ID to archive'),
    reason: z.string().optional().describe('Reason for archiving'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to archive agents`);
    }

    return {
      action: 'archive_agent',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

/**
 * Assess agent performance
 */
export const assessPerformanceTool: AgentTool = {
  name: 'assess_performance',
  description: 'Analyze agent activity and performance metrics. Requires manage_agents permission.',
  parameters: z.object({
    agentId: z.string().optional().describe('Specific agent (omit for all)'),
    period: z.string().optional().describe('Time period (e.g., "last-30-days")'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to assess performance`);
    }

    // Placeholder: Would analyze chat logs and meeting summaries
    return {
      action: 'assess_performance',
      params,
      timestamp: new Date().toISOString(),
    };
  },
};

const addPictureTool: AgentTool = {
  name: 'add_picture',
  description: 'Download and set an avatar picture for an agent. Requires manage_agents permission. Can use random source or AI generation.',
  parameters: z.object({
    agentName: z.string().describe('Name or ID of the agent'),
    source: z.enum(['random', 'generate']).default('random').describe('Source: random (download) or generate (AI)'),
    randomUrlIndex: z.number().int().min(0).optional().describe('Index of random URL to use (defaults to first)'),
    prompt: z.string().optional().describe('Custom prompt for AI generation (auto-generated if omitted)'),
  }),
  async execute(params, context: ToolContext) {
    if (!context.agent.permissions?.manage_agents) {
      throw new Error(`Agent ${context.agent.id} does not have permission to add pictures`);
    }

    const { agentName, source, randomUrlIndex, prompt } = params as {
      agentName: string;
      source: 'random' | 'generate';
      randomUrlIndex?: number;
      prompt?: string;
    };

    // Resolve target agent
    const agentManager = new AgentManager(context.workspaceRoot);
    await agentManager.initialize();
    const targetAgent = agentManager.resolveAgentOrThrow(agentName);

    // Load team config
    const teamConfig = await loadTeamConfig(context.workspaceRoot);
    if (!teamConfig) {
      throw new Error('Team config not found. Run `ait init` first.');
    }
    let imageData: Buffer;

    if (source === 'random') {
      // Use random avatar URL
      const randomUrls = teamConfig.randomAvatarUrls || [];
      if (randomUrls.length === 0) {
        throw new Error('No random avatar URLs configured in .ai-team/config.json');
      }

      const urlIndex = randomUrlIndex ?? 0;
      if (urlIndex >= randomUrls.length) {
        throw new Error(`Random URL index ${urlIndex} out of range (max: ${randomUrls.length - 1})`);
      }

      const urlTemplate = randomUrls[urlIndex];
      imageData = await downloadRandomAvatar(urlTemplate, targetAgent);
    } else {
      // Generate with AI
      // Find first provider with imageModels configured
      const providers = teamConfig.providers || {};
      const imageCapableProviders = Object.entries(providers).filter(
        ([_, config]) => config.imageModels && Object.keys(config.imageModels).length > 0
      );

      if (imageCapableProviders.length === 0) {
        throw new Error('No providers with imageModels configured in .ai-team/config.json');
      }

      // Use first image-capable provider
      const [_providerName, providerConfig] = imageCapableProviders[0];
      const modelName = Object.values(providerConfig.imageModels!)[0];

      // Get API key from environment
      const apiKeyVar = providerConfig.apiKeyEnvVar || 'OPENAI_API_KEY';
      const apiKey = process.env[apiKeyVar];
      if (!apiKey) {
        throw new Error(`API key not found in environment variable: ${apiKeyVar}`);
      }

      // Generate prompt if not provided
      const finalPrompt = prompt || buildAvatarPrompt(targetAgent);

      imageData = await generateAvatarWithAI(finalPrompt, providerConfig, modelName, apiKey);
    }

    // Save and finalize avatar
    await saveAvatarPreview(targetAgent.id, imageData, context.workspaceRoot);
    const avatarPath = await finalizeAvatar(targetAgent.id, context.workspaceRoot);
    await updateAgentAvatar(targetAgent, avatarPath, context.workspaceRoot);

    return {
      action: 'add_picture',
      agentName: targetAgent.name,
      source,
      avatarPath,
      timestamp: new Date().toISOString(),
    };
  },
};

// ============================================================================
// Code Analysis Tools
// ============================================================================

/**
 * Find symbol definitions in a file or across files
 */
export const findSymbolTool: AgentTool = {
  name: 'find_symbol',
  description: 'Find symbol definitions (functions, classes, variables) in code. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Name of the symbol to find'),
    filePath: z.string().optional().describe('Specific file to search (omit to search all readable files)'),
    language: z.string().default('typescript').describe('Language (typescript, javascript, python, etc.)'),
  }),
  async execute(params, context: ToolContext) {
    const { SymbolFinder } = await import('../code-analysis/index.js');
    const { symbolName, filePath } = params as any;

    const finder = new SymbolFinder();
    
    try {
      await finder.initialize();
      
      // TODO: Load language grammar (needs language WASM files)
      // For now, return a placeholder indicating the feature needs language grammars
      return {
        error: 'Symbol finding requires language grammar files to be loaded. This feature is pending configuration.',
        symbolName,
        filePath,
      };
    } finally {
      finder.dispose();
    }
  },
};

/**
 * Find all references to a symbol
 */
export const findReferencesTool: AgentTool = {
  name: 'find_references',
  description: 'Find all references/usages of a symbol across files. Requires read permission.',
  parameters: z.object({
    symbolName: z.string().describe('Symbol name to find references for'),
    filePatterns: z.array(z.string()).optional().describe('Glob patterns for files to search'),
    language: z.string().default('typescript').describe('Language (typescript, javascript, python, etc.)'),
  }),
  async execute(params, context: ToolContext) {
    const { symbolName, filePatterns } = params as any;
    
    // TODO: Implement with tree-sitter once language grammars are configured
    return {
      error: 'Reference finding requires language grammar files to be loaded. This feature is pending configuration.',
      symbolName,
      filePatterns,
    };
  },
};

/**
 * Find code patterns (anti-patterns, TODO comments, etc.)
 */
export const findPatternTool: AgentTool = {
  name: 'find_pattern',
  description: 'Find code patterns like console.log, TODO comments, empty catch blocks, etc. Requires read permission.',
  parameters: z.object({
    patternType: z.enum(['console-log', 'todo-comment', 'empty-catch', 'async-without-await']).describe('Type of pattern to find'),
    filePatterns: z.array(z.string()).optional().describe('Glob patterns for files to search'),
    language: z.string().default('typescript').describe('Language to analyze'),
  }),
  async execute(params, context: ToolContext) {
    const { patternType, filePatterns } = params as any;
    
    // TODO: Implement with tree-sitter once language grammars are configured
    return {
      error: 'Pattern matching requires language grammar files to be loaded. This feature is pending configuration.',
      patternType,
      filePatterns,
    };
  },
};

/**
 * Fast grep-style text search
 */
export const grepCodeTool: AgentTool = {
  name: 'grep_code',
  description: 'Fast regex-based text search in files. More efficient than tree-sitter for simple text searches. Requires read permission.',
  parameters: z.object({
    pattern: z.string().describe('Text pattern or regex to search for'),
    filePatterns: z.array(z.string()).describe('Glob patterns for files to search'),
    caseInsensitive: z.boolean().optional().describe('Case-insensitive search'),
    wholeWord: z.boolean().optional().describe('Match whole words only'),
    maxMatchesPerFile: z.number().optional().describe('Limit matches per file'),
  }),
  async execute(params, context: ToolContext) {
    const { GrepSearch } = await import('../code-analysis/index.js');
    const { pattern, filePatterns, caseInsensitive, wholeWord, maxMatchesPerFile } = params as any;
    
    const contextManager = new ContextManager(context.workspaceRoot);
    const grep = new GrepSearch();
    
    // Find all files matching the patterns
    const allFiles: string[] = [];
    for (const filePattern of filePatterns) {
      const files = await glob(filePattern, {
        cwd: context.workspaceRoot,
        absolute: true,
        ignore: ['**/node_modules/**', '**/.git/**'],
      });
      allFiles.push(...files);
    }
    
    // Filter to only files the agent can read
    const readableFiles = contextManager.getReadableFiles(context.agent, allFiles);
    
    // Search
    const matches = await grep.searchFiles(readableFiles, pattern, {
      caseInsensitive,
      wholeWord,
      maxMatchesPerFile,
    });
    
    return {
      pattern,
      matchCount: matches.length,
      fileCount: new Set(matches.map(m => m.filePath)).size,
      matches: matches.slice(0, 100), // Limit to first 100 matches in response
    };
  },
};

/**
 * Analyze TypeScript/JavaScript code complexity
 */
export const analyzeComplexityTool: AgentTool = {
  name: 'analyze_complexity',
  description: 'Analyze code complexity metrics (cyclomatic complexity, LOC, etc.) for TypeScript/JavaScript files. Requires read permission.',
  parameters: z.object({
    filePath: z.string().describe('File path to analyze'),
    functionName: z.string().optional().describe('Specific function to analyze (omit for all functions)'),
  }),
  async execute(params, context: ToolContext) {
    const { TypeScriptAnalyzer } = await import('../code-analysis/index.js');
    const { filePath, functionName } = params as any;
    
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(context.workspaceRoot, filePath);
    
    const contextManager = new ContextManager(context.workspaceRoot);
    contextManager.assertCanRead(context.agent, absolutePath);
    
    const analyzer = new TypeScriptAnalyzer();
    
    if (functionName) {
      const complexity = await analyzer.calculateComplexity(absolutePath, functionName);
      return { filePath, functionName, complexity };
    } else {
      const functions = await analyzer.getFunctions(absolutePath);
      return { filePath, functions };
    }
  },
};

/**
 * Propose code edits for user approval
 */
export const applyCodeEditTool: AgentTool = {
  name: 'apply_code_edit',
  description: 'Propose code changes to one or more files. Changes must be approved by the user before being applied. Requires write permission for all files.',
  parameters: z.object({
    description: z.string().describe('Clear description of what changes are being made and why'),
    changes: z.array(z.object({
      filePath: z.string().describe('File path (relative or absolute)'),
      oldContent: z.string().describe('Current content of the file'),
      newContent: z.string().describe('New content after changes'),
    })).min(1).describe('List of file changes to apply'),
  }),
  async execute(params, context: ToolContext) {
    const { CodeEditManager } = await import('../code-edit/index.js');
    const { description, changes } = params as any;
    
    const contextManager = new ContextManager(context.workspaceRoot);
    const editManager = new CodeEditManager();
    
    // Convert paths to absolute
    const absoluteChanges = changes.map((change: any) => ({
      ...change,
      filePath: path.isAbsolute(change.filePath)
        ? change.filePath
        : path.join(context.workspaceRoot, change.filePath),
    }));
    
    // Validate permissions for all files
    const filePaths = absoluteChanges.map((c: any) => c.filePath);
    const validation = contextManager.validateEditProposal(context.agent, filePaths);
    
    if (!validation.allowed) {
      const blockedFiles = contextManager.getBlockedFiles(context.agent, validation.blockedFiles);
      
      return {
        status: 'permission_denied',
        message: validation.message,
        blockedFiles: blockedFiles.map(bf => ({
          filePath: bf.relativePath,
          reason: bf.reason,
        })),
      };
    }
    
    // Create proposal
    const { proposal, validation: proposalValidation } = await editManager.createProposal(
      context.agent.id,
      {
        description,
        changes: absoluteChanges,
      },
      {
        checkPermissions: true,
        maxFiles: 10,
        maxDiffLines: 500,
      }
    );
    
    return {
      status: 'pending_approval',
      proposalId: proposal.id,
      description: proposal.description,
      filesChanged: proposal.changes.length,
      additions: proposal.changes.reduce((sum, c) => sum + c.diff.additions, 0),
      deletions: proposal.changes.reduce((sum, c) => sum + c.diff.deletions, 0),
      warnings: proposalValidation.warnings,
      message: 'Code edit proposal created. Awaiting user approval.',
    };
  },
};

// ============================================================================
// Tool Registry
// ============================================================================

export const CORE_TOOLS: Record<string, AgentTool> = {
  read_file: readFileTool,
  file_search: fileSearchTool,
  write_file: writeFileTool,
  fs_read_file: fsReadFileTool,
  fs_read_lines: fsReadLinesTool,
  fs_write_file: fsWriteFileTool,
  fs_create_file: fsCreateFileTool,
  fs_delete_path: fsDeletePathTool,
  fs_mkdir: fsMkdirTool,
  fs_exists: fsExistsTool,
  fs_info: fsInfoTool,
  fs_list: fsListTool,
  fs_tree: fsTreeTool,
  fs_search_content: fsSearchContentTool,
  fs_search_metadata: fsSearchMetadataTool,
  who_has_access: whoHasAccessTool,
  do_i_have_access: doIHaveAccessTool,
  semantic_search: semanticSearchTool,
  get_errors: getErrorsTool,
  register_cli_tool: registerCliTool,
  update_employee_llm: updateEmployeeLlmTool,
  run_cli_tool: runCliTool,
  delegate_to_agent: delegateToAgentTool,
  ask_human: askHumanTool,
  ask_question: askQuestionTool,
  find_symbol: findSymbolTool,
  find_references: findReferencesTool,
  find_pattern: findPatternTool,
  grep_code: grepCodeTool,
  analyze_complexity: analyzeComplexityTool,
  apply_code_edit: applyCodeEditTool,
};

export const HR_TOOLS: Record<string, AgentTool> = {
  create_agent: createAgentTool,
  archive_agent: archiveAgentTool,
  assess_performance: assessPerformanceTool,
  add_picture: addPictureTool,
};

export const ALL_TOOLS: Record<string, AgentTool> = {
  ...CORE_TOOLS,
  ...HR_TOOLS,
};

/**
 * Get tools available to an agent
 * @param agent - Agent to get tools for
 * @returns Map of tool name to tool definition
 */
export function getAgentTools(agent: { tools?: string[]; permissions?: { manage_agents?: boolean } }): Record<string, AgentTool> {
  const tools: Record<string, AgentTool> = {};
  
  // Add explicitly granted tools
  if (agent.tools) {
    for (const toolName of agent.tools) {
      if (ALL_TOOLS[toolName]) {
        tools[toolName] = ALL_TOOLS[toolName];
      }
    }
  }
  
  // Add HR tools if agent has permission
  if (agent.permissions?.manage_agents) {
    Object.assign(tools, HR_TOOLS);
  }
  
  return tools;
}

export async function executeAgentTool(
  request: ToolExecutionRequest,
  options?: ToolExecutionOptions,
): Promise<ToolExecutionResult> {
  const { toolName, params, context } = request;
  const availableTools = getAgentTools(context.agent);
  const tool = availableTools[toolName];

  if (!tool) {
    return {
      ok: false,
      toolName,
      error: `Tool not allowed for agent: ${toolName}`,
    };
  }

  const approved = options?.onBeforeExecute
    ? await options.onBeforeExecute(request)
    : true;

  if (!approved) {
    return {
      ok: false,
      toolName,
      error: `Tool call denied by user: ${toolName}`,
    };
  }

  const parsed = tool.parameters.safeParse(params);
  if (!parsed.success) {
    return {
      ok: false,
      toolName,
      error: `Invalid parameters for ${toolName}: ${parsed.error.message}`,
    };
  }

  try {
    const timeoutMs = options?.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS;
    const result = await withTimeout(tool.execute(parsed.data, context), timeoutMs, `Tool ${toolName} timed out`);
    return {
      ok: true,
      toolName,
      result,
    };
  } catch (error) {
    return {
      ok: false,
      toolName,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

// ============================================================================
// ToolManager — new plugin-capable façade (replaces the global CORE_TOOLS map)
// ============================================================================

export { ToolManager } from './tool-manager.js';
export type {
  ToolExecutionResult as ToolManagerExecutionResult,
  ToolExecutionOptions as ToolManagerExecutionOptions,
} from './tool-manager.js';
