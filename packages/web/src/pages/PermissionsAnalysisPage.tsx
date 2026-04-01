import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { API_BASE, useTeam } from '../context/TeamContext';
import { usePermissionAnalysis, filterRegionsForAgent } from '../hooks/usePermissionAnalysis';
import type { Agent, PermissionOverlapRegion, PermissionRight } from '../types';
import { PermissionOverlapDiagram } from '../components/permissions/PermissionOverlapDiagram';
import { PermissionOverlapInspector } from '../components/permissions/PermissionOverlapInspector';
import { PermissionRelationshipMap } from '../components/permissions/PermissionRelationshipMap';
import { formatMetricValue, formatRightMetric, getRegionMetricValue, getResponsibilityMetricValue } from '../utils/permissionMetrics';
import { PortfolioFileAccessSection } from '../components/portfolio/PortfolioFileAccessSection';
import '../components/permissions/PermissionsAnalysis.css';

function regionPeerName(region: PermissionOverlapRegion, agentsById: Map<string, Agent>): string {
  const peerId = region.peerAgentIds[0];
  return agentsById.get(peerId)?.name ?? peerId;
}

async function openPermissionFileInIde(agentId: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/ide/open-file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath: `.ai-team/agents/${agentId}.perm` }),
    });
  } catch {
    // IDE bridge may not be connected.
  }
}

