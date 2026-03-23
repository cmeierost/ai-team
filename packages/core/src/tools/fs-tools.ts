import path from 'node:path';
import { z } from 'zod';
import {
  getFileTree, listWorkspaceFiles, FileTime,
  READ_DEFAULT_LIMIT, safeStat,
  readFile, existsPath, getPathInfo,
  createFile, writeFile, deletePath, createDirectory,
} from '@ai-team/fs';
import type { ReadFileResult } from '@ai-team/fs';
import type { AgentTool, ToolContext } from '../types/index.js';
import {
  canListViaAccessEngine,
  filterTreeByListAccess,
  getAccessEngineOrDeny,
  resolveFsAbsolutePath,
  toFsPathAccessEnvelope,
  toFsPathMeta,
} from './fs-access.js';

// ─── Shared access-gate helpers ───────────────────────────────────────────────

/** Result of the standard three-step access gate (engine → resolve → envelope). */
interface AccessGate {
  absolutePath: string;
  pathMeta: ReturnType<typeof toFsPathMeta>;
  access: ReturnType<typeof toFsPathAccessEnvelope>;
}

/** Run the engine check, path resolution, and access envelope. Returns null + early-return payload when denied. */
function accessGate(
  context: ToolContext,
  toolName: Parameters<typeof toFsPathAccessEnvelope>[1],
  filePath: string,
  resultKey: string,
): { ok: true; gate: AccessGate } | { ok: false; denied: Record<string, unknown> } {
  const engineCheck = getAccessEngineOrDeny(context);
  const absolutePath = resolveFsAbsolutePath(context, filePath);

  if (!absolutePath) {
    return {
      ok: false,
      denied: {
        path: { input: filePath, absolute: '', relative: '' },
        [resultKey]: false,
        access: { allowed: false, explanation: 'Path is outside workspace root.', alternativeContexts: [] },
      },
    };
  }

  const pathMeta = toFsPathMeta(context, filePath, absolutePath);

  if (!engineCheck.ok) {
    return {
      ok: false,
      denied: { path: pathMeta, [resultKey]: false, access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] } },
    };
  }

  const access = toFsPathAccessEnvelope(context, toolName, filePath);
  if (!access.allowed) {
    return {
      ok: false,
      denied: {
        path: pathMeta, [resultKey]: false, access,
        delegation: {
          possible: access.alternativeContexts.length > 0,
          contexts: access.alternativeContexts,
          unassignable: access.alternativeContexts.length === 0,
        },
      },
    };
  }

  return { ok: true, gate: { absolutePath, pathMeta, access } };
}

// ─── fs_exists ────────────────────────────────────────────────────────────────

export const fsExistsTool: AgentTool = {
  name: 'fs_exists',
  description: 'Check whether a file or directory exists. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
    const { path: targetPath } = params as { path: string };
    const check = accessGate(context, 'fs_exists', targetPath, 'exists');
    if (!check.ok) return check.denied;
    const { absolutePath, pathMeta, access } = check.gate;
    const exists = await existsPath(absolutePath);
    return { path: pathMeta, exists, access };
  },
};

// ─── fs_info ──────────────────────────────────────────────────────────────────

export const fsInfoTool: AgentTool = {
  name: 'fs_info',
  description: 'Get file/directory metadata and access envelope. Access-gated as a list operation.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute file/directory path'),
  }),
  async execute(params, context) {
    const { path: targetPath } = params as { path: string };
    const check = accessGate(context, 'fs_info', targetPath, 'exists');
    if (!check.ok) return check.denied;
    const { absolutePath, pathMeta, access } = check.gate;
    const info = await getPathInfo(absolutePath);
    return { path: pathMeta, exists: info !== null, info, access };
  },
};

// ─── fs_read ──────────────────────────────────────────────────────────────────

/** Filter similar-name suggestions through the access layer. */
function accessFilteredSuggestions(suggestions: string[], context: ToolContext): string[] {
  const allowed: string[] = [];
  for (const rel of suggestions) {
    if (toFsPathAccessEnvelope(context, 'fs_read', rel).allowed) allowed.push(rel);
    if (allowed.length >= 3) break;
  }
  return allowed;
}

