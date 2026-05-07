import path from 'node:path';
import * as nodeFs from 'node:fs/promises';
import { z } from 'zod';
import { FileTime, READ_DEFAULT_LIMIT, PermissionError, renderAsciiTree } from 'fs-context';
import type { ReadFileResult, FileTreeNode } from 'fs-context';
import type {
  AgentTool,
  ITool,
  CommandRuntime,
  ToolContext,
  IWorkspaceFs,
} from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../definitions/types.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Build a WorkspaceFs for the executing agent. Cheap — no file scanning. */
async function wfs(ctx: ToolContext) {
  if (!ctx.resolve) {
    throw new Error('ToolContext.resolve is required for filesystem tools.');
  }
  const workspaceFsFactory = ctx.resolve(COMMAND_FACTORY_TOKENS.WorkspaceFsFactory);
  return workspaceFsFactory.create(ctx.workspaceRoot, ctx.agent.id, ctx.agent.permissions);
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

/** Map a ReadFileResult to the tool response shape. */
function mapReadResult(
  result: ReadFileResult,
  filePath: string,
  agentId: string,
  fs: { canRead: (path: string) => boolean; toAbsolutePath: (path: string) => string }
): Record<string, unknown> {
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
      FileTime.record(agentId, fs.toAbsolutePath(filePath));
      return {
        path: filePath,
        content: result.content,
        totalLines: result.totalLines,
        startLine: result.startLine,
        endLine: result.endLine,
        isFullFile: result.isFullFile,
        offset: result.offset,
        limit: result.limit,
        hasMore: result.hasMore,
        ...(result.truncatedByBytes && { truncatedByBytes: true, nextOffset: result.nextOffset }),
        ...(!result.truncatedByBytes && result.hasMore && { nextOffset: result.nextOffset }),
      };
    }
  }
}

// ─── FsTree annotation helpers ────────────────────────────────────────────────

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

interface FsTreeNodeRights {
  l: boolean;
  r: boolean;
  w: boolean;
}

type FsTreeNodeWithRights = FileTreeNode & {
  rights: FsTreeNodeRights;
  children?: FsTreeNodeWithRights[];
};

function annotateFsTreeWithRights(node: FileTreeNode, fs: IWorkspaceFs): FsTreeNodeWithRights {
  const relPath = node.relativePath === '.' ? '' : node.relativePath;
  const childNodes = node.children?.map((child) => annotateFsTreeWithRights(child, fs));

  const ownRights: FsTreeNodeRights = {
    l: fs.canList(relPath),
    r: fs.canRead(relPath),
    w: fs.canWrite(relPath),
  };

  const rights: FsTreeNodeRights =
    childNodes && childNodes.length > 0
      ? {
          l: ownRights.l || childNodes.some((child) => child.rights.l),
          r: ownRights.r || childNodes.some((child) => child.rights.r),
          w: ownRights.w || childNodes.some((child) => child.rights.w),
        }
      : ownRights;

  return { ...node, rights, children: childNodes };
}

// ─── Tool param/result types ──────────────────────────────────────────────────

export interface FsPathParams {
  path: string;
}
export interface FsExistsResult {
  path: string;
  exists: boolean;
  access?: { allowed: boolean };
  error?: string;
}
export interface FsInfoResult {
  path: string;
  exists: boolean;
  info: unknown;
  access?: { allowed: boolean };
  error?: string;
}

export interface FsReadParams {
  filePath: string;
  offset?: number;
  limit?: number;
}
export type FsReadResult = Record<string, unknown>;

export interface FsReadLinesParams {
  filePath: string;
  startLine: number;
  endLine: number;
}
export type FsReadLinesResult = Record<string, unknown>;

export interface FsCreateParams {
  filePath: string;
  content?: string;
  createDirectories?: boolean;
}
export interface FsCreateResult {
  path: string;
  created: boolean;
  bytes?: number;
  error?: string;
}

export interface FsWriteParams {
  filePath: string;
  content: string;
}
export interface FsWriteResult {
  path: string;
  written: boolean;
  bytes?: number;
  _fileChanges?: unknown[];
  error?: string;
}