export function PermissionsAnalysisPage() {
  const navigate = useNavigate();
  const { agents } = useTeam();
  const [requested, setRequested] = useState(false);
  const [selectedRight, setSelectedRight] = useState<PermissionRight>('write');
  const [mapMode, setMapMode] = useState<'focused' | 'relationship'>('focused');
  const { view, isLoading, error, analyze, isFetching } = usePermissionAnalysis({ enabled: requested });
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [selectedRegionId, setSelectedRegionId] = useState<string | undefined>(undefined);

  const agentsById = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);

  useEffect(() => {
    if (!view) {
      return;
    }
    setSelectedAgentId((current) => current || view.regions[0]?.focusAgentId || view.agentIds[0] || '');
  }, [view]);

  const focusAgent = agentsById.get(selectedAgentId);
  const focusRegions = useMemo(
    () => (view && selectedAgentId ? filterRegionsForAgent(view, selectedAgentId) : []),
    [selectedAgentId, view],
  );
  const focusRegionsForGraph = useMemo(
    () => focusRegions.filter((region) => getRegionMetricValue(region, selectedRight) > 0),
    [focusRegions, selectedRight],
  );

  useEffect(() => {
    setSelectedRegionId((current) => {
      if (current && focusRegions.some((region) => region.id === current)) {
        return current;
      }
      return focusRegions[0]?.id;
    });
  }, [selectedAgentId, focusRegions]);

  const selectedRegion = focusRegions.find((region) => region.id === selectedRegionId) ?? focusRegions[0];
  const sharedPathsWithSelectedRegion = useMemo(
    () => new Set((selectedRegion?.sharedFiles ?? []).map((file) => file.path)),
    [selectedRegion],
  );
  const selectedOutsideDefaultEntries = useMemo(
    () => {
      if (!view || !selectedAgentId) {
        return [];
      }
      return (['read', 'write', 'list'] as PermissionRight[]).map((right) => ({
        right,
        files: view.outsideDefaultContextByAgent[selectedAgentId]?.[right]?.files ?? [],
      }));
    },
    [selectedAgentId, view],
  );
  const hasOutsideDefaultFiles = selectedOutsideDefaultEntries.some((entry) => entry.files.length > 0);

  const agentSummaries = useMemo(() => {
    if (!view) {
      return [];
    }
    return view.agentIds.map((agentId) => {
      const regions = filterRegionsForAgent(view, agentId);
      return {
        agentId,
        topRegion: [...regions].sort((left, right) =>
          right.totalLines - left.totalLines
          || right.totalFiles - left.totalFiles
          || right.totalLines - left.totalLines
        )[0],
        overlapCount: regions.length,
      };
    });
  }, [view]);

  if (!requested) {
    return (
      <div className="permissions-page">
        <section className="permissions-card permission-analysis-gate">
          <h1>Permissions Analysis</h1>
          <p>This analysis is intentionally on-demand because it is a relatively expensive workspace calculation. Run it when you want the whole-picture optimization view.</p>
          <button type="button" className="permission-analyze-button" onClick={() => setRequested(true)}>
            Analyze overlap
          </button>
        </section>
      </div>
    );
  }

  if (isLoading || isFetching) {
    return (
      <div className="permissions-page permissions-page-state">
        <i className="codicon codicon-loading codicon-modifier-spin" /> Loading permission analysis…
      </div>
    );
  }

  if (error) {
    return (
      <div className="permissions-page">
        <section className="permissions-card permission-analysis-gate">
          <h1>Permissions Analysis</h1>
          <p className="portfolio-section-error">{error instanceof Error ? error.message : 'Failed to load analysis'}</p>
          <button type="button" className="permission-analyze-button" onClick={() => void analyze()}>
            Retry overlap analysis
          </button>
        </section>
      </div>
    );
  }

  if (!view) {
    return <div className="permissions-page permissions-page-state">No permission analysis data available.</div>;
  }

  return (
    <div className="permissions-page">
      <header className="permissions-page-header">
        <div>
          <h1>Permissions Analysis</h1>
          <p>Explore overlapping file-system rights, uncovered files, and deterministic suggestions for cleaner ownership.</p>
        </div>
        <span className="permissions-generated-at">Generated {new Date(view.generatedAt).toLocaleString()}</span>
      </header>

      <section className="permissions-summary-grid">
        <div className="permission-summary-card">
          <span className="permission-summary-label">Workspace</span>
          <strong>{view.workspaceFileCount.toLocaleString()} files</strong>
          <span className="permission-muted">
            {view.rightUncovered.read.fileCount.toLocaleString()} / {view.rightUncovered.write.fileCount.toLocaleString()} / {view.rightUncovered.list.fileCount.toLocaleString()} uncovered (R/W/L)
          </span>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Code</span>
          <strong>{view.workspaceCodeFileCount.toLocaleString()} files</strong>
          <span className="permission-muted">
            {view.workspaceCodeLineCount.toLocaleString()} lines
          </span>
          <span className="permission-muted">
            {view.workspaceCodeUncoveredByRight.read.toLocaleString()} / {view.workspaceCodeUncoveredByRight.write.toLocaleString()} / {view.workspaceCodeUncoveredByRight.list.toLocaleString()} uncovered (R/W/L)
          </span>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Documentation</span>
          <strong>{view.workspaceDocumentationFileCount.toLocaleString()} files</strong>
          <span className="permission-muted">
            {view.workspaceDocumentationUncoveredByRight.read.toLocaleString()} / {view.workspaceDocumentationUncoveredByRight.write.toLocaleString()} / {view.workspaceDocumentationUncoveredByRight.list.toLocaleString()} uncovered (R/W/L)
          </span>
        </div>
        <div className="permission-summary-card">
          <span className="permission-summary-label">Binary</span>
          <strong>{view.workspaceBinaryFileCount.toLocaleString()} files</strong>
          <span className="permission-muted">
            {view.workspaceBinaryUncoveredByRight.read.toLocaleString()} / {view.workspaceBinaryUncoveredByRight.write.toLocaleString()} / {view.workspaceBinaryUncoveredByRight.list.toLocaleString()} uncovered (R/W/L)
          </span>
        </div>
      </section>

      <section className="permissions-card">
        <div className="permissions-card-header">
          <div>
            <h2>Interactive overlap map</h2>
            <p>
              {mapMode === 'focused'
                ? `Focus one agent at a time, then click the overlapping area to inspect ${selectedRight} overlap, file endings, and shared files.`
                : `Global relationship mode: circle size shows ${selectedRight} responsibility; distance/links show overlap strength. Uncovered area is shown as UNC.`}
            </p>
          </div>
          <div className="permissions-controls-row">
            <label className="permissions-select">
              <span>Focus agent</span>
              <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
                {view.agentIds.map((agentId) => (
                  <option key={agentId} value={agentId}>
                    {agentsById.get(agentId)?.name ?? agentId}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="permission-overlap-main">
          <div className="permission-graph-tile">
            {mapMode === 'focused' ? (
              <PermissionOverlapDiagram
                focusAgent={focusAgent}
                agentsById={agentsById}
                regions={focusRegionsForGraph}
                selectedRight={selectedRight}
                overlay={(
                  <div className="permission-overlap-inline-controls">
                    <label className="permissions-select permission-overlap-inline-select">
                      <span>Map mode</span>
                      <select value={mapMode} onChange={(event) => setMapMode(event.target.value as 'focused' | 'relationship')}>
                        <option value="focused">Focused overlap</option>
                        <option value="relationship">Relationship map</option>
                      </select>
                    </label>
                    <label className="permissions-select permission-overlap-inline-select">
                      <span>Permission type</span>
                      <select value={selectedRight} onChange={(event) => setSelectedRight(event.target.value as PermissionRight)}>
                        <option value="write">write</option>
                        <option value="read">read</option>
                        <option value="list">list</option>
                      </select>
                    </label>
                  </div>
                )}
                onSelectAgent={(agentId) => {
                  setSelectedAgentId(agentId);
                  void openPermissionFileInIde(agentId);
                }}
              responsibilityMetricByAgentId={Object.fromEntries(view.agentIds.map((agentId) => [
                agentId,
                getResponsibilityMetricValue(view.agentResponsibilities[agentId], selectedRight),
              ]))}
              responsibilityFileCountByAgentId={Object.fromEntries(view.agentIds.map((agentId) => [
                agentId,
                view.agentResponsibilities[agentId]?.rightFileCounts[selectedRight] ?? 0,
              ]))}
              selectedRegionId={selectedRegion?.id}
              onSelectRegion={setSelectedRegionId}
              emptyLabel={`This agent has no ${selectedRight} overlap regions in the current file analysis.`}
            />
          ) : (
            <PermissionRelationshipMap
              view={view}
              agentsById={agentsById}
              selectedRight={selectedRight}
              overlay={(
                <div className="permission-overlap-inline-controls">
                  <label className="permissions-select permission-overlap-inline-select">
                    <span>Map mode</span>
                    <select value={mapMode} onChange={(event) => setMapMode(event.target.value as 'focused' | 'relationship')}>
                      <option value="focused">Focused overlap</option>
                      <option value="relationship">Relationship map</option>
                    </select>
                  </label>
                  <label className="permissions-select permission-overlap-inline-select">
                    <span>Permission type</span>
                    <select value={selectedRight} onChange={(event) => setSelectedRight(event.target.value as PermissionRight)}>
                      <option value="write">write</option>
                      <option value="read">read</option>
                      <option value="list">list</option>
                    </select>
                  </label>
                </div>
              )}
              selectedAgentId={selectedAgentId}
              onSelectAgent={(agentId) => {
                setSelectedAgentId(agentId);
                void openPermissionFileInIde(agentId);
              }}
              onSelectPairRegion={setSelectedRegionId}
              onOpenAgentPermissionFile={(agentId) => void openPermissionFileInIde(agentId)}
            />
            )}
          </div>
          <PermissionOverlapInspector
              region={selectedRegion}
              agentsById={agentsById}
              focusResponsibility={selectedRegion ? view.agentResponsibilities[selectedRegion.focusAgentId] : undefined}
              peerResponsibility={selectedRegion ? view.agentResponsibilities[selectedRegion.peerAgentIds[0]] : undefined}
              workspaceFileCount={view.workspaceFileCount}
              onOpenFocusPermissionFile={selectedRegion ? () => { void openPermissionFileInIde(selectedRegion.focusAgentId); } : undefined}
              onOpenPeerPermissionFile={selectedRegion ? () => { void openPermissionFileInIde(selectedRegion.peerAgentIds[0]); } : undefined}
              onOpenFocusPortfolio={selectedRegion ? () => navigate(`/portfolio/${selectedRegion.focusAgentId}`) : undefined}
              onOpenPeerPortfolio={selectedRegion ? () => navigate(`/portfolio/${selectedRegion.peerAgentIds[0]}`) : undefined}
              onFocusPeerAgent={selectedRegion ? () => {
                const peerId = selectedRegion.peerAgentIds[0];
                setSelectedAgentId(peerId);
                void openPermissionFileInIde(peerId);
              } : undefined}
            />
          </div>
          {selectedAgentId && hasOutsideDefaultFiles ? (
            <div className="permission-section-block">
              <h3>Allowed outside default context</h3>
              <p>
                Files this agent can access that are not included in the default/global context scope.
              </p>
              {selectedOutsideDefaultEntries.map(({ right, files }) => {
                return (
                  <div key={right} className="permission-section-block">
                    <h4>{right}</h4>
                    <ul className="permission-file-list">
                      {files.slice(0, 8).map((file) => (
                        <li key={`${right}:${file.path}`}>
                          <code>{file.path}</code>
                          <span>{file.lineCount.toLocaleString()} lines</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          ) : null}
          <div className="permission-section-block">
          <div className="permissions-card-header">
            <div>
              <h3>Edit selected agent rights</h3>
              <p>Click an agent in the map, then edit its file-tree permissions directly here. Shared files with the selected peer are highlighted in the tree.</p>
            </div>
          </div>
          {selectedAgentId ? (
            <PortfolioFileAccessSection
              agentId={selectedAgentId}
              forceEditMode
              highlightedPaths={sharedPathsWithSelectedRegion}
            />
          ) : null}
        </div>
      </section>

      <section className="permissions-card">
        <div className="permissions-card-header">
          <div>
            <h2>All agents at a glance</h2>
            <p>Quickly scan which agents overlap most, which rights are shared, and what kind of files those overlaps cover.</p>
          </div>
        </div>

        <div className="permissions-agent-grid">
          {agentSummaries.map((summary) => (
            <button
              key={summary.agentId}
              type="button"
              className={`permissions-agent-card ${summary.agentId === selectedAgentId ? 'permissions-agent-card-active' : ''}`}
              onClick={() => setSelectedAgentId(summary.agentId)}
            >
              <strong>{agentsById.get(summary.agentId)?.name ?? summary.agentId}</strong>
              <span>{summary.overlapCount} overlapping peer{summary.overlapCount === 1 ? '' : 's'}</span>
              <span>
                {summary.topRegion
                  ? `Top: ${regionPeerName(summary.topRegion, agentsById)} · ${summary.topRegion.totalLines.toLocaleString()} lines`
                  : 'No overlap'}
              </span>
              <span>
                {summary.topRegion
                  ? `write: ${formatRightMetric(summary.topRegion, 'write')}`
                  : 'write: 0'}
              </span>
              <div className="permission-inline-list">
                {(summary.topRegion?.sharedRights ?? []).map((right) => (
                  <span key={right} className={`permission-chip permission-chip-right permission-chip-right-${right}`}>
                    {right}
                  </span>
                ))}
              </div>
              <div className="permission-inline-list">
                {(summary.topRegion?.rightFileEndingSummary?.write ?? summary.topRegion?.fileEndingSummary ?? []).slice(0, 3).map((entry) => (
                  <span key={entry.extension} className="permission-mini-pill">
                    {entry.extension}
                  </span>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className="permissions-card">
        <div className="permissions-card-header">
          <div>
            <h2>Uncovered files</h2>
            <p>Files not assigned to any agent, summarized by ending so you can quickly see whether the gaps are code, docs, config, tests, or other files.</p>
          </div>
        </div>

        <div className="permissions-two-column">
          <div>
            <h3>By ending</h3>
            <ul className="permission-ending-list">
              {view.uncoveredFileEndings.slice(0, 8).map((entry) => (
                <li key={entry.extension}>
                  <span>{entry.extension}</span>
                  <span>{entry.fileCount} files</span>
                  <span>{entry.lineCount.toLocaleString()} lines</span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h3>By type</h3>
            <ul className="permission-ending-list">
              {view.uncoveredFileTypes.slice(0, 8).map((entry) => (
                <li key={entry.category}>
                  <span>{entry.category}</span>
                  <span>{entry.fileCount} files</span>
                  <span>{entry.lineCount.toLocaleString()} lines</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="permission-section-block">
          <h3>Sample uncovered files</h3>
          <ul className="permission-file-list">
            {view.globallyUncoveredFiles.slice(0, 16).map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
                <span>{file.lineCount.toLocaleString()} lines</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="permissions-card">
        <div className="permissions-card-header">
          <div>
            <h2>Organization hotspots</h2>
            <p>The biggest shared surfaces across the whole structure, independent of the currently focused agent.</p>
          </div>
        </div>

        <div className="permissions-suggestion-list">
          {view.regions.slice(0, 6).map((region) => (
            <article key={region.id} className="permissions-suggestion">
              <header>
                <span className="permission-chip">{region.label.replace('::', ' × ')}</span>
                <h3>{region.totalFiles} files · {region.totalLines.toLocaleString()} lines</h3>
              </header>
              <div className="permission-inline-list">
                {region.sharedRights.map((right) => (
                  <span key={right} className={`permission-chip permission-chip-right permission-chip-right-${right}`}>{right}</span>
                ))}
              </div>
              <div className="permission-inline-list">
                {(['read', 'write', 'list'] as PermissionRight[]).map((right) => (
                  <span key={`${region.id}-${right}`} className="permission-mini-pill">
                    {right}: {formatRightMetric(region, right)}
                  </span>
                ))}
              </div>
              <div className="permission-inline-list">
                {region.fileEndingSummary.slice(0, 4).map((entry) => (
                  <span key={entry.extension} className="permission-mini-pill">
                    {entry.extension} · {entry.fileCount}
                  </span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="permissions-card">
        <div className="permissions-card-header">
          <div>
            <h2>Suggestions</h2>
            <p>Deterministic suggestions derived from the current overlap report. These are intended to guide permission cleanup, not apply changes automatically.</p>
          </div>
        </div>

        <div className="permissions-suggestion-list">
          {view.suggestions.map((suggestion) => (
            <article key={suggestion.id} className={`permissions-suggestion permissions-suggestion-${suggestion.severity}`}>
              <header>
                <span className={`permission-chip permission-chip-severity permission-chip-severity-${suggestion.severity}`}>
                  {suggestion.severity}
                </span>
                <h3>{suggestion.title}</h3>
              </header>
              <p>{suggestion.rationale}</p>
              <div className="permission-inline-list">
                {suggestion.fileScope.slice(0, 4).map((scope) => (
                  <span key={scope} className="permission-mini-pill">{scope}</span>
                ))}
              </div>
              <div className="permission-inline-list">
                {suggestion.affectedRights.map((right) => (
                  <span key={right} className={`permission-chip permission-chip-right permission-chip-right-${right}`}>{right}</span>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
