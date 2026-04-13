import path from 'node:path';
import { z } from 'zod';
import { FileTime, READ_DEFAULT_LIMIT, PermissionError, renderAsciiTree } from 'fs-context';
import type { ReadFileResult, FileTreeNode } from 'fs-context';
import type { AgentTool, ToolContext } from '@ai-team/core';
import { createWorkspaceFs } from '@ai-team/infrastructure';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build a WorkspaceFs for the executing agent. Cheap — no file scanning. */
function wfs(ctx: ToolContext) {
  return createWorkspaceFs(ctx.workspaceRoot, ctx.agent.id, ctx.agent.permissions);
}

/** Standard denial response when a PermissionError is caught. */
function denied(e: PermissionError, inputPath: string, resultKey: string) {
  return {
    path: inputPath,
    [resultKey]: false,
    error: e.message,
  };
}

/** Standard error response for unexpected failures. */
function failed(e: unknown, inputPath: string, resultKey: string) {
  if (e instanceof PermissionError) return denied(e, inputPath, resultKey);
  return {
    path: inputPath,
    [resultKey]: false,
    error: e instanceof Error ? e.message : String(e),
  };
}

// ─── fs_exists ────────────────────────────────────────────────────────────────

export const fsExistsTool: AgentTool = {
  name: 'exists',
  group: 'fs',
  description: 'Check whether a file or directory exists. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
    const { path: targetPath } = params as { path: string };
    try {
      const fs = wfs(context);
      const exists = await fs.existsPath(targetPath);
      return { path: targetPath, exists, access: { allowed: true } };
    } catch (e) {
      if (e instanceof PermissionError) {
        return { path: targetPath, exists: false, access: { allowed: false } };
      }
      return failed(e, targetPath, 'exists');
    }
  },
};

// ─── fs_info ──────────────────────────────────────────────────────────────────

export const fsInfoTool: AgentTool = {
  name: 'info',
  group: 'fs',
  description: 'Get file/directory metadata and access envelope. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
    const { path: targetPath } = params as { path: string };
    try {
      const fs = wfs(context);
      const info = await fs.getPathInfo(targetPath);
      return { path: targetPath, exists: info !== null, info, access: { allowed: true } };
    } catch (e) {
      if (e instanceof PermissionError) {
        return { path: targetPath, exists: false, info: null, access: { allowed: false } };
      }
      return failed(e, targetPath, 'exists');
    }
  },
};

// ─── fs_read ──────────────────────────────────────────────────────────────────

/** Map a ReadFileResult to the tool response shape. */
function mapReadResult(
  result: ReadFileResult,
  filePath: string,
  context: ToolContext
): Record<string, unknown> {
  const fs = wfs(context);
  switch (result.kind) {
    case 'not-found': {
      const filtered = result.suggestions.filter((s) => fs.canRead(s)).slice(0, 3);
      const msg =
        filtered.length > 0
          ? `File not found: ${filePath}\n\nDid you mean one of these?\n${filtered.join('\n')}`
          : `File not found: ${filePath}`;
      return { path: filePath, content: null, error: msg };
    }
    case 'directory':
      return {
        path: filePath,
        content: null,
        directory: true,
        listing: result.entries.join('\n'),
        totalEntries: result.totalEntries,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
      };
    case 'media': {
      const label = result.mimeType.startsWith('image/')
        ? 'Image read successfully'
        : 'PDF read successfully';
      return {
        path: filePath,
        content: label,
        mimeType: result.mimeType,
        base64: result.base64,
        sizeBytes: result.sizeBytes,
      };
    }
    case 'binary':
      return { path: filePath, content: null, binary: true, sizeBytes: result.sizeBytes };
    case 'offset-out-of-range': {
      const s = result.totalLines === 1 ? '' : 's';
      return {
        path: filePath,
        content: null,
        error: `Offset ${result.offset} is out of range — file has ${result.totalLines} line${s}.`,
      };
    }
    case 'text': {
      FileTime.record(context.agent.id, fs.toAbsolutePath(filePath));
      return {
        path: filePath,
        content: result.content,
        totalLines: result.totalLines,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
        ...(result.truncatedByBytes && { truncatedByBytes: true, nextOffset: result.nextOffset }),
        ...(!result.truncatedByBytes && result.hasMore && { nextOffset: result.nextOffset }),
      };
    }
  }
}

