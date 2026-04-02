import React from 'react';
import type {
  AnalysisResult,
  Grouping,
  Group,
  GroupCouplingProfile,
  CodeRoleClassification,
  MisplacedFile,
} from '../types.js';
import { COLORS, pct, shortPath } from '../types.js';

export interface DetailPanelProps {
  selectedNodeId: string | null;
  data: AnalysisResult;
}

/* ---------- Styles ---------- */

const panelStyle: React.CSSProperties = {
  fontFamily: 'system-ui, sans-serif',
  padding: 16,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  overflowY: 'auto',
  height: '100%',
  boxSizing: 'border-box',
};

const emptyStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: '100%',
  fontSize: 13,
  color: '#94a3b8',
  fontFamily: 'system-ui, sans-serif',
};

const headingStyle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  color: '#1e293b',
  wordBreak: 'break-all',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: '#64748b',
  marginBottom: 4,
};

const metricRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  fontSize: 12,
  padding: '3px 0',
  borderBottom: '1px solid #f1f5f9',
};

const badgeStyle = (bg: string, fg: string): React.CSSProperties => ({
  display: 'inline-block',
  fontSize: 10,
  fontWeight: 600,
  padding: '1px 7px',
  borderRadius: 6,
  background: bg,
  color: fg,
});

const memberRowStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '3px 0',
  borderBottom: '1px solid #f1f5f9',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

const roleBadgeColors: Record<string, string> = {
  utility: COLORS.utility,
  contract: COLORS.contract,
  business_logic: COLORS.business_logic,
  presentation: COLORS.presentation,
  unknown: COLORS.unknown,
};

/* ---------- Helpers ---------- */

function findGroupMatch(
  data: AnalysisResult,
  nodeId: string,
): { grouping: Grouping; group: Group } | null {
  const groupings = [
    data.boundaryGrouping,
    data.referenceGrouping,
    data.directoryGrouping,
  ].filter(Boolean) as Grouping[];

  for (const g of groupings) {
    const match = g.groups.find((gr) => gr.id === nodeId);
    if (match) return { grouping: g, group: match };
  }
  return null;
}

function findProfile(
  data: AnalysisResult,
  groupId: string,
): GroupCouplingProfile | undefined {
  return data.groupCoupling?.profiles.find((p) => p.groupId === groupId);
}

function findClassification(
  data: AnalysisResult,
  entityId: string,
): CodeRoleClassification | undefined {
  return data.codeRoles?.classifications?.find((c) => c.entityId === entityId);
}

function findMisplaced(
  data: AnalysisResult,
  entityId: string,
): MisplacedFile | undefined {
  return data.coherence?.misplacedFiles?.find((m) => m.entityId === entityId);
}

function findComplexity(
  data: AnalysisResult,
  entityId: string,
): number | undefined {
  return data.complexity?.cyclomatic?.find((c) => c.entityId === entityId)?.cyclomaticComplexity;
}

interface EdgeInfo {
  targetId: string;
  label: string;
}

function resolveGroupLabel(data: AnalysisResult, groupId: string): string {
  const profile = data.groupCoupling?.profiles.find((p) => p.groupId === groupId);
  return profile?.groupLabel ?? groupId;
}

function collectEdges(
  data: AnalysisResult,
  groupId: string,
  direction: 'outbound' | 'inbound',
): EdgeInfo[] {
  const pairCouplings = data.groupCoupling?.pairCouplings ?? [];
  const edges: EdgeInfo[] = [];
  for (const pair of pairCouplings) {
    if (direction === 'outbound' && pair.sourceGroupId === groupId) {
      edges.push({ targetId: pair.targetGroupId, label: resolveGroupLabel(data, pair.targetGroupId) });
    }
    if (direction === 'inbound' && pair.targetGroupId === groupId) {
      edges.push({ targetId: pair.sourceGroupId, label: resolveGroupLabel(data, pair.sourceGroupId) });
    }
  }
  return edges;
}

/* ---------- Sub-components ---------- */

