import { z } from 'zod';
import { Ripgrep } from 'fs-context';
import type { CommandResponse, ICommand, ICommandDescriptor } from '@ai-team/core';

export const GrepCodeToolMetadata = {
  key: 'grep',
  group: 'search',
  availableIn: { tool: true },
  description:
    'Fast regex or literal text search in workspace files, powered by ripgrep. Returns structured match objects with file path, line number, and matched content. Requires read permission.',
  parameters: z.object({
    pattern: z.string().describe('Regex or literal text to search for'),
    filePatterns: z
      .array(z.string())
      .optional()
      .describe('Glob patterns to restrict files (e.g. ["**/*.ts"])'),
    caseSensitive: z
      .boolean()
      .optional()
      .describe('Force case-sensitive match (default: ripgrep smart-case)'),
    limit: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe('Max matches to return per file (default: unlimited)'),
  }),
} satisfies ICommandDescriptor;

export interface GrepCodeParams {
  pattern: string;
  filePatterns?: string[];
  caseSensitive?: boolean;
  limit?: number;
}

export interface GrepCodeResult {
  pattern: string;
  matchCount: number;
  fileCount: number;
  matches: Array<{
    filePath: string;
    lineNumber: number;
    line: string;
    submatches: string[];
  }>;
}

export class GrepCodeTool implements ICommand<GrepCodeParams, GrepCodeResult> {
  readonly metadata = GrepCodeToolMetadata;
  readonly name = 'grep';

  constructor(private readonly workspaceRoot = process.cwd()) {}

  formatForLlm(result: unknown): unknown {
    const r = result as GrepCodeResult;
    const header = `pattern: ${r.pattern}\n${r.matchCount} matches in ${r.fileCount} files`;
    if (!r.matches?.length) return header;
    const lines = r.matches.map((m) => `${m.filePath}:${m.lineNumber}: ${m.line}`);
    return `${header}\n\n${lines.join('\n')}`;
  }

  async execute(params: GrepCodeParams): Promise<CommandResponse<GrepCodeResult>> {
    const { pattern, filePatterns, limit } = params;
    const matches = await Ripgrep.search({
      cwd: this.workspaceRoot,
      pattern,
      glob: filePatterns,
      limit,
      follow: false,
    });

    return {
      status: 'ok',
      data: {
        pattern,
        matchCount: matches.length,
        fileCount: new Set(matches.map((m) => m.path.text)).size,
        matches: matches.slice(0, 200).map((m) => ({
          filePath: m.path.text,
          lineNumber: m.line_number,
          line: m.lines.text.trimEnd(),
          submatches: m.submatches.map((s) => s.match.text),
        })),
      },
    };
  }
}
