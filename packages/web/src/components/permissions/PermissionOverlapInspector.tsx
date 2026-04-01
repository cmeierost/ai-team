import type { CSSProperties } from 'react';
import type {
  Agent,
  FileTypeSummary,
  PermissionAgentResponsibilitySummary,
  PermissionOverlapRegion,
  PermissionRight,
} from '../../types';
import { formatRightMetric } from '../../utils/permissionMetrics';
import { getAgentHue } from '../../utils/color';
import { Avatar } from '../Avatar';

interface PermissionOverlapInspectorProps {
  region?: PermissionOverlapRegion;
  agentsById: Map<string, Agent>;
  focusResponsibility?: PermissionAgentResponsibilitySummary;
  peerResponsibility?: PermissionAgentResponsibilitySummary;
  workspaceFileCount?: number;
  onOpenFocusPermissionFile?: () => void;
  onOpenPeerPermissionFile?: () => void;
  onOpenFocusPortfolio?: () => void;
  onOpenPeerPortfolio?: () => void;
  onFocusPeerAgent?: () => void;
}

function formatCategoryLabel(category: FileTypeSummary['category']): string {
  switch (category) {
    case 'code':
      return 'Code';
    case 'documentation':
      return 'Docs';
    case 'configuration':
      return 'Config';
    case 'tests':
      return 'Tests';
    case 'assets':
      return 'Assets';
    default:
      return 'Other';
  }
}

function describeHierarchy(focusAgent: Agent | undefined, peerAgent: Agent | undefined): string {
  if (!focusAgent || !peerAgent) {
    return 'Hierarchy relation unavailable.';
  }
  if (focusAgent.reportsTo && focusAgent.reportsTo === peerAgent.id) {
    return `${focusAgent.name} reports to ${peerAgent.name}.`;
  }
  if (peerAgent.reportsTo && peerAgent.reportsTo === focusAgent.id) {
    return `${peerAgent.name} reports to ${focusAgent.name}.`;
  }
  if (focusAgent.reportsTo && peerAgent.reportsTo && focusAgent.reportsTo === peerAgent.reportsTo) {
    return 'They are teammates (same manager).';
  }
  return 'No direct reporting link detected.';
}

