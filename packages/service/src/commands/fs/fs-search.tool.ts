import path from 'node:path';
import { stat } from 'node:fs/promises';
import { glob } from 'glob';
import { z } from 'zod';
import { GrepSearch } from 'fs-context';
import type {
  Agent,
  ExecutionContext,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  IAgentManager,
  IFuzzyFileSearch,
  IPathPermissionChecker,
  IWorkspaceFsFactory,
} from '@ai-team/core';
import type { FsSearchParams, FsSearchResult } from './fs-tool-types.js';

export const FsSearchToolMetadata = {
  key: 'search',
  group: 'fs',
  availableIn: { tool: true, chat: true },
  usage: '<query> [mode] [glob]',
  examples: [
    '/fs search workflow',
    '/fs search workflow content packages/**/*.ts',
  ],
  description:
    'Search files visible to the current agent. Use /fs search as a slash command for a workspace-wide human search, or use the fs_search tool for an agent-permission-scoped search. Use mode "names" (default) to search listable paths, or mode "content" to search contents only in readable files. ' +
    'Use glob to restrict files (for example **/*.ts), regex for regular expressions, and wholeWord for word-boundary matching. ' +
    'Results are ranked writable > readable > listable, limited to 10 files by default, and include total counts, file metadata, line numbers/snippets for readable hits, and agents who can read or write files the current agent cannot. ' +
    'If no exact name matches are found in mode "names", a fuzzy search fallback runs over the same candidate scope and fuzzy results are marked with [fuzzy]. ' +
    'After a readable hit, call fs_read (using offset and limit for the reported line range) to inspect it. If another agent is listed as the reader or writer, hand off with com_handoff/delegate instead of attempting the operation yourself. This is lexical path/content search, not embedding-based semantic retrieval.',
  parameters: z.object({
    query: z.string().min(1).describe('Literal text or regular expression to search for'),
    mode: z.enum(['names', 'content']).optional().describe('Search names (default) or readable contents'),
    glob: z.string().optional().describe('Optional file glob, for example **/*.ts'),
    regex: z.boolean().optional().describe('Treat query as a regular expression (default false)'),
    caseSensitive: z.boolean().optional().describe('Use case-sensitive matching (default false)'),
    wholeWord: z.boolean().optional().describe('Match complete words only (default false)'),
    maxResults: z.number().int().min(1).max(100).optional().describe('Maximum files to return (default 10)'),
  }),
} satisfies ICommandDescriptor;

const grep = new GrepSearch();

export class FsSearchTool implements ICommand<FsSearchParams, FsSearchResult> {
  readonly metadata = FsSearchToolMetadata;
  readonly name = 'search';

  formatForLlm(result: FsSearchResult): string {
    return formatSearchResult(result);
  }

  constructor(
    private readonly workspaceRoot: string,
    private readonly workspaceFsFactory: IWorkspaceFsFactory,
    private readonly agentManager: IAgentManager,
    private readonly pathPermissionChecker: IPathPermissionChecker,
    private readonly fuzzyFileSearch: IFuzzyFileSearch
  ) {}