export const fsReadFileTool: AgentTool = {
  name: 'read',
  group: 'fs',
  description: [
    'Read a file through access checks with structured access metadata.',
    'Reads line-by-line internally (never buffers the whole file into memory).',
    'Supports pagination via `offset` (1-based start line) and `limit` (max lines).',
    'Output lines are prefixed with their 1-based line number, e.g. "42: content".',
    'Lines longer than 2000 chars are truncated; output is capped at 50 KB.',
    'If the file is not found, suggests similar filenames the agent can access.',
    'If the path is a directory, returns a paginated listing (supports offset/limit).',
    'Image files and PDFs are returned as base64 data with their MIME type.',
    'Binary files are detected and a notice is returned instead of raw bytes.',
    'Tracking: records read time so fs_edit can validate staleness.',
  ].join(' '),
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    offset: z.number().int().min(1).optional().describe('1-based line to start from (default 1)'),
    limit: z.number().int().min(1).optional().describe('Max lines to return (default 2000)'),
  }),
  async execute(params, context) {
    const {
      filePath,
      offset = 1,
      limit = READ_DEFAULT_LIMIT,
    } = params as { filePath: string; offset?: number; limit?: number };
    try {
      const fs = wfs(context);
      const result = await fs.readFile(filePath, {
        offset,
        limit,
        workspaceRoot: context.workspaceRoot,
      });
      return mapReadResult(result, filePath, context);
    } catch (e) {
      return failed(e, filePath, 'content');
    }
  },
};

// ─── fs_read_lines ────────────────────────────────────────────────────────────

export const fsReadLinesTool: AgentTool = {
  name: 'read_lines',
  group: 'fs',
  description:
    'Read a range of lines from a file. Legacy compat — delegates to the streaming reader.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based first line'),
    endLine: z.number().int().min(1).describe('1-based last line (inclusive)'),
  }),
  async execute(params, context) {
    const { filePath, startLine, endLine } = params as {
      filePath: string;
      startLine: number;
      endLine: number;
    };
    const result = (await fsReadFileTool.execute(
      { filePath, offset: startLine, limit: endLine - startLine + 1 },
      context
    )) as Record<string, unknown>;
    if (result.error || !result.content) return result;
    const lines = (result.content as string).split('\n');
    return { ...result, lines };
  },
};

// ─── fs_create ────────────────────────────────────────────────────────────────

export const fsCreateFileTool: AgentTool = {
  name: 'create',
  group: 'fs',
  description: 'Create a new file through access checks.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context) {
    const {
      filePath,
      content = '',
      createDirectories = false,
    } = params as { filePath: string; content?: string; createDirectories?: boolean };
    try {
      const fs = wfs(context);
      const { bytes } = await fs.createFile(filePath, content, { createDirectories });
      return { path: filePath, created: true, bytes };
    } catch (e) {
      return failed(e, filePath, 'created');
    }
  },
};

// ─── fs_write_file ────────────────────────────────────────────────────────────

export const fsWriteFileTool: AgentTool = {
  name: 'write_file',
  group: 'fs',
  description: 'Write (overwrite) a file through access checks.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('Content to write'),
  }),
  async execute(params, context) {
    const { filePath, content } = params as { filePath: string; content: string };
    try {
      const fs = wfs(context);
      const { bytes } = await fs.writeFile(filePath, content);
      return { path: filePath, written: true, bytes };
    } catch (e) {
      return failed(e, filePath, 'written');
    }
  },
};

// ─── fs_delete_path ───────────────────────────────────────────────────────────