export interface FsDeleteParams {
  path: string;
  recursive?: boolean;
}
export interface FsDeleteResult {
  path: string;
  deleted: boolean;
  error?: string;
}

export interface FsMkdirParams {
  path: string;
  recursive?: boolean;
}
export interface FsMkdirResult {
  path: string;
  created: boolean;
  error?: string;
}

export interface FsListParams {
  path?: string;
  includeHidden?: boolean;
}
export interface FsListResult {
  path: string;
  entries: Array<{ path: string; name: string; isDirectory: boolean; size?: number; modified?: string }>;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsTreeParams {
  path?: string;
  maxDepth?: number;
  includeHidden?: boolean;
}
export interface FsTreeResult {
  path: string;
  tree: FileTreeNode | null;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsSearchContentParams {
  path?: string;
  query: string;
  maxResults?: number;
  caseSensitive?: boolean;
}
export interface FsSearchContentResult {
  path: string;
  query: string;
  matches: Array<{ path: string; line: number; content: string }>;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

export interface FsSearchMetadataParams {
  pattern: string;
  path?: string;
  maxResults?: number;
}
export interface FsSearchMetadataResult {
  pattern: string;
  path: string;
  matches: Array<{ path: string; size: number; mtime: string }>;
  numMatches: number;
  truncated: boolean;
  denied: number;
  access: { allowed: boolean; explanation?: string };
}

// ─── Tool classes ─────────────────────────────────────────────────────────────

export class FsExistsTool implements ITool<FsPathParams, ToolContext, FsExistsResult> {
  readonly name = 'exists';
  readonly key = 'exists';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Check whether a file or directory exists. Access-gated as a list operation.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  });

  async execute(params: FsPathParams, context: ToolContext): Promise<FsExistsResult> {
    const { path: targetPath } = params;
    try {
      const fs = await wfs(context);
      const exists = await fs.existsPath(targetPath);
      return { path: targetPath, exists, access: { allowed: true } };
    } catch (e) {
      if (e instanceof PermissionError) {
        return { path: targetPath, exists: false, access: { allowed: false } };
      }
      return failed(e, targetPath, 'exists') as unknown as FsExistsResult;
    }
  }
}

export class FsInfoTool implements ITool<FsPathParams, ToolContext, FsInfoResult> {
  readonly name = 'info';
  readonly key = 'info';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Get file/directory metadata and access envelope. Access-gated as a list operation.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  });

  async execute(params: FsPathParams, context: ToolContext): Promise<FsInfoResult> {
    const { path: targetPath } = params;
    try {
      const fs = await wfs(context);
      const info = await fs.getPathInfo(targetPath);
      return { path: targetPath, exists: info !== null, info, access: { allowed: true } };
    } catch (e) {
      if (e instanceof PermissionError) {
        return { path: targetPath, exists: false, info: null, access: { allowed: false } };
      }
      return failed(e, targetPath, 'exists') as unknown as FsInfoResult;
    }
  }
}

export class FsReadFileTool implements ITool<FsReadParams, ToolContext, FsReadResult> {
  readonly name = 'read';
  readonly key = 'read';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = [
    'Read a file through access checks with structured access metadata.',
    'Reads line-by-line internally (never buffers the whole file into memory).',
    'Supports pagination via `offset` (1-based start line) and `limit` (max lines).',
    'Text content is returned without inline line-number prefixes.',
    'Structured results include `startLine`, `endLine`, and `isFullFile` so callers know which slice was returned.',
    'Lines longer than 2000 chars are truncated; output is capped at 50 KB.',
    'If the file is not found, suggests similar filenames the agent can access.',
    'If the path is a directory, returns a paginated listing (supports offset/limit).',
    'Image files and PDFs are returned as base64 data with their MIME type.',
    'Binary files are detected and a notice is returned instead of raw bytes.',
    'Tracking: records read time so fs_edit can validate staleness.',
  ].join(' ');
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    offset: z.number().int().min(1).optional().describe('1-based line to start from (default 1)'),
    limit: z.number().int().min(1).optional().describe('Max lines to return (default 2000)'),
  });

  formatForLlm(result: FsReadResult): unknown {
    if (typeof result.content !== 'string') return result;
    const isFullFile = result.isFullFile === true;
    return [
      `File: ${result.path}`,
      `Scope: ${isFullFile ? 'full-file' : 'partial-slice'}`,
      '',
      result.content,
    ].join('\n');
  }

  async execute(params: FsReadParams, context: ToolContext): Promise<FsReadResult> {
    const { filePath, offset = 1, limit = READ_DEFAULT_LIMIT } = params;
    try {
      const fs = await wfs(context);
      const result = await fs.readFile(filePath, {
        offset,
        limit,
        workspaceRoot: context.workspaceRoot,
      });
      return mapReadResult(result, filePath, context.agent.id, fs);
    } catch (e) {
      return failed(e, filePath, 'content');
    }
  }
}