  async execute(
    params: FsSearchParams,
    context: ExecutionContext
  ): Promise<CommandResponse<FsSearchResult>> {
    const mode = params.mode ?? 'names';
    const maxResults = params.maxResults ?? 10;
    const agentId = context.agent?.id ?? '';
    // A human slash invocation is allowed to search the whole workspace. Keep
    // write permissions unchanged so search ranking still reflects ownership,
    // while agent/tool invocations remain constrained by their fs-context.
    const basePermissions = context.agent?.permissions ?? { read: [], write: [], list: [] };
    const permissions = context.invocationSurface === 'slash'
      ? { ...basePermissions, read: ['**'], list: ['**'] }
      : basePermissions;
    const scope = context.invocationSurface === 'slash' ? 'workspace' : 'agent-permissions';
    const fs = await this.workspaceFsFactory.create(agentId, permissions);
    const candidates = await this.listCandidates(fs, params.glob);
    const needle = params.regex
      ? new RegExp(params.query, params.caseSensitive ? 'g' : 'gi')
      : params.query;
    const lowerQuery = params.query.toLowerCase();
    const allAgents = await this.agentManager.getAllAgentsAsync();
    const matches: FsSearchResult['results'] = [];
    let contentHitsKnown = 0;

    for (const candidate of candidates) {
      const readable = fs.canRead(candidate);
      const writable = fs.canWrite(candidate);
      const nameScore = scoreName(candidate, lowerQuery, params.regex === true);
      const nameMatch = params.regex
        ? new RegExp(params.query, params.caseSensitive ? '' : 'i').test(candidate)
        : candidate.toLowerCase().includes(lowerQuery);
      let contentSearched = false;
      let lines: number[] | undefined;
      let contentMatches: Awaited<ReturnType<typeof grep.searchFile>> = [];
      let contentScore = 0;

      if (mode === 'content' && readable) {
        contentSearched = true;
        contentMatches = await grep.searchFile(path.resolve(this.workspaceRoot, candidate), needle, {
          caseInsensitive: !params.caseSensitive,
          wholeWord: params.wholeWord,
          maxMatchesPerFile: 100,
        });
        contentHitsKnown += contentMatches.length;
        if (contentMatches.length > 0) {
          lines = [...new Set(contentMatches.map((match) => match.line))].slice(0, 5);
          contentScore = Math.min(500, contentMatches.length * 40 + 250);
        }
      }

      const matchedBy: Array<'name' | 'content'> = [];
      if (nameMatch) matchedBy.push('name');
      if (contentScore > 0) matchedBy.push('content');
      if (mode === 'content' && !nameMatch && contentScore === 0) continue;
      if (mode === 'names' && !nameMatch) continue;

      const accessScore = writable ? 300 : readable ? 200 : 100;
      const score = accessScore + Math.max(nameScore, contentScore);
      const result: FsSearchResult['results'][number] = {
        path: candidate,
        score,
        matchedBy,
        readable,
        writable,
        contentSearched,
      };
      if (lines) result.lines = lines;
      if (contentSearched && lines) {
        result.snippets = [...new Map(contentMatches.map((match) => [match.line, {
          line: match.line,
          content: match.lineText,
        }])).values()].slice(0, 5);
      }
      try {
        const metadata = await stat(path.resolve(this.workspaceRoot, candidate));
        result.size = metadata.size;
        result.mtime = metadata.mtime.toISOString();
      } catch {
        // The file may disappear between discovery and metadata collection.
      }
      if (!writable) {
        result.writers = findAgents(allAgents, this.pathPermissionChecker, candidate, 'write');
      }
      if (!readable) {
        result.readers = findAgents(allAgents, this.pathPermissionChecker, candidate, 'read');
        result.nextAction = 'Use com_handoff or delegate to an agent listed in readers before inspecting this file.';
      } else if (contentSearched && lines) {
        result.nextAction = writable
          ? 'Call fs_read with offset and limit for the matching content.'
          : 'Call fs_read with offset and limit, then hand off modifications to an agent listed in writers.';
      }
      matches.push(result);
    }

    matches.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

    // If no exact matches in names mode, fall back to fuzzy search over the
    // same listable/glob-filtered candidate set.
    let fuzzyFallback: FsSearchResult['results'] = [];
    let fuzzyTotalMatches = 0;
    if (mode === 'names' && matches.length === 0) {
      const fuzzyRanked = this.fuzzyFileSearch.findSimilarRanked(
        params.query,
        permissions,
        candidates
      );
      fuzzyTotalMatches = fuzzyRanked.length;
      fuzzyFallback = await this.buildFuzzyResults(
        fuzzyRanked.slice(0, maxResults),
        fs,
        allAgents
      );
    }

    const usedFuzzyFallback = mode === 'names' && matches.length === 0;
    const results = !usedFuzzyFallback
      ? matches.slice(0, maxResults)
      : fuzzyFallback;

    const totalMatches = usedFuzzyFallback ? fuzzyTotalMatches : matches.length;
    const truncated = totalMatches > results.length;

    return {
      status: 'ok',
      data: {
        query: params.query,
        mode,
        scope,
        ...(params.glob ? { glob: params.glob } : {}),
        totalMatches,
        returnedMatches: results.length,
        contentHitsKnown,
        truncated,
        results,
      },
    };
  }

  private async buildFuzzyResults(
    rankedMatches: Array<{ path: string; score: number }>,
    fs: Awaited<ReturnType<IWorkspaceFsFactory['create']>>,
    allAgents: Agent[]
  ): Promise<FsSearchResult['results']> {
    const results: FsSearchResult['results'] = [];
    for (const candidateMatch of rankedMatches) {
      const candidate = candidateMatch.path;
      const readable = fs.canRead(candidate);
      const writable = fs.canWrite(candidate);
      const accessScore = writable ? 300 : readable ? 200 : 100;
      const result: FsSearchResult['results'][number] = {
        path: candidate,
        score: accessScore + Math.round(candidateMatch.score * 700),
        matchedBy: ['fuzzy'],
        readable,
        writable,
        contentSearched: false,
      };
      try {
        const metadata = await stat(path.resolve(this.workspaceRoot, candidate));
        result.size = metadata.size;
        result.mtime = metadata.mtime.toISOString();
      } catch {
        // File may have disappeared
      }
      if (!writable) {
        result.writers = findAgents(allAgents, this.pathPermissionChecker, candidate, 'write');
      }
      if (!readable) {
        result.readers = findAgents(allAgents, this.pathPermissionChecker, candidate, 'read');
        result.nextAction = 'This file was found by fuzzy search. Use com_handoff or delegate to an agent listed in readers before inspecting this file.';
      } else {
        result.nextAction = 'This file was found by fuzzy search. Call fs_read to inspect it.';
      }
      results.push(result);
    }
    return results;
  }