export const fsDeletePathTool: AgentTool = {
  name: 'delete_path',
  group: 'fs',
  description: 'Delete a file or directory through access checks.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  }),
  async execute(params, context) {
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    try {
      const fs = wfs(context);
      await fs.deletePath(targetPath, { recursive });
      return { path: targetPath, deleted: true };
    } catch (e) {
      return failed(e, targetPath, 'deleted');
    }
  },
};

// ─── fs_mkdir ─────────────────────────────────────────────────────────────────

export const fsMkdirTool: AgentTool = {
  name: 'mkdir',
  group: 'fs',
  description: 'Create a directory through access checks.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  }),
  async execute(params, context) {
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    try {
      const fs = wfs(context);
      await fs.createDirectory(targetPath, { recursive });
      return { path: targetPath, created: true };
    } catch (e) {
      return failed(e, targetPath, 'created');
    }
  },
};

// ─── fs_list ──────────────────────────────────────────────────────────────────

export const fsListTool: AgentTool = {
  name: 'list',
  group: 'fs',
  description: 'List directory entries with access checks.',
  formatForLlm(result: unknown): unknown {
    const r = result as {
      path: string;
      entries: Array<{ name: string; isDirectory: boolean }>;
    };
    if (!r.entries?.length) return `${r.path}: (empty or not accessible)`;
    const lines = r.entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
    const header = `${r.path}  (${r.entries.length} entries)`;
    return `${header}\n\n${lines.join('\n')}`;
  },
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    includeHidden: z.boolean().optional().describe('Include hidden entries'),
  }),
  async execute(params, context) {
    const { path: targetPath = '.', includeHidden = false } = params as {
      path?: string;
      includeHidden?: boolean;
    };

    const fs = wfs(context);
    // Use maxDepth:2 so directories' children are evaluated when filtering by permission.
    // With maxDepth:1, directories are treated as leaves and won't show if only
    // their children match the access pattern (e.g. allowed-dir/**).
    const { tree, denied } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth: 2,
      includeHidden,
    });
    const children = tree?.children ?? [];

    const entries = children.map((child) => ({
      path: child.relativePath,
      name: child.name,
      isDirectory: child.isDirectory,
      size: child.size,
      modified: child.modified,
    }));

    const access =
      entries.length > 0
        ? {
            allowed: true,
            ...(denied > 0 && {
              explanation: `${denied} item(s) hidden due to access restrictions`,
            }),
          }
        : denied > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return { path: targetPath, entries, denied, access };
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
  name: 'tree',
  group: 'fs',
  description: 'Build directory tree with access-filtered nodes.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(64)
      .optional()
      .describe('Maximum recursion depth (default 6)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories'),
  }),
  async execute(params, context) {
    const {
      path: targetPath = '.',
      maxDepth = 6,
      includeHidden = false,
    } = params as {
      path?: string;
      maxDepth?: number;
      includeHidden?: boolean;
    };

    const fs = wfs(context);
    const { tree, denied } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth,
      includeHidden,
    });

    const access =
      tree !== null
        ? {
            allowed: true,
            ...(denied > 0 && {
              explanation: `${denied} item(s) hidden due to access restrictions`,
            }),
          }
        : denied > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return { path: targetPath, tree: tree ?? null, denied, access };
  },
  formatForLlm(result: unknown): unknown {
    const r = result as {
      path: string;
      tree: FileTreeNode | null;
    };
    if (!r.tree) return `${r.path}: (empty or not accessible)`;
    return `${r.path}\n\n${renderAsciiTree(r.tree)}`;
  },
};

