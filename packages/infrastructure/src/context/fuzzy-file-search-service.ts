import type { FuzzyFileMatch, IFuzzyFileSearch, PermissionConfig } from '@ai-team/core';
import { normalizePath } from 'fs-context';
import { AgentRuntimeFactory } from './permission-services.js';
import { rankSimilarFiles } from '../utils/fuzzy-file-search.js';

export class InfrastructureFuzzyFileSearch implements IFuzzyFileSearch {
  constructor(private readonly workspaceRoot: string) {}

  findSimilar(
    requestedPath: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[],
    maxResults = 10
  ): string[] {
    return this.findSimilarRanked(requestedPath, permissions, allFiles)
      .slice(0, maxResults)
      .map((match) => match.path);
  }

  findSimilarRanked(
    requestedPath: string,
    permissions: PermissionConfig | undefined,
    allFiles: string[],
    options?: { minScore?: number }
  ): FuzzyFileMatch[] {
    // Normalize the requested path to workspace-relative
    const normalizedRequest = normalizePath(requestedPath, this.workspaceRoot);

    // Resolve which files the agent can actually read
    const runtimeFactory = new AgentRuntimeFactory(this.workspaceRoot);
    const runtime = runtimeFactory.create('__fuzzy', permissions, allFiles);
    const readableFiles = allFiles.filter(
      (f) => runtime.canRead('__fuzzy', normalizePath(f, this.workspaceRoot))
    );

    return rankSimilarFiles(normalizedRequest, readableFiles, options?.minScore);
  }
}
