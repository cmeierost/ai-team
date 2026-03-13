import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { getFileTree, listWorkspaceFiles } from '@ai-team/fs';
import type { AgentTool } from '../types/index.js';
import {
  canListViaAccessEngine,
  filterTreeByListAccess,
  getAccessEngineOrDeny,
  resolveFsAbsolutePath,
  toFsPathAccessEnvelope,
  toFsPathMeta,
} from './fs-access.js';

export const fsExistsTool: AgentTool = {
  name: 'fs_exists',
  description: 'Check whether a file or directory exists. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
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

export const fsInfoTool: AgentTool = {
  name: 'fs_info',
  description: 'Get file/directory metadata and access envelope. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
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

export const fsReadFileTool: AgentTool = {
  name: 'fs_read',
  description: 'Read a file through @ai-team/access with structured access metadata.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    encoding: z.enum(['utf8']).optional().describe('Text encoding (default utf8)'),
  }),
  async execute(params, context) {
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

    const access = toFsPathAccessEnvelope(context, 'fs_read', filePath);
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

export const fsReadLinesTool: AgentTool = {
  name: 'fs_read_lines',
  description: 'Read specific lines from a file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based start line'),
    endLine: z.number().int().min(1).describe('1-based end line (inclusive)'),
  }),
  async execute(params, context) {
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

export const fsWriteFileTool: AgentTool = {
  name: 'fs_write_file',
  description: 'Write file contents through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('File content to write'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context) {
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

export const fsCreateFileTool: AgentTool = {
  name: 'fs_create',
  description: 'Create a new file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context) {
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

    const access = toFsPathAccessEnvelope(context, 'fs_create', filePath);
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

export const fsDeletePathTool: AgentTool = {
  name: 'fs_delete_path',
  description: 'Delete a file or directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  }),
  async execute(params, context) {
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

export const fsMkdirTool: AgentTool = {
  name: 'fs_mkdir',
  description: 'Create a directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  }),
  async execute(params, context) {
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

export const fsListTool: AgentTool = {
  name: 'fs_list',
  description: 'List directory entries through @ai-team/access.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    includeHidden: z.boolean().optional().describe('Include hidden entries'),
  }),
  async execute(params, context) {
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

// Keep pre-LLM regexes right above the tool they trigger.
export const FS_TREE_PRE_LLM_PATTERNS: readonly RegExp[] = [
  /\b(call\s+fs_tree)\b/i,
  /\b(file\s*tree|visible\s+file|visible\s+files|readable\s+file|readable\s+files)\b/i,
  /\bwhat\b.*\bfiles\b.*\b(read|write|list)\b/i,
];

export function matchesFsTreePreLlmIntent(message: string): boolean {
  const text = message.trim();
  if (!text) return false;
  return FS_TREE_PRE_LLM_PATTERNS.some((pattern) => pattern.test(text));
}

export const fsTreeTool: AgentTool = {
  name: 'fs_tree',
  description: 'Build directory tree with access checks enforced by @ai-team/access for all returned nodes.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxDepth: z.number().int().min(0).max(64).optional().describe('Maximum recursion depth (default 6)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories'),
  }),
  async execute(params, context) {
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

export const fsSearchContentTool: AgentTool = {
  name: 'fs_search_content',
  description: 'Search file contents under a path. Every candidate path is checked through @ai-team/access.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Text to search for'),
    maxResults: z.number().int().min(1).max(500).optional().describe('Maximum number of matches to return'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false)'),
  }),
  async execute(params, context) {
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

export const fsSearchMetadataTool: AgentTool = {
  name: 'fs_search_metadata',
  description: 'Search file metadata/path names under a path with @ai-team/access checks for all candidates.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Substring to match in file/directory names or paths'),
    maxResults: z.number().int().min(1).max(1000).optional().describe('Maximum number of matches to return'),
    includeDirectories: z.boolean().optional().describe('Include directory entries in results (default true)'),
  }),
  async execute(params, context) {
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