/** Map a ReadFileResult to the tool-level response shape, injecting access metadata. */
function mapReadResult(
  result: ReadFileResult,
  pathMeta: ReturnType<typeof toFsPathMeta>,
  access: ReturnType<typeof toFsPathAccessEnvelope>,
  context: ToolContext,
  absolutePath: string,
): Record<string, unknown> {
  switch (result.kind) {
    case 'not-found': {
      const filtered = accessFilteredSuggestions(result.suggestions, context);
      const msg = filtered.length > 0
        ? `File not found: ${pathMeta.input}\n\nDid you mean one of these?\n${filtered.join('\n')}`
        : `File not found: ${pathMeta.input}`;
      return { path: pathMeta, content: null, access, error: msg };
    }
    case 'directory':
      return {
        path: pathMeta, content: null, directory: true,
        listing: result.entries.join('\n'), totalEntries: result.totalEntries,
        offset: result.offset, limit: result.limit, hasMore: result.hasMore, access,
      };
    case 'media': {
      const label = result.mimeType.startsWith('image/') ? 'Image read successfully' : 'PDF read successfully';
      return { path: pathMeta, content: label, mimeType: result.mimeType, base64: result.base64, sizeBytes: result.sizeBytes, access };
    }
    case 'binary':
      return { path: pathMeta, content: null, binary: true, sizeBytes: result.sizeBytes, access };
    case 'offset-out-of-range': {
      const s = result.totalLines === 1 ? '' : 's';
      return { path: pathMeta, content: null, access, error: `Offset ${result.offset} is out of range — file has ${result.totalLines} line${s}.` };
    }
    case 'text': {
      FileTime.record(context.agent.id, absolutePath);
      return {
        path: pathMeta, content: result.content, totalLines: result.totalLines,
        offset: result.offset, limit: result.limit, hasMore: result.hasMore,
        ...(result.truncatedByBytes && { truncatedByBytes: true, nextOffset: result.nextOffset }),
        ...(!result.truncatedByBytes && result.hasMore && { nextOffset: result.nextOffset }),
        access,
      };
    }
  }
}