export function PermissionOverlapInspector({
  region,
  agentsById,
  focusResponsibility,
  peerResponsibility,
  workspaceFileCount = 0,
  onOpenFocusPermissionFile,
  onOpenPeerPermissionFile,
  onOpenFocusPortfolio,
  onOpenPeerPortfolio,
  onFocusPeerAgent,
}: Readonly<PermissionOverlapInspectorProps>) {
  if (!region) {
    return (
      <div className="permission-inspector permission-inspector-empty">
        <h3>Overlap details</h3>
        <p>Select a circle to inspect the overlap, file endings, rights, and shared files.</p>
      </div>
    );
  }

  const focusAgent = agentsById.get(region.focusAgentId);
  const peerAgent = agentsById.get(region.peerAgentIds[0]);
  const endingSummary = region.fileEndingSummary;
  const typeSummary = region.fileTypeSummary;
  const rights: PermissionRight[] = ['read', 'write', 'list'];
  const compareRows = rights.map((right) => {
    const sharedFiles = region.rightFileCounts[right] ?? 0;
    const focusTotal = focusResponsibility?.rightFileCounts[right] ?? 0;
    const peerTotal = peerResponsibility?.rightFileCounts[right] ?? 0;
    return {
      right,
      sharedFiles,
      focusPct: focusTotal > 0 ? (sharedFiles / focusTotal) * 100 : 0,
      peerPct: peerTotal > 0 ? (sharedFiles / peerTotal) * 100 : 0,
    };
  });
  const hierarchyDescription = describeHierarchy(focusAgent, peerAgent);
  const focusHue = focusAgent ? getAgentHue(focusAgent) : 210;
  const peerHue = peerAgent ? getAgentHue(peerAgent) : 210;
  return (
    <div className="permission-inspector">
      <div className="permission-inspector-header">
        <div className="permission-inspector-agent-row">
          <Avatar agent={focusAgent} size="small" />
          <h3>{focusAgent?.name ?? region.focusAgentId}</h3>
          <span className="permission-muted">×</span>
          <Avatar agent={peerAgent} size="small" />
          <h3>{peerAgent?.name ?? region.peerAgentIds[0]}</h3>
        </div>
      </div>

      <div className="permission-section-block">
        <h4>Agent contexts</h4>
        <p className="permission-muted">{hierarchyDescription}</p>
        <div className="permission-context-stack">
          <div
            className="permission-summary-card permission-agent-context-card"
            style={{ '--agent-hue': `${focusHue}` } as CSSProperties}
          >
            <div className="permission-inspector-agent-row">
              <Avatar agent={focusAgent} size="small" />
              <span className="permission-summary-label">{focusAgent?.name ?? region.focusAgentId}</span>
            </div>
            <span className="permission-muted">{focusAgent?.role ?? 'agent'}</span>
            <div className="permission-inline-list">
              <button type="button" className="permission-context-mini-button" onClick={onOpenFocusPermissionFile}>
                Open perm
              </button>
              <button type="button" className="permission-context-mini-button" onClick={onOpenFocusPortfolio}>
                Open portfolio
              </button>
            </div>
            <div className="permission-right-grid">
              {rights.map((right) => (
                <div key={`focus-${right}`} className={`permission-right-card permission-chip-right-${right}`}>
                  <span className="permission-right-name">{right}</span>
                  {(right === 'read' || right === 'write')
                    ? (
                        <span>
                          {(focusResponsibility?.rightLineCounts[right] ?? 0).toLocaleString()} lines
                        </span>
                      )
                    : (
                        <span>{(focusResponsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files</span>
                      )}
                  {(right === 'read' || right === 'write') ? (
                    <span className="permission-muted">
                      {(focusResponsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files
                    </span>
                  ) : null}
                  <span className="permission-muted">
                    {workspaceFileCount > 0
                      ? `${(((focusResponsibility?.rightFileCounts[right] ?? 0) / workspaceFileCount) * 100).toFixed(1)}% workspace`
                      : '0.0% workspace'}
                  </span>
                </div>
              ))}
            </div>
          </div>
          <div
            className="permission-summary-card permission-agent-context-card"
            style={{ '--agent-hue': `${peerHue}` } as CSSProperties}
          >
            <div className="permission-inspector-agent-row">
              <Avatar agent={peerAgent} size="small" />
              <span className="permission-summary-label">{peerAgent?.name ?? region.peerAgentIds[0]}</span>
            </div>
            <span className="permission-muted">{peerAgent?.role ?? 'agent'}</span>
            <div className="permission-inline-list">
              <button type="button" className="permission-context-mini-button" onClick={onFocusPeerAgent}>
                Focus
              </button>
              <button type="button" className="permission-context-mini-button" onClick={onOpenPeerPermissionFile}>
                Open perm
              </button>
              <button type="button" className="permission-context-mini-button" onClick={onOpenPeerPortfolio}>
                Open portfolio
              </button>
            </div>
            <div className="permission-right-grid">
              {rights.map((right) => (
                <div key={`peer-${right}`} className={`permission-right-card permission-chip-right-${right}`}>
                  <span className="permission-right-name">{right}</span>
                  {(right === 'read' || right === 'write')
                    ? (
                        <span>
                          {(peerResponsibility?.rightLineCounts[right] ?? 0).toLocaleString()} lines
                        </span>
                      )
                    : (
                        <span>{(peerResponsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files</span>
                      )}
                  {(right === 'read' || right === 'write') ? (
                    <span className="permission-muted">
                      {(peerResponsibility?.rightFileCounts[right] ?? 0).toLocaleString()} files
                    </span>
                  ) : null}
                  <span className="permission-muted">
                    {workspaceFileCount > 0
                      ? `${(((peerResponsibility?.rightFileCounts[right] ?? 0) / workspaceFileCount) * 100).toFixed(1)}% workspace`
                      : '0.0% workspace'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="permission-section-block">
        <h4>Overlap</h4>
        <div className="permission-right-grid">
          {compareRows.map((row) => (
            <div key={row.right} className="permission-right-card">
              <span className="permission-right-name">{row.right}</span>
              <span>{formatRightMetric(region, row.right)}</span>
              {(row.right === 'read' || row.right === 'write') ? (
                <span className="permission-muted">{row.sharedFiles.toLocaleString()} files</span>
              ) : null}
              <span className="permission-muted">{row.focusPct.toFixed(1)}% / {row.peerPct.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="permission-chip-row">
        {region.sharedRights.map((right) => (
          <span key={right} className={`permission-chip permission-chip-right permission-chip-right-${right}`}>
            {right}
          </span>
        ))}
      </div>

      <div className="permission-summary-grid">
        <div className="permission-summary-card">
          <span className="permission-summary-label">Dominant endings</span>
          <div className="permission-inline-list">
            {endingSummary.slice(0, 4).map((entry) => (
              <span key={entry.extension} className="permission-mini-pill">
                {entry.extension} · {entry.fileCount}
              </span>
            ))}
          </div>
        </div>

        <div className="permission-summary-card">
          <span className="permission-summary-label">File types</span>
          <div className="permission-inline-list">
            {typeSummary.slice(0, 4).map((entry) => (
              <span key={entry.category} className="permission-mini-pill">
                {formatCategoryLabel(entry.category)} · {entry.fileCount}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
