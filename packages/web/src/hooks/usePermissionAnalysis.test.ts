import { describe, expect, it } from 'vitest';
import type { PermissionOverlapReport } from '../types';
import { buildPermissionAnalysisView, filterRegionsForAgent } from './usePermissionAnalysis';

function makeReport(): PermissionOverlapReport {
  return {
    kind: 'files',
    generatedAt: '2026-03-31T12:00:00.000Z',
    agentIds: ['daniel-navarro', 'clara-bishop', 'samuel-ceeses'],
    workspaceFileCount: 12,
    rights: {
      read: {
        right: 'read',
        totalFiles: 12,
        uncoveredFiles: [{ path: 'docs/guide.md', extension: '.md', lineCount: 20, agentIds: [] }],
        singlyOwnedFiles: [],
        overlappingFiles: [
          { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
        ],
        agentResponsibilities: [],
        pairs: [
          {
            agentA: 'daniel-navarro',
            agentB: 'clara-bishop',
            sharedFileCount: 2,
            sharedLineCount: 140,
            unionFileCount: 5,
            overlapRatio: 0.4,
            sharedFiles: [
              { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
              { path: 'packages/web/src/components/portfolio/PortfolioOverlapView.tsx', extension: '.tsx', lineCount: 40, agentIds: ['daniel-navarro', 'clara-bishop'] },
            ],
            byExtension: [{ extension: '.tsx', fileCount: 2, lineCount: 140 }],
          },
        ],
      },
      write: {
        right: 'write',
        totalFiles: 6,
        uncoveredFiles: [{ path: 'docs/guide.md', extension: '.md', lineCount: 20, agentIds: [] }],
        singlyOwnedFiles: [],
        overlappingFiles: [
          { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
        ],
        agentResponsibilities: [
          { agentId: 'samuel-ceeses', fileCount: 1, lineCount: 15, byExtension: [{ extension: '.css', fileCount: 1, lineCount: 15 }] },
          { agentId: 'daniel-navarro', fileCount: 2, lineCount: 140, byExtension: [{ extension: '.tsx', fileCount: 2, lineCount: 140 }] },
        ],
        pairs: [
          {
            agentA: 'daniel-navarro',
            agentB: 'clara-bishop',
            sharedFileCount: 1,
            sharedLineCount: 100,
            unionFileCount: 4,
            overlapRatio: 0.25,
            sharedFiles: [
              { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
            ],
            byExtension: [{ extension: '.tsx', fileCount: 1, lineCount: 100 }],
          },
        ],
      },
      list: {
        right: 'list',
        totalFiles: 12,
        uncoveredFiles: [{ path: 'docs/guide.md', extension: '.md', lineCount: 20, agentIds: [] }],
        singlyOwnedFiles: [],
        overlappingFiles: [
          { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
        ],
        agentResponsibilities: [],
        pairs: [
          {
            agentA: 'daniel-navarro',
            agentB: 'clara-bishop',
            sharedFileCount: 2,
            sharedLineCount: 140,
            unionFileCount: 5,
            overlapRatio: 0.4,
            sharedFiles: [
              { path: 'packages/web/src/components/Portfolio.tsx', extension: '.tsx', lineCount: 100, agentIds: ['daniel-navarro', 'clara-bishop'] },
              { path: 'packages/web/src/components/portfolio/PortfolioOverlapView.tsx', extension: '.tsx', lineCount: 40, agentIds: ['daniel-navarro', 'clara-bishop'] },
            ],
            byExtension: [{ extension: '.tsx', fileCount: 2, lineCount: 140 }],
          },
        ],
      },
    },
    outsideDefaultContextByAgent: [
      {
        agentId: 'daniel-navarro',
        rights: {
          read: { fileCount: 1, lineCount: 20, files: [{ path: 'docs/guide.md', extension: '.md', lineCount: 20, agentIds: ['daniel-navarro'] }] },
          write: { fileCount: 0, lineCount: 0, files: [] },
          list: { fileCount: 1, lineCount: 20, files: [{ path: 'docs/guide.md', extension: '.md', lineCount: 20, agentIds: ['daniel-navarro'] }] },
        },
      },
      {
        agentId: 'clara-bishop',
        rights: {
          read: { fileCount: 0, lineCount: 0, files: [] },
          write: { fileCount: 0, lineCount: 0, files: [] },
          list: { fileCount: 0, lineCount: 0, files: [] },
        },
      },
      {
        agentId: 'samuel-ceeses',
        rights: {
          read: { fileCount: 0, lineCount: 0, files: [] },
          write: { fileCount: 0, lineCount: 0, files: [] },
          list: { fileCount: 0, lineCount: 0, files: [] },
        },
      },
    ],
  };
}

describe('buildPermissionAnalysisView', () => {
  it('derives deterministic suggestions and quick file-type summaries', () => {
    const report = makeReport();

    const first = buildPermissionAnalysisView(report);
    const second = buildPermissionAnalysisView(report);

    expect(first.suggestions).toEqual(second.suggestions);
    expect(first.uncoveredFileEndings[0]).toMatchObject({
      extension: '.md',
      category: 'documentation',
      fileCount: 1,
    });
    expect(first.regions[0]).toMatchObject({
      id: 'clara-bishop::daniel-navarro',
      totalFiles: 2,
    });
    expect(first.regions[0]?.rightLineCounts.write).toBe(100);
    expect(first.regions[0]?.rightFolderCounts?.read).toBe(2);
    expect(first.regions[0]?.rightFileEndingSummary?.write?.[0]?.extension).toBe('.tsx');
    expect(first.defaultContextByRight.write).toBe(11);
    expect(first.defaultReadContextFileCount).toBe(11);
    expect(first.defaultReadContextLineCount).toBe(100);
    expect(first.workspaceUncoveredFileCount).toBe(1);
    expect(first.workspaceCodeFileCount).toBe(1);
    expect(first.workspaceCodeLineCount).toBe(100);
    expect(first.workspaceCodeUncoveredFileCount).toBe(0);
    expect(first.workspaceCodeUncoveredByRight.read).toBe(0);
    expect(first.workspaceCodeUncoveredByRight.write).toBe(0);
    expect(first.workspaceCodeUncoveredByRight.list).toBe(0);
    expect(first.workspaceDocumentationFileCount).toBe(1);
    expect(first.workspaceDocumentationUncoveredFileCount).toBe(1);
    expect(first.workspaceDocumentationUncoveredByRight.read).toBe(1);
    expect(first.workspaceDocumentationUncoveredByRight.write).toBe(1);
    expect(first.workspaceDocumentationUncoveredByRight.list).toBe(1);
    expect(first.workspaceBinaryFileCount).toBe(0);
    expect(first.workspaceBinaryUncoveredFileCount).toBe(0);
    expect(first.workspaceBinaryUncoveredByRight.read).toBe(0);
    expect(first.workspaceBinaryUncoveredByRight.write).toBe(0);
    expect(first.workspaceBinaryUncoveredByRight.list).toBe(0);
    expect(first.totalAgentContextByRight.write).toBe(100);
    expect(first.outsideDefaultContextByAgent['daniel-navarro']?.read.fileCount).toBe(1);
  });

  it('filters the whole-picture view down to a single-agent optimization view', () => {
    const view = buildPermissionAnalysisView(makeReport());

    const danielRegions = filterRegionsForAgent(view, 'daniel-navarro');

    expect(danielRegions).toHaveLength(1);
    expect(danielRegions[0]?.focusAgentId).toBe('daniel-navarro');
    expect(danielRegions[0]?.peerAgentIds).toEqual(['clara-bishop']);
  });
});
