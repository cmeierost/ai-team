import type { ReactNode } from 'react';
import type { Agent, PermissionOverlapRegion, PermissionRight } from '../../types';
import { getAgentHue } from '../../utils/color';
import { getRegionMetricValue } from '../../utils/permissionMetrics';
import { getAvatarUrl } from '../../utils/avatar';

interface PermissionOverlapDiagramProps {
  focusAgent: Agent | undefined;
  agentsById: Map<string, Agent>;
  regions: readonly PermissionOverlapRegion[];
  selectedRight: PermissionRight;
  overlay?: ReactNode;
  onSelectAgent: (agentId: string) => void;
  responsibilityMetricByAgentId?: Readonly<Record<string, number>>;
  responsibilityFileCountByAgentId?: Readonly<Record<string, number>>;
  selectedRegionId?: string;
  onSelectRegion: (regionId: string) => void;
  emptyLabel?: string;
}

function shortName(value: string): string {
  return value
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    .slice(0, 3);
}

function roleName(agent: Agent | undefined): string {
  if (!agent?.role) {
    return '';
  }
  return agent.role.replace(/-/g, ' ');
}

function toDegrees(radians: number): number {
  return radians * (180 / Math.PI);
}

function safeIdFragment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-');
}

export function PermissionOverlapDiagram({
  focusAgent,
  agentsById,
  regions,
  selectedRight,
  overlay,
  onSelectAgent,
  responsibilityMetricByAgentId,
  responsibilityFileCountByAgentId,
  selectedRegionId,
  onSelectRegion,
  emptyLabel = 'No overlapping regions found.',
}: Readonly<PermissionOverlapDiagramProps>) {
  if (!focusAgent || regions.length === 0) {
    return <div className="permission-overlap-empty">{emptyLabel}</div>;
  }

  const centerX = 210;
  const centerY = 190;
  const focusRadius = 53.2;
  const minOrbitRadius = 92;
  const maxOrbitRadius = 168;
  const angleStep = (Math.PI * 2) / Math.max(regions.length, 1);
  const maxMetric = regions.reduce((max, region) => {
    const peerMetric = responsibilityMetricByAgentId?.[region.peerAgentIds[0]];
    const metric = peerMetric ?? getRegionMetricValue(region, selectedRight);
    return Math.max(max, metric);
  }, 0);
  const adjacentCenterDistance = regions.length > 1
    ? 2 * maxOrbitRadius * Math.sin(Math.PI / regions.length)
    : maxOrbitRadius * 2;
  const maxSafeRadiusBetweenPeers = Math.max(18, (adjacentCenterDistance / 2) - 16);
  const maxSafeRadiusFromCenter = Math.max(16, maxOrbitRadius - focusRadius - 8);
  const maxSafeRadius = Math.min(maxSafeRadiusBetweenPeers, maxSafeRadiusFromCenter);
  const minRadius = Math.min(20, Math.max(12, maxSafeRadius * 0.45));
  const focusHue = getAgentHue(focusAgent);
  const getPeerGeometry = (region: PermissionOverlapRegion, index: number) => {
    const peerAgentId = region.peerAgentIds[0];
    const peerMetric = responsibilityMetricByAgentId?.[peerAgentId];
    const metric = peerMetric ?? getRegionMetricValue(region, selectedRight);
    const normalized = maxMetric > 0 ? Math.sqrt(metric / maxMetric) : 0.2;
    const radius = minRadius + (maxSafeRadius - minRadius) * normalized;
    const sharedFiles = region.rightFileCounts[selectedRight] ?? 0;
    const peerTotalFiles = responsibilityFileCountByAgentId?.[peerAgentId] ?? 0;
    const coverage = peerTotalFiles > 0 ? Math.min(1, sharedFiles / peerTotalFiles) : 0;
    const closeness = Math.pow(coverage, 1.8);
    const orbitRadius = maxOrbitRadius - (maxOrbitRadius - minOrbitRadius) * closeness;
    const angle = -Math.PI / 2 + index * angleStep;
    const cx = centerX + Math.cos(angle) * orbitRadius;
    const cy = centerY + Math.sin(angle) * orbitRadius;
    return {
      peerAgentId,
      metric,
      radius,
      coverage,
      cx,
      cy,
    };
  };
  const selectedRegion = regions.find((region) => region.id === selectedRegionId) ?? regions[0];
  const selectedSharedFiles = selectedRegion?.rightFileCounts[selectedRight] ?? 0;
  const focusTotalFiles = responsibilityFileCountByAgentId?.[focusAgent.id] ?? 0;
  const selectedFocusCoverage = focusTotalFiles > 0 ? Math.min(1, selectedSharedFiles / focusTotalFiles) : 0;
  const selectedRegionIndex = Math.max(0, regions.findIndex((region) => region.id === selectedRegion.id));
  const selectedPeerGeometry = getPeerGeometry(selectedRegion, selectedRegionIndex);
  const selectedPeerAgent = agentsById.get(selectedPeerGeometry.peerAgentId);
  const selectedPeerHue = selectedPeerAgent ? getAgentHue(selectedPeerAgent) : focusHue;
  const focusTintAngle = toDegrees(Math.atan2(selectedPeerGeometry.cy - centerY, selectedPeerGeometry.cx - centerX));
  const focusTintWidth = (focusRadius * 2) * selectedFocusCoverage;
  const focusTintStartX = centerX + focusRadius - focusTintWidth;
  const focusBadgeWidth = Math.max(30, focusRadius * 0.9);
  const focusBadgeHeight = Math.max(14, focusRadius * 0.3);
  const focusBadgeX = centerX - (focusBadgeWidth / 2);
  const focusBadgeY = centerY + (focusRadius * 0.48);
  return (
    <div className="permission-overlap-diagram-shell">
      {overlay ? (
        <div className="permission-overlap-diagram-overlay">
          {overlay}
        </div>
      ) : null}
      <svg viewBox="0 0 420 380" className="permission-overlap-diagram" role="img" aria-label={`Overlap map for ${focusAgent.name}`}>
        <defs>
          <radialGradient id="permission-focus-gradient" cx="50%" cy="50%" r="65%">
            <stop offset="0%" stopColor={`hsl(${focusHue} 72% 62% / 0.36)`} />
            <stop offset="100%" stopColor={`hsl(${focusHue} 72% 46% / 0.16)`} />
          </radialGradient>
          {(() => {
            const focusAvatar = getAvatarUrl(focusAgent);
            if (!focusAvatar) {
              return null;
            }
            return (
              <pattern id={`permission-avatar-focus-${focusAgent.id}`} width="1" height="1" patternContentUnits="objectBoundingBox">
                <image href={focusAvatar} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
              </pattern>
            );
          })()}
          {regions.map((region) => {
            const peerAgent = agentsById.get(region.peerAgentIds[0]);
            const avatarUrl = peerAgent ? getAvatarUrl(peerAgent) : null;
            if (!peerAgent || !avatarUrl) {
              return null;
            }
            return (
              <pattern key={`avatar-${peerAgent.id}`} id={`permission-avatar-peer-${peerAgent.id}`} width="1" height="1" patternContentUnits="objectBoundingBox">
                <image href={avatarUrl} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
              </pattern>
            );
          })}
          <clipPath id="permission-focus-overlap-clip">
            <circle cx={centerX} cy={centerY} r={focusRadius} />
          </clipPath>
          {regions.map((region, index) => {
            const geometry = getPeerGeometry(region, index);
            return (
              <clipPath key={`peer-clip-${region.id}`} id={`permission-peer-overlap-clip-${safeIdFragment(region.id)}`}>
                <circle cx={geometry.cx} cy={geometry.cy} r={geometry.radius} />
              </clipPath>
            );
          })}
        </defs>

        <circle
          cx={centerX}
          cy={centerY}
          r={focusRadius}
          className="permission-overlap-focus-circle"
          fill={getAvatarUrl(focusAgent) ? `url(#permission-avatar-focus-${focusAgent.id})` : 'url(#permission-focus-gradient)'}
          stroke={`hsl(${focusHue} 72% 62% / 0.85)`}
          onClick={() => onSelectAgent(focusAgent.id)}
          style={{ cursor: 'pointer' }}
        />
        <g clipPath="url(#permission-focus-overlap-clip)" transform={`rotate(${focusTintAngle} ${centerX} ${centerY})`}>
          <rect
            x={focusTintStartX}
            y={centerY - focusRadius}
            width={focusTintWidth}
            height={focusRadius * 2}
            className="permission-overlap-directional-tint"
            fill={`hsl(${selectedPeerHue} 78% 62% / 0.62)`}
          />
        </g>
        {!getAvatarUrl(focusAgent) ? (
          <text x={centerX} y={centerY + (focusRadius * 0.08)} textAnchor="middle" className="permission-overlap-focus-initial">
            {shortName(focusAgent.name)}
          </text>
        ) : null}
        <g>
          <rect
            x={focusBadgeX}
            y={focusBadgeY}
            width={focusBadgeWidth}
            height={focusBadgeHeight}
            rx={Math.max(5, focusRadius * 0.12)}
            className="permission-overlap-peer-metric-badge"
          />
          <text
            x={centerX}
            y={focusBadgeY + (focusBadgeHeight / 2) + 2}
            textAnchor="middle"
            dominantBaseline="middle"
            alignmentBaseline="middle"
            className="permission-overlap-peer-metric"
            style={{ fontSize: `${Math.max(10, focusRadius * 0.24)}px` }}
          >
            {(selectedFocusCoverage * 100).toFixed(0)}%
          </text>
        </g>
        <title>{focusAgent.name}{roleName(focusAgent) ? ` — ${roleName(focusAgent)}` : ''}</title>

        {regions.map((region, index) => {
          const geometry = getPeerGeometry(region, index);
          const peerRadius = geometry.radius;
          const cx = geometry.cx;
          const cy = geometry.cy;
          const dx = cx - centerX;
          const dy = cy - centerY;
          const distance = Math.max(1, Math.hypot(dx, dy));
          const ux = dx / distance;
          const uy = dy / distance;
          const lineStartX = centerX + (ux * focusRadius);
          const lineStartY = centerY + (uy * focusRadius);
          const lineEndX = cx - (ux * peerRadius);
          const lineEndY = cy - (uy * peerRadius);
          const isSelected = region.id === selectedRegionId;
          return (
            <line
              key={`focus-line-${region.id}`}
              x1={lineStartX}
              y1={lineStartY}
              x2={lineEndX}
              y2={lineEndY}
              className={`permission-overlap-focus-connector ${isSelected ? 'permission-overlap-focus-connector-selected' : ''}`}
              strokeWidth={isSelected ? 2.5 : 1.5}
            />
          );
        })}

        {regions.map((region, index) => {
          const geometry = getPeerGeometry(region, index);
          const peerAgentId = geometry.peerAgentId;
          const peerAgent = agentsById.get(peerAgentId);
          const radius = geometry.radius;
          const coverage = geometry.coverage;
          const cx = geometry.cx;
          const cy = geometry.cy;
          const tintWidth = (radius * 2) * coverage;
          const tintStartX = cx + radius - tintWidth;
          const tintAngle = toDegrees(Math.atan2(centerY - cy, centerX - cx));
          const metricBadgeWidth = Math.max(24, radius * 0.84);
          const metricBadgeHeight = Math.max(12, radius * 0.28);
          const metricBadgeX = cx - (metricBadgeWidth / 2);
          const metricBadgeY = cy + (radius * 0.38);
          const peerHue = peerAgent ? getAgentHue(peerAgent) : 215;
          const isSelected = region.id === selectedRegionId;
          return (
            <g
              key={region.id}
              className={`permission-overlap-region ${isSelected ? 'permission-overlap-region-selected' : ''}`}
              onClick={() => onSelectRegion(region.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectRegion(region.id);
                }
              }}
              role="button"
              tabIndex={0}
              aria-label={`Show overlap details for ${focusAgent.name} and ${peerAgent?.name ?? peerAgentId}`}
            >
              <circle
                cx={cx}
                cy={cy}
                r={radius}
                fill={peerAgent && getAvatarUrl(peerAgent)
                  ? `url(#permission-avatar-peer-${peerAgent.id})`
                  : `hsl(${peerHue} 70% 58% / ${isSelected ? '0.34' : '0.20'})`}
                stroke={`hsl(${peerHue} 70% 63% / ${isSelected ? '0.95' : '0.72'})`}
                strokeWidth={isSelected ? 3 : 2}
              />
              <g
                clipPath={`url(#permission-peer-overlap-clip-${safeIdFragment(region.id)})`}
                transform={`rotate(${tintAngle} ${cx} ${cy})`}
              >
                <rect
                  x={tintStartX}
                  y={cy - radius}
                  width={tintWidth}
                  height={radius * 2}
                  className="permission-overlap-directional-tint"
                  fill={`hsl(${focusHue} 78% 62% / 0.62)`}
                />
              </g>
              {!getAvatarUrl(peerAgent) ? (
                <text x={cx} y={cy + (radius * 0.12)} textAnchor="middle" className="permission-overlap-peer-initial" style={{ fontSize: `${Math.max(10, radius * 0.55)}px` }}>
                  {shortName(peerAgent?.name ?? peerAgentId)}
                </text>
              ) : null}
              <g>
                <rect
                  x={metricBadgeX}
                  y={metricBadgeY}
                  width={metricBadgeWidth}
                  height={metricBadgeHeight}
                  rx={Math.max(4, radius * 0.12)}
                  className="permission-overlap-peer-metric-badge"
                />
                <text
                  x={cx}
                  y={metricBadgeY + (metricBadgeHeight / 2) + 2}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  alignmentBaseline="middle"
                  className="permission-overlap-peer-metric"
                  style={{ fontSize: `${Math.max(9, radius * 0.22)}px` }}
                >
                  {(coverage * 100).toFixed(0)}%
                </text>
              </g>
              <title>
                {(peerAgent?.name ?? peerAgentId)}
                {roleName(peerAgent) ? ` — ${roleName(peerAgent)}` : ''}
                {` · coverage ${(coverage * 100).toFixed(1)}%`}
              </title>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