function GroupDetail({ data, grouping, group }: {
  data: AnalysisResult;
  grouping: Grouping;
  group: Group;
}) {
  const profile = findProfile(data, group.id);
  const outEdges = collectEdges(data, group.id, 'outbound');
  const inEdges = collectEdges(data, group.id, 'inbound');

  return (
    <>
      <div>
        <div style={headingStyle}>{group.label}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>
          Group · {grouping.label} ({grouping.kind})
        </div>
      </div>

      {/* Coupling profile metrics */}
      {profile && (
        <div>
          <div style={sectionTitleStyle}>Coupling Profile</div>
          <div>
            <MetricRow label="Members" value={String(profile.memberCount)} />
            <MetricRow label="Internal Cohesion" value={pct(profile.internalCohesion)} />
            <MetricRow label="Separability Index" value={pct(profile.separabilityIndex)} />
            <MetricRow label="API Surface" value={`${profile.apiSurfaceSize} (${pct(profile.apiSurfaceRatio)})`} />
            <MetricRow label="Internal Edges" value={String(profile.internalEdges)} />
            <MetricRow label="Outbound Edges" value={String(profile.outboundEdges)} />
            <MetricRow label="Inbound Edges" value={String(profile.inboundEdges)} />
            <MetricRow label="Outbound Type-Only" value={pct(profile.outboundTypeOnlyRatio)} />
            <MetricRow label="Inbound Type-Only" value={pct(profile.inboundTypeOnlyRatio)} />
          </div>
        </div>
      )}

      {/* Members */}
      <div>
        <div style={sectionTitleStyle}>Members ({group.memberEntityIds.length})</div>
        <div style={{ maxHeight: 200, overflowY: 'auto' }}>
          {group.memberEntityIds.map((eid) => {
            const cls = findClassification(data, eid);
            const role = cls?.role ?? 'unknown';
            const rColor = roleBadgeColors[role] ?? COLORS.unknown;
            return (
              <div key={eid} style={memberRowStyle}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {cls?.filePath ? shortPath(cls.filePath) : eid}
                </span>
                <span style={badgeStyle(`${rColor}20`, rColor)}>{role}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Edges */}
      {outEdges.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>Outbound ({outEdges.length})</div>
          {outEdges.map((e) => (
            <div key={e.targetId} style={{ fontSize: 12, color: '#475569', padding: '2px 0' }}>→ {e.label}</div>
          ))}
        </div>
      )}
      {inEdges.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>Inbound ({inEdges.length})</div>
          {inEdges.map((e) => (
            <div key={e.targetId} style={{ fontSize: 12, color: '#475569', padding: '2px 0' }}>← {e.label}</div>
          ))}
        </div>
      )}
    </>
  );
}

function FileDetail({ data, nodeId }: { data: AnalysisResult; nodeId: string }) {
  const cls = findClassification(data, nodeId);
  const misplaced = findMisplaced(data, nodeId);
  const complexity = findComplexity(data, nodeId);
  const role = cls?.role ?? 'unknown';
  const rColor = roleBadgeColors[role] ?? COLORS.unknown;

  // Derive dependencies from coupling data or graph relationships
  const classifications = data.codeRoles?.classifications ?? [];
  const allEntityIds = classifications.map((c) => c.entityId);

  // Find dependencies/dependents via the summary's mostCoupledEntities or from the coupling section
  // For a detailed view, we look at the coupling matrix relationships if available
  const deps: string[] = [];
  const dependents: string[] = [];

  // Search through all groupings to find which group contains this entity
  const groupings = [
    data.boundaryGrouping,
    data.referenceGrouping,
    data.directoryGrouping,
  ].filter(Boolean) as import('../types.js').Grouping[];

  let containingGroup: string | undefined;
  for (const g of groupings) {
    for (const gr of g.groups) {
      if (gr.memberEntityIds.includes(nodeId)) {
        containingGroup = gr.label;
        break;
      }
    }
    if (containingGroup) break;
  }

  return (
    <>
      <div>
        <div style={headingStyle}>{cls?.filePath ?? nodeId}</div>
        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>File entity</div>
      </div>

      <div>
        <div style={sectionTitleStyle}>Properties</div>
        <MetricRow label="Code Role" value={role} valueElement={<span style={badgeStyle(`${rColor}20`, rColor)}>{role}</span>} />
        {complexity != null && <MetricRow label="Cyclomatic Complexity" value={String(complexity)} />}
        {containingGroup && <MetricRow label="Group" value={containingGroup} />}
        <MetricRow
          label="Misplaced"
          value={misplaced ? 'Yes' : 'No'}
          valueElement={
            misplaced
              ? <span style={badgeStyle(`${COLORS.critical}20`, COLORS.critical)}>Yes</span>
              : <span style={badgeStyle('#e2e8f0', '#64748b')}>No</span>
          }
        />
      </div>

      {misplaced && (
        <div>
          <div style={sectionTitleStyle}>Misplacement Info</div>
          <MetricRow label="Current Dir" value={shortPath(misplaced.currentDirectory)} />
          <MetricRow label="Suggested Dir" value={shortPath(misplaced.suggestedDirectory)} />
          <MetricRow label="Peers (current)" value={String(misplaced.peersInCurrentDir)} />
          <MetricRow label="Peers (suggested)" value={String(misplaced.peersInSuggestedDir)} />
        </div>
      )}

      {/* Dependencies: search through coupling data for edges from this entity */}
      {deps.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>Dependencies ({deps.length})</div>
          {deps.map((d) => (
            <div key={d} style={{ fontSize: 12, color: '#475569', padding: '2px 0' }}>→ {shortPath(d)}</div>
          ))}
        </div>
      )}
      {dependents.length > 0 && (
        <div>
          <div style={sectionTitleStyle}>Dependents ({dependents.length})</div>
          {dependents.map((d) => (
            <div key={d} style={{ fontSize: 12, color: '#475569', padding: '2px 0' }}>← {shortPath(d)}</div>
          ))}
        </div>
      )}

      {/* Coupling summary from mostCoupledEntities */}
      {data.summary.mostCoupledEntities.some((e) => e.entityId === nodeId) && (
        <div>
          <div style={sectionTitleStyle}>Coupling</div>
          <MetricRow
            label="Total Coupling"
            value={String(data.summary.mostCoupledEntities.find((e) => e.entityId === nodeId)?.totalCoupling ?? 0)}
          />
        </div>
      )}
    </>
  );
}

function MetricRow({
  label,
  value,
  valueElement,
}: {
  label: string;
  value: string;
  valueElement?: React.ReactNode;
}) {
  return (
    <div style={metricRowStyle}>
      <span style={{ color: '#64748b' }}>{label}</span>
      {valueElement ?? <span style={{ color: '#1e293b', fontWeight: 600 }}>{value}</span>}
    </div>
  );
}

/* ---------- Main Component ---------- */

export function DetailPanel({ selectedNodeId, data }: DetailPanelProps) {
  if (!selectedNodeId) {
    return <div style={emptyStyle}>Click a node to see details</div>;
  }

  // Check if the selected node is a group
  const groupMatch = findGroupMatch(data, selectedNodeId);
  if (groupMatch) {
    return (
      <div style={panelStyle}>
        <GroupDetail data={data} grouping={groupMatch.grouping} group={groupMatch.group} />
      </div>
    );
  }

  // Otherwise treat as a file entity
  return (
    <div style={panelStyle}>
      <FileDetail data={data} nodeId={selectedNodeId} />
    </div>
  );
}