// Singleton must be defined before FsReadLinesTool so it can call execute on it.
export const fsReadFileTool: AgentTool = new FsReadFileTool();

export class FsReadLinesTool implements ITool<FsReadLinesParams, ToolContext, FsReadLinesResult> {
  readonly name = 'read_lines';
  readonly key = 'read_lines';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Read a range of raw lines from a file.';
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based first line'),
    endLine: z.number().int().min(1).describe('1-based last line (inclusive)'),
  });

  async execute(params: FsReadLinesParams, context: ToolContext): Promise<FsReadLinesResult> {
    const { filePath, startLine, endLine } = params;
    const runtime: CommandRuntime = {
      invocationSurface: 'tool',
      workspaceRoot: context.workspaceRoot,
      resolve:
        context.resolve ??
        (() => {
          throw new Error('Tool runtime resolver is not available.');
        }),
      agentId: context.agentId,
    };
    const result = (await fsReadFileTool.execute(
      { filePath, offset: startLine, limit: endLine - startLine + 1 },
      context,
      runtime
    )) as Record<string, unknown>;
    if (result.error || !result.content) return result;
    const lines = (result.content as string).split('\n');
    return { ...result, lines };
  }
}

export class FsCreateFileTool implements ITool<FsCreateParams, ToolContext, FsCreateResult> {
  readonly name = 'create';
  readonly key = 'create';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Create a new file through access checks.';
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  });

  async execute(params: FsCreateParams, context: ToolContext): Promise<FsCreateResult> {
    const { filePath, content = '', createDirectories = false } = params;
    try {
      const fs = await wfs(context);
      const { bytes } = await fs.createFile(filePath, content, { createDirectories });
      return { path: filePath, created: true, bytes };
    } catch (e) {
      return failed(e, filePath, 'created') as unknown as FsCreateResult;
    }
  }
}

export class FsWriteFileTool implements ITool<FsWriteParams, ToolContext, FsWriteResult> {
  readonly name = 'write_file';
  readonly key = 'write_file';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Write (overwrite) a file through access checks.';
  readonly parameters = z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('Content to write'),
  });

  async execute(params: FsWriteParams, context: ToolContext): Promise<FsWriteResult> {
    const { filePath, content } = params;
    try {
      const workspaceFs = await wfs(context);
      const absolutePath = workspaceFs.toAbsolutePath(filePath);

      let oldContent = '';
      try {
        oldContent = await nodeFs.readFile(absolutePath, 'utf8');
      } catch {
        oldContent = '';
      }

      const { bytes } = await workspaceFs.writeFile(filePath, content);
      return {
        path: filePath,
        written: true,
        bytes,
        _fileChanges: [{ filePath: absolutePath, oldContent, newContent: content }],
      };
    } catch (e) {
      return failed(e, filePath, 'written') as unknown as FsWriteResult;
    }
  }
}

export class FsDeletePathTool implements ITool<FsDeleteParams, ToolContext, FsDeleteResult> {
  readonly name = 'delete_path';
  readonly key = 'delete_path';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Delete a file or directory through access checks.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  });

  async execute(params: FsDeleteParams, context: ToolContext): Promise<FsDeleteResult> {
    const { path: targetPath, recursive = true } = params;
    try {
      const fs = await wfs(context);
      await fs.deletePath(targetPath, { recursive });
      return { path: targetPath, deleted: true };
    } catch (e) {
      return failed(e, targetPath, 'deleted') as unknown as FsDeleteResult;
    }
  }
}

