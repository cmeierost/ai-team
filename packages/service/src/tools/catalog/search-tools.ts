import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { glob } from 'glob';
import { z } from 'zod';
import type { AgentTool } from '@ai-team/core';
import { getReadableFiles } from '@ai-team/infrastructure';
import { withTimeout } from './tool-utils.js';

const execFileAsync = promisify(execFile);

const MAX_SEMANTIC_FILE_SIZE_BYTES = 200_000;

/**
 * Semantic search across codebase (placeholder - would integrate with vector DB)
 */
export const semanticSearchTool: AgentTool = {
  name: 'semantic',
  group: 'search',
  description: 'Search codebase semantically for relevant code and documentation.',
  parameters: z.object({
    query: z.string().describe('Natural language search query'),
    maxResults: z.number().optional().describe('Maximum number of results'),
  }),
  formatForLlm(result: unknown): unknown {
    const r = result as {
      query: string;
      results: Array<{ filePath: string; score: number; snippet: string }>;
    };
    if (!r.results?.length) return `query: ${r.query}\n\nNo results found.`;
    const parts = r.results.map((e) => `${e.filePath} (score=${e.score}):\n${e.snippet}`);
    return `query: ${r.query}\n${r.results.length} results\n\n${parts.join('\n\n---\n\n')}`;
  },
  async execute(params, context) {
    const { query, maxResults = 10 } = params as { query: string; maxResults?: number };

    const files = await glob('**/*.{ts,tsx,js,jsx,mjs,cjs,json,md,yml,yaml}', {
      cwd: context.workspaceRoot,
      absolute: true,
      ignore: ['**/node_modules/**', '**/.git/**', '**/dist/**', '**/build/**'],
    });

    const readableFiles = getReadableFiles(context.workspaceRoot, context.agent.permissions, files);

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
      results: scored.slice(0, maxResults).map((entry) => ({
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
  group: 'tool',
  description: 'Get compile or lint errors for specified files.',
  formatForLlm(result: unknown): unknown {
    const r = result as { errors: string[] };
    if (!r.errors?.length) return 'No errors found.';
    return `${r.errors.length} error(s):\n\n${r.errors.join('\n')}`;
  },
  parameters: z.object({
    filePaths: z.array(z.string()).optional().describe('Files to check (omit for all files)'),
  }),
  async execute(params, context) {
    const { filePaths } = params as { filePaths?: string[] };
    const timeoutMs = 120_000;

    const { stdout = '', stderr = '' } = await withTimeout(
      execFileAsync('pnpm', ['-r', 'build'], {
        cwd: context.workspaceRoot,
        windowsHide: true,
        maxBuffer: 1024 * 1024 * 8,
      }).then((r) => r),
      timeoutMs,
      `get_errors timed out after ${timeoutMs / 1000}s`
    );

    const output = `${stdout}\n${stderr}`;
    const lines = output.split(/\r?\n/);

    const normalizedFilters = (filePaths || []).map((filePath) => {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.join(context.workspaceRoot, filePath);
      return path.normalize(absolute);
    });

    const errors = lines
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((line) => /error\s+TS\d+|\berror\b/i.test(line))
      .filter((line) => {
        if (normalizedFilters.length === 0) {
          return true;
        }

        const normalizedLine = path.normalize(line);
        return normalizedFilters.some((filterPath) => normalizedLine.includes(filterPath));
      });

    return {
      errors,
    };
  },
};