export const fsReadFileTool: AgentTool = {
  name: 'fs_read',
  description: [
    'Read a file through @ai-team/access with structured access metadata.',
    'Streams the file line-by-line (never buffers the whole file).',
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
    offset:   z.number().int().min(1).optional().describe('1-based line to start from (default 1)'),
    limit:    z.number().int().min(1).optional().describe('Max lines to return (default 2000)'),
  }),
  async execute(params, context) {
    const { filePath, offset = 1, limit = READ_DEFAULT_LIMIT } = params as { filePath: string; offset?: number; limit?: number };
    const check = accessGate(context, 'fs_read', filePath, 'content');
    if (!check.ok) return check.denied;

    try {
      const result = await readFile(check.gate.absolutePath, { offset, limit, workspaceRoot: context.workspaceRoot });
      return mapReadResult(result, check.gate.pathMeta, check.gate.access, context, check.gate.absolutePath);
    } catch (error) {
      return { path: check.gate.pathMeta, content: null, access: check.gate.access, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── fs_read_lines ────────────────────────────────────────────────────────────

export const fsReadLinesTool: AgentTool = {
  name: 'fs_read_lines',
  description: 'Read a range of lines from a file. Legacy compat — delegates to the streaming reader.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    startLine: z.number().int().min(1).describe('1-based first line'),
    endLine: z.number().int().min(1).describe('1-based last line (inclusive)'),
  }),
  async execute(params, context) {
    const { filePath, startLine, endLine } = params as { filePath: string; startLine: number; endLine: number };
    const result = await fsReadFileTool.execute({ filePath, offset: startLine, limit: endLine - startLine + 1 }, context) as Record<string, unknown>;
    if (result.error || !result.content) return result;
    const lines = (result.content as string).split('\n');
    return { ...result, lines };
  },
};

// ─── fs_create ────────────────────────────────────────────────────────────────

export const fsCreateFileTool: AgentTool = {
  name: 'fs_create',
  description: 'Create a new file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().optional().describe('Optional initial content'),
    createDirectories: z.boolean().optional().describe('Create parent directories if needed'),
  }),
  async execute(params, context) {
    const { filePath, content = '', createDirectories = false } = params as { filePath: string; content?: string; createDirectories?: boolean };
    const check = accessGate(context, 'fs_create', filePath, 'created');
    if (!check.ok) return check.denied;

    try {
      const { bytes } = await createFile(check.gate.absolutePath, content, { createDirectories });
      return { path: check.gate.pathMeta, created: true, bytes, access: check.gate.access };
    } catch (error) {
      return { path: check.gate.pathMeta, created: false, access: check.gate.access, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── fs_write_file ────────────────────────────────────────────────────────────

export const fsWriteFileTool: AgentTool = {
  name: 'fs_write_file',
  description: 'Write (overwrite) a file through @ai-team/access.',
  parameters: z.object({
    filePath: z.string().describe('Relative or absolute file path'),
    content: z.string().describe('Content to write'),
  }),
  async execute(params, context) {
    const { filePath, content } = params as { filePath: string; content: string };
    const check = accessGate(context, 'fs_write_file', filePath, 'written');
    if (!check.ok) return check.denied;

    try {
      const { bytes } = await writeFile(check.gate.absolutePath, content);
      return { path: check.gate.pathMeta, written: true, bytes, access: check.gate.access };
    } catch (error) {
      return { path: check.gate.pathMeta, written: false, access: check.gate.access, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── fs_delete_path ───────────────────────────────────────────────────────────

export const fsDeletePathTool: AgentTool = {
  name: 'fs_delete_path',
  description: 'Delete a file or directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute path'),
    recursive: z.boolean().optional().describe('Recursively delete directories'),
  }),
  async execute(params, context) {
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    const check = accessGate(context, 'fs_delete_path', targetPath, 'deleted');
    if (!check.ok) return check.denied;

    try {
      await deletePath(check.gate.absolutePath, { recursive });
      return { path: check.gate.pathMeta, deleted: true, access: check.gate.access };
    } catch (error) {
      return { path: check.gate.pathMeta, deleted: false, access: check.gate.access, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── fs_mkdir ─────────────────────────────────────────────────────────────────

export const fsMkdirTool: AgentTool = {
  name: 'fs_mkdir',
  description: 'Create a directory through @ai-team/access.',
  parameters: z.object({
    path: z.string().describe('Relative or absolute directory path'),
    recursive: z.boolean().optional().describe('Create parent directories recursively'),
  }),
  async execute(params, context) {
    const { path: targetPath, recursive = true } = params as { path: string; recursive?: boolean };
    const check = accessGate(context, 'fs_mkdir', targetPath, 'created');
    if (!check.ok) return check.denied;

    try {
      await createDirectory(check.gate.absolutePath, { recursive });
      return { path: check.gate.pathMeta, created: true, access: check.gate.access };
    } catch (error) {
      return { path: check.gate.pathMeta, created: false, access: check.gate.access, error: error instanceof Error ? error.message : String(error) };
    }
  },
};

// ─── fs_list ──────────────────────────────────────────────────────────────────

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

    const tree = await getFileTree(context.workspaceRoot, {
      rootSubPath: targetPath,
      maxDepth: 1,
      includeHidden,
    });
    const children = tree.children ?? [];

    const totalChildren = children.length;
    const entries = children
      .filter((child) => {
        const childPath = child.relativePath || '.';
        if (canListViaAccessEngine(context, childPath)) return true;
        // For directories, check if any descendant would be accessible
        // by testing `childPath/probe` — if the pattern is `childPath/**` the child itself
        // doesn't match but its contents would.
        if (child.isDirectory && canListViaAccessEngine(context, childPath + '/probe')) return true;
        return false;
      })
      .map((child) => ({
        path: child.relativePath,
        name: child.name,
        isDirectory: child.isDirectory,
        size: child.size,
        modified: child.modified,
      }));

    const denied = totalChildren - entries.length;
    const explanation = entries.length === 0 && denied > 0
      ? `${denied} entry/entries exist under this path but are not accessible with your current permissions. Consider delegating to a teammate with broader access.`
      : denied > 0
        ? `Filtered by per-entry list access. ${denied} additional entry/entries were hidden due to access restrictions.`
        : 'Filtered by per-entry list access.';

    return {
      path: targetPath,
      entries,
      denied,
      access: { allowed: entries.length > 0, explanation, alternativeContexts: [] },
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

    const rawTree = await getFileTree(context.workspaceRoot, {
      rootSubPath: targetPath,
      maxDepth,
      includeHidden,
    });
    const { tree: filteredTree, denied } = filterTreeByListAccess(context, rawTree);

    if (!filteredTree || (filteredTree.children && filteredTree.children.length === 0)) {
      const explanation = denied > 0
        ? `${denied} file(s) exist under this path but are not accessible with your current permissions. Consider delegating to a teammate with broader access.`
        : 'No files found under the requested path.';
      return {
        path: targetPath,
        tree: null,
        denied,
        access: { allowed: false, explanation, alternativeContexts: [] },
      };
    }

    return {
      path: targetPath,
      tree: filteredTree,
      denied,
      access: {
        allowed: true,
        explanation: denied > 0
          ? `Filtered by per-node list access. ${denied} additional file(s) were hidden due to access restrictions.`
          : 'Filtered by per-node list access.',
        alternativeContexts: [],
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

    const files = await listWorkspaceFiles(context.workspaceRoot, {
      rootSubPath: targetPath,
      filesOnly: true,
      maxDepth: 20,
    });

    const { GrepSearch } = await import('@ai-team/fs');
    const grep = new GrepSearch();
    const allFilePaths = files.map((file) => file.path);

    const rawMatches = await grep.searchFiles(allFilePaths, query, {
      caseInsensitive: !caseSensitive,
    });

    const matches: Array<{ path: string; line: number; content: string }> = [];
    let denied = 0;
    for (const match of rawMatches) {
      const relativePath = path.relative(context.workspaceRoot, match.filePath).replaceAll('\\', '/');
      if (!canListViaAccessEngine(context, relativePath)) {
        denied++;
        continue;
      }

      matches.push({
        path: relativePath,
        line: match.line,
        content: match.lineText,
      });

      if (matches.length >= maxResults) break;
    }

    const explanation = matches.length === 0 && denied > 0
      ? `${denied} match(es) were found but are not accessible with your current permissions. Consider delegating to a teammate with broader access.`
      : denied > 0
        ? `Filtered by per-file list access. ${denied} additional match(es) were hidden due to access restrictions.`
        : 'Filtered by per-file list access.';

    return {
      path: targetPath,
      query,
      matches,
      denied,
      access: { allowed: matches.length > 0, explanation, alternativeContexts: [] },
    };
  },
};

export const fsSearchMetadataTool: AgentTool = {
  name: 'fs_search_metadata',
  description:
    'Fast glob-pattern file search backed by ripgrep. Returns matching paths with size and mtime. ' +
    'Respects .gitignore by default. Use glob patterns like "**/*.ts" or "src/**/*.test.*".',
  parameters: z.object({
    pattern: z.string().min(1).describe('Glob pattern to match (e.g. "**/*.ts", "src/**/*.test.*")'),
    path: z.string().optional().describe('Relative root path (defaults to workspace root)'),
    maxResults: z.number().int().min(1).max(1000).optional().describe('Maximum number of matches (default 200)'),
  }),
  async execute(params, context) {
    const engineCheck = getAccessEngineOrDeny(context);
    const {
      pattern,
      path: targetPath = '.',
      maxResults = 200,
    } = params as { pattern: string; path?: string; maxResults?: number };

    if (!engineCheck.ok) {
      return {
        pattern,
        path: targetPath,
        matches: [],
        access: { allowed: false, explanation: engineCheck.reason, alternativeContexts: [] },
      };
    }

    const { Ripgrep } = await import('@ai-team/fs');
    const cwd = path.resolve(context.workspaceRoot, targetPath);

    const matches: Array<{ path: string; size: number; mtime: string }> = [];
    let denied = 0;

    for await (const relFile of Ripgrep.files({ cwd, glob: [pattern] })) {
      const relFromRoot = targetPath === '.'
        ? relFile.replaceAll('\\', '/')
        : (targetPath + '/' + relFile).replaceAll('\\', '/');

      if (!canListViaAccessEngine(context, relFromRoot)) {
        denied++;
        continue;
      }

      const abs = path.resolve(cwd, relFile);
      const st = await safeStat(abs);
      if (!st) continue; // file vanished between listing and stat
      const size = st.size;
      const mtime = st.mtime.toISOString();

      matches.push({ path: relFromRoot, size, mtime });
      if (matches.length >= maxResults) break;
    }

    const explanation = matches.length === 0 && denied > 0
      ? `${denied} file(s) matched the pattern but are not accessible with your current permissions. Consider delegating to a teammate with broader access.`
      : denied > 0
        ? `Filtered by per-file list access. ${denied} additional file(s) were hidden due to access restrictions.`
        : 'Filtered by per-file list access.';

    return {
      pattern,
      path: targetPath,
      matches,
      denied,
      numMatches: matches.length,
      truncated: matches.length >= maxResults,
      access: { allowed: matches.length > 0, explanation, alternativeContexts: [] },
    };
  },
};