export class FsMkdirTool implements ITool<FsMkdirParams, ToolContext, FsMkdirResult> {
  readonly name = 'mkdir';
  readonly key = 'mkdir';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Create a directory through access checks.';
  readonly parameters = z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  });

  async execute(params: FsMkdirParams, context: ToolContext): Promise<FsMkdirResult> {
    const { path: targetPath, recursive = true } = params;
    try {
      const fs = await wfs(context);
      await fs.createDirectory(targetPath, { recursive });
      return { path: targetPath, created: true };
    } catch (e) {
      return failed(e, targetPath, 'created') as unknown as FsMkdirResult;
    }
  }
}

export class FsListTool implements ITool<FsListParams, ToolContext, FsListResult> {
  readonly name = 'list';
  readonly key = 'list';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'List directory entries with access checks.';
  readonly parameters = z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    includeHidden: z.boolean().optional().describe('Include hidden entries'),
  });

  formatForLlm(result: FsListResult): unknown {
    if (!result.entries?.length) return `${result.path}: (empty or not accessible)`;
    const lines = result.entries.map((e) => (e.isDirectory ? `${e.name}/` : e.name));
    return `${result.path}  (${result.entries.length} entries)\n\n${lines.join('\n')}`;
  }

  async execute(params: FsListParams, context: ToolContext): Promise<FsListResult> {
    const { path: targetPath = '.', includeHidden = false } = params;

    const fs = await wfs(context);
    const { tree, denied: deniedCount } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth: 2,
      includeHidden,
    });
    const children = tree?.children ?? [];

    const entries = children.map((child: FileTreeNode) => ({
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
            ...(deniedCount > 0 && {
              explanation: `${deniedCount} item(s) hidden due to access restrictions`,
            }),
          }
        : deniedCount > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return { path: targetPath, entries, denied: deniedCount, access };
  }
}

export class FsTreeTool implements ITool<FsTreeParams, ToolContext, FsTreeResult> {
  readonly name = 'tree';
  readonly key = 'tree';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description = 'Build directory tree with access-filtered nodes.';
  readonly matchesIntent = matchesFsTreePreLlmIntent;
  readonly parameters = z.object({
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxDepth: z
      .number()
      .int()
      .min(0)
      .max(64)
      .optional()
      .describe('Maximum recursion depth (default 6)'),
    includeHidden: z.boolean().optional().describe('Include hidden files and directories'),
  });

  formatForLlm(result: FsTreeResult): unknown {
    if (!result.tree) return `${result.path}: (empty or not accessible)`;
    return `${result.path}\n\n${renderAsciiTree(result.tree)}`;
  }

  async execute(params: FsTreeParams, context: ToolContext): Promise<FsTreeResult> {
    const { path: targetPath = '.', maxDepth = 6, includeHidden = false } = params;

    const fs = await wfs(context);
    const { tree, denied: deniedCount } = await fs.getFileTreeWithStats({
      rootSubPath: targetPath,
      maxDepth,
      includeHidden,
    });

    const access =
      tree !== null
        ? {
            allowed: true,
            ...(deniedCount > 0 && {
              explanation: `${deniedCount} item(s) hidden due to access restrictions`,
            }),
          }
        : deniedCount > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    const treeWithRights = tree ? annotateFsTreeWithRights(tree, fs) : null;

    return { path: targetPath, tree: treeWithRights, denied: deniedCount, access };
  }
}