  private async listCandidates(fs: Awaited<ReturnType<IWorkspaceFsFactory['create']>>, pattern?: string) {
    const paths = await glob(pattern ?? '**/*', {
      cwd: this.workspaceRoot,
      nodir: true,
      dot: true,
      ignore: ['.git/**'],
    });
    return paths
      .map((candidate) => candidate.replaceAll('\\', '/'))
      .filter((candidate) => fs.canList(candidate));
  }
}

interface SearchTreeNode {
  children: Map<string, SearchTreeNode>;
  result?: FsSearchResult['results'][number];
}

function formatSearchResult(result: FsSearchResult): string {
  const hasFuzzy = result.results.some((r) => r.matchedBy.includes('fuzzy'));
  const lines: string[] = [
    `Search: "${result.query}" (${result.mode}; scope: ${result.scope})`,
    `Matches: ${result.totalMatches} files; showing ${result.returnedMatches}. Readable content hits known: ${result.contentHitsKnown}.${hasFuzzy ? ' (includes fuzzy-matched results)' : ''}`,
  ];
  const root: SearchTreeNode = { children: new Map() };

  for (const match of result.results) {
    const parts = match.path.split('/').filter(Boolean);
    let node = root;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      let child = node.children.get(part);
      if (!child) {
        child = { children: new Map() };
        node.children.set(part, child);
      }
      node = child;
      if (index === parts.length - 1) node.result = match;
    }
  }

  const entries = [...root.children.entries()];
  for (let index = 0; index < entries.length; index++) {
    renderSearchTreeNode(entries[index][0], entries[index][1], '', index === entries.length - 1, lines);
  }
  if (result.truncated) lines.push('… more matches not shown; narrow the glob or query to inspect them.');
  return lines.join('\n');
}

function renderSearchTreeNode(
  name: string,
  node: SearchTreeNode,
  prefix: string,
  isLast: boolean,
  lines: string[]
): void {
  const connector = prefix ? `${prefix}${isLast ? '└── ' : '├── '}` : '';
  const isDirectory = node.children.size > 0 && !node.result;
  lines.push(`${connector}${isDirectory ? `${name}/` : formatSearchFile(name, node.result)}`);

  if (node.result) {
    const result = node.result;
    const rights = result.writable ? 'RW' : result.readable ? 'R-' : '--';
    const matchedBy = result.matchedBy.join('+') || 'match';
    const lineInfo = result.lines?.length ? `; lines ${result.lines.join(', ')}` : '';
    const fuzzyLabel = result.matchedBy.includes('fuzzy') ? ' [fuzzy]' : '';
    const detailPrefix = `${prefix}${isLast ? '    ' : '│   '}   `;
    lines.push(`${detailPrefix}intent: ${matchedBy}; access ${rights}; score ${result.score}${lineInfo}${fuzzyLabel}`);
    if (result.snippets?.length) {
      for (const snippet of result.snippets.slice(0, 3)) {
        lines.push(`${detailPrefix}line ${snippet.line}: ${snippet.content}`);
      }
    }
    if (result.readers?.length) {
      lines.push(`${detailPrefix}delegate reading to: ${result.readers.map((agent) => agent.label).join(', ')}`);
    }
    if (result.writers?.length) {
      lines.push(`${detailPrefix}delegate writing to: ${result.writers.map((agent) => agent.label).join(', ')}`);
    }
    if (result.nextAction) lines.push(`${detailPrefix}next: ${result.nextAction}`);
  }

  const children = [...node.children.entries()];
  const childPrefix = prefix ? `${prefix}${isLast ? '    ' : '│   '}` : '';
  for (let index = 0; index < children.length; index++) {
    renderSearchTreeNode(children[index][0], children[index][1], childPrefix, index === children.length - 1, lines);
  }
}

function formatSearchFile(name: string, result?: FsSearchResult['results'][number]): string {
  if (!result) return name;
  const marker = result.writable ? '[RW]' : result.readable ? '[R-]' : '[--]';
  return `${marker} ${name}`;
}

function scoreName(candidate: string, query: string, isRegex: boolean): number {
  if (isRegex) return 300;
  const basename = path.posix.basename(candidate).toLowerCase();
  if (basename === query) return 700;
  if (basename.includes(query)) return 500;
  if (candidate.toLowerCase().includes(query)) return 350;
  return 0;
}

function findAgents(
  agents: Agent[],
  checker: IPathPermissionChecker,
  filePath: string,
  right: 'read' | 'write'
) {
  return agents
    .filter((agent) =>
      right === 'read'
        ? checker.canReadPath(agent.permissions, filePath)
        : checker.canWritePath(agent.permissions, filePath)
    )
    .map((agent) => ({ contextId: agent.id, label: agent.name }));
}