export const fsSearchContentTool: AgentTool = {
  name: 'search_content',
  group: 'fs',
  description: 'Search file contents under a path. Every candidate path is access-checked.',
  parameters: z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    query: z.string().min(1).describe('Text to search for'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(500)
      .optional()
      .describe('Maximum number of matches to return'),
    caseSensitive: z.boolean().optional().describe('Case-sensitive search (default false)'),
  }),
  async execute(params, context) {
    const {
      path: targetPath = '.',
      query,
      maxResults = 100,
      caseSensitive = false,
    } = params as { path?: string; query: string; maxResults?: number; caseSensitive?: boolean };

    const fs = wfs(context);
    const { matches: rawMatches, denied } = await fs.grepWithStats(query, {
      caseInsensitive: !caseSensitive,
    });

    const matches: Array<{ path: string; line: number; content: string }> = [];
    for (const match of rawMatches) {
      const relativePath = path
        .relative(context.workspaceRoot, match.filePath)
        .replaceAll('\\', '/');

      // Filter by root sub-path if not workspace root
      if (
        targetPath !== '.' &&
        !relativePath.startsWith(targetPath.replace(/\/$/, '') + '/') &&
        relativePath !== targetPath
      ) {
        continue;
      }

      matches.push({
        path: relativePath,
        line: match.line,
        content: match.lineText,
      });

      if (matches.length >= maxResults) break;
    }

    const access =
      matches.length > 0
        ? {
            allowed: true,
            ...(denied > 0 && {
              explanation: `${denied} file(s) hidden due to access restrictions`,
            }),
          }
        : denied > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return { path: targetPath, query, matches, denied, access };
  },
};

export const fsSearchMetadataTool: AgentTool = {
  name: 'search_metadata',
  group: 'fs',
  description:
    'Fast glob-pattern file search backed by ripgrep. Returns matching paths with size and mtime. ' +
    'Respects .gitignore by default. Use glob patterns like "**/*.ts" or "src/**/*.test.*".',
  parameters: z.object({
    pattern: z
      .string()
      .min(1)
      .describe('Glob pattern to match (e.g. "**/*.ts", "src/**/*.test.*")'),
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(1000)
      .optional()
      .describe('Maximum number of matches (default 200)'),
  }),
  formatForLlm(result: unknown): unknown {
    const r = result as {
      pattern: string;
      path: string;
      numMatches: number;
      truncated: boolean;
      matches: Array<{ path: string; size: number; mtime: string }>;
    };
    const header = `pattern: ${r.pattern}  root: ${r.path}\n${r.numMatches} files${r.truncated ? ' (truncated)' : ''}`;
    if (!r.matches?.length) return header;
    const lines = r.matches.map((m) => `${m.path}  ${m.size}B  ${m.mtime}`);
    return `${header}\n\n${lines.join('\n')}`;
  },
  async execute(params, context) {
    const {
      pattern,
      path: targetPath = '.',
      maxResults = 200,
    } = params as { pattern: string; path?: string; maxResults?: number };

    const { Ripgrep, safeStat } = await import('fs-context');
    const fs = wfs(context);
    const cwd = path.resolve(context.workspaceRoot, targetPath);

    const matches: Array<{ path: string; size: number; mtime: string }> = [];
    let denied = 0;

    for await (const relFile of Ripgrep.files({ cwd, glob: [pattern] })) {
      const relFromRoot =
        targetPath === '.'
          ? relFile.replaceAll('\\', '/')
          : (targetPath + '/' + relFile).replaceAll('\\', '/');

      if (!fs.canList(relFromRoot)) {
        denied++;
        continue;
      }

      const abs = path.resolve(cwd, relFile);
      const st = await safeStat(abs);
      if (!st) continue;

      matches.push({ path: relFromRoot, size: st.size, mtime: st.mtime.toISOString() });
      if (matches.length >= maxResults) break;
    }

    const access =
      matches.length > 0
        ? {
            allowed: true,
            ...(denied > 0 && {
              explanation: `${denied} file(s) hidden due to access restrictions`,
            }),
          }
        : denied > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return {
      pattern,
      path: targetPath,
      matches,
      numMatches: matches.length,
      truncated: matches.length >= maxResults,
      denied,
      access,
    };
  },
};