export class FsSearchContentTool
  implements ITool<FsSearchContentParams, ToolContext, FsSearchContentResult>
{
  readonly name = 'search_content';
  readonly key = 'search_content';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Search file contents under a path. Every candidate path is access-checked.';
  readonly parameters = z.object({
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
  });

  async execute(
    params: FsSearchContentParams,
    context: ToolContext
  ): Promise<FsSearchContentResult> {
    const { path: targetPath = '.', query, maxResults = 100, caseSensitive = false } = params;

    const fs = await wfs(context);
    const { matches: rawMatches, denied: deniedCount } = await fs.grepWithStats(query, {
      caseInsensitive: !caseSensitive,
    });

    const matches: Array<{ path: string; line: number; content: string }> = [];
    for (const match of rawMatches) {
      const relativePath = path
        .relative(context.workspaceRoot, match.filePath)
        .replaceAll('\\', '/');

      if (
        targetPath !== '.' &&
        !relativePath.startsWith(targetPath.replace(/\/$/, '') + '/') &&
        relativePath !== targetPath
      ) {
        continue;
      }

      matches.push({ path: relativePath, line: match.line, content: match.lineText });
      if (matches.length >= maxResults) break;
    }

    const access =
      matches.length > 0
        ? {
            allowed: true,
            ...(deniedCount > 0 && {
              explanation: `${deniedCount} file(s) hidden due to access restrictions`,
            }),
          }
        : deniedCount > 0
          ? {
              allowed: false,
              explanation:
                'Content is not accessible with your current permissions. Consider delegating to an agent with broader access.',
            }
          : { allowed: true };

    return { path: targetPath, query, matches, denied: deniedCount, access };
  }
}

export class FsSearchMetadataTool
  implements ITool<FsSearchMetadataParams, ToolContext, FsSearchMetadataResult>
{
  readonly name = 'search_metadata';
  readonly key = 'search_metadata';
  readonly group = 'fs';
  readonly availableIn = { tool: true };
  readonly description =
    'Fast glob-pattern file search backed by ripgrep. Returns matching paths with size and mtime. ' +
    'Respects .gitignore by default. Use glob patterns like "**/*.ts" or "src/**/*.test.*".';
  readonly parameters = z.object({
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
  });

  formatForLlm(result: FsSearchMetadataResult): unknown {
    const header = `pattern: ${result.pattern}  root: ${result.path}\n${result.numMatches} files${result.truncated ? ' (truncated)' : ''}`;
    if (!result.matches?.length) return header;
    const lines = result.matches.map((m) => `${m.path}  ${m.size}B  ${m.mtime}`);
    return `${header}\n\n${lines.join('\n')}`;
  }

  async execute(
    params: FsSearchMetadataParams,
    context: ToolContext
  ): Promise<FsSearchMetadataResult> {
    const { pattern, path: targetPath = '.', maxResults = 200 } = params;

    const { Ripgrep, safeStat } = await import('fs-context');
    const fs = await wfs(context);
    const cwd = path.resolve(context.workspaceRoot, targetPath);

    const matches: Array<{ path: string; size: number; mtime: string }> = [];
    let deniedCount = 0;

    for await (const relFile of Ripgrep.files({ cwd, glob: [pattern] })) {
      const relFromRoot =
        targetPath === '.'
          ? relFile.replaceAll('\\', '/')
          : (targetPath + '/' + relFile).replaceAll('\\', '/');

      if (!fs.canList(relFromRoot)) {
        deniedCount++;
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
            ...(deniedCount > 0 && {
              explanation: `${deniedCount} file(s) hidden due to access restrictions`,
            }),
          }
        : deniedCount > 0
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
      denied: deniedCount,
      access,
    };
  }
}

// ─── Module-level singletons ──────────────────────────────────────────────────

export const fsExistsTool: AgentTool = new FsExistsTool();
export const fsInfoTool: AgentTool = new FsInfoTool();
// fsReadFileTool is declared above FsReadLinesTool (dependency order)
export const fsReadLinesTool: AgentTool = new FsReadLinesTool();
export const fsCreateFileTool: AgentTool = new FsCreateFileTool();
export const fsWriteFileTool: AgentTool = new FsWriteFileTool();
export const fsDeletePathTool: AgentTool = new FsDeletePathTool();
export const fsMkdirTool: AgentTool = new FsMkdirTool();
export const fsListTool: AgentTool = new FsListTool();
export const fsTreeTool: AgentTool = new FsTreeTool();
export const fsSearchContentTool: AgentTool = new FsSearchContentTool();
export const fsSearchMetadataTool: AgentTool = new FsSearchMetadataTool();
