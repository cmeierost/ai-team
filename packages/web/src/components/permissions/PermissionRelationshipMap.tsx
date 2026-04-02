import { useRef, useState } from 'react';
import type { PointerEventHandler, ReactNode } from 'react';
import type { Agent, PermissionAnalysisView, PermissionRight } from '../../types';
import { getAgentHue } from '../../utils/color';
import { getRegionMetricValue, getResponsibilityMetricValue, getUncoveredMetricValue } from '../../utils/permissionMetrics';
import { getAvatarUrl } from '../../utils/avatar';

interface PermissionRelationshipMapProps {
  view: PermissionAnalysisView;
  agentsById: Map<string, Agent>;
  selectedRight: PermissionRight;
  overlay?: ReactNode;
  selectedAgentId?: string;
  onSelectAgent: (agentId: string) => void;
  onSelectPairRegion: (regionId: string) => void;
  onOpenAgentPermissionFile?: (agentId: string) => void;
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

function pairKey(a: string, b: string): string {
  return [a, b].sort((left, right) => left.localeCompare(right)).join('::');
}

interface LayoutNode {
  agentId: string;
  x: number;
  y: number;
  radius: number;
  metric: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function PermissionRelationshipMap({
  view,
  agentsById,
  selectedRight,
  overlay,
  selectedAgentId,
  onSelectAgent,
  onSelectPairRegion,
  onOpenAgentPermissionFile,
}: Readonly<PermissionRelationshipMapProps>) {
  const width = 1040;
  const height = 700;
  const centerX = width / 2;
  const centerY = 300;
  const mapBottom = height - 138;
  const padding = 56;

  const activeAgentIds = view.agentIds.filter((agentId) => {
    const responsibility = view.agentResponsibilities[agentId];
    return getResponsibilityMetricValue(responsibility, selectedRight) > 0;
  });

  if (activeAgentIds.length === 0) {
    return <div className="permission-overlap-empty">No agents have measurable {selectedRight} responsibility in this analysis.</div>;
  }

  const maxResponsibility = activeAgentIds.reduce((max, agentId) => {
    return Math.max(max, getResponsibilityMetricValue(view.agentResponsibilities[agentId], selectedRight));
  }, 0);

  const pairCoverage = new Map<string, number>();
  const agentMetricById = new Map<string, number>();
  for (const agentId of activeAgentIds) {
    agentMetricById.set(agentId, getResponsibilityMetricValue(view.agentResponsibilities[agentId], selectedRight));
  }
  for (const region of view.regions) {
    const [a, b] = region.id.split('::');
    if (!activeAgentIds.includes(a) || !activeAgentIds.includes(b)) {
      continue;
    }
    const shared = getRegionMetricValue(region, selectedRight);
    const aMetric = agentMetricById.get(a) ?? 0;
    const bMetric = agentMetricById.get(b) ?? 0;
    const coverageAByB = aMetric > 0 ? Math.min(1, shared / aMetric) : 0;
    const coverageBByA = bMetric > 0 ? Math.min(1, shared / bMetric) : 0;
    const symmetricCoverage = Math.max(coverageAByB, coverageBByA);
    pairCoverage.set(pairKey(a, b), symmetricCoverage);
  }
  const connectedAgentIds = new Set<string>();
  for (const [key, coverage] of pairCoverage.entries()) {
    if (coverage <= 0) {
      continue;
    }
    const [a, b] = key.split('::');
    if (a) {
      connectedAgentIds.add(a);
    }
    if (b) {
      connectedAgentIds.add(b);
    }
  }
  const isolatedAgentIds = activeAgentIds.filter((agentId) => !connectedAgentIds.has(agentId));
  const connectedActiveAgentIds = activeAgentIds.filter((agentId) => connectedAgentIds.has(agentId));

  const nodes: LayoutNode[] = connectedActiveAgentIds.map((agentId, index) => {
    const angle = connectedActiveAgentIds.length > 0
      ? (-Math.PI / 2) + (index * (Math.PI * 2 / connectedActiveAgentIds.length))
      : -Math.PI / 2;
    const metric = getResponsibilityMetricValue(view.agentResponsibilities[agentId], selectedRight);
    const sizeNorm = maxResponsibility > 0 ? Math.sqrt(metric / maxResponsibility) : 0.3;
    const radius = 22 + sizeNorm * 34;
    const initialOrbit = 220 + (index % 3) * 46;
    return {
      agentId,
      x: centerX + Math.cos(angle) * initialOrbit,
      y: centerY + Math.sin(angle) * initialOrbit,
      radius,
      metric,
    };
  });

  for (let iteration = 0; iteration < 300; iteration += 1) {
    const velocity = nodes.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const source = nodes[i];
        const target = nodes[j];
        if (!source || !target) {
          continue;
        }
        const key = pairKey(source.agentId, target.agentId);
        const coverage = pairCoverage.get(key) ?? 0;
        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.hypot(dx, dy));
        const directionX = dx / distance;
        const directionY = dy / distance;

        const minDistance = source.radius + target.radius + 124;
        const maxDistance = 720;
        const desiredDistance = minDistance + (1 - coverage) * (maxDistance - minDistance);
        const springForce = (distance - desiredDistance) * 0.018;
        const repulsionForce = 19000 / (distance * distance);
        const force = springForce - repulsionForce;

        velocity[i]!.x += directionX * force;
        velocity[i]!.y += directionY * force;
        velocity[j]!.x -= directionX * force;
        velocity[j]!.y -= directionY * force;
      }
    }

    for (let i = 0; i < nodes.length; i += 1) {
      const node = nodes[i];
      const impulse = velocity[i];
      if (!node || !impulse) {
        continue;
      }
      const pullX = (centerX - node.x) * 0.0018;
      const pullY = (centerY - node.y) * 0.0018;
      node.x += (impulse.x + pullX) * 0.88;
      node.y += (impulse.y + pullY) * 0.88;
    }
  }

  // Final collision-separation pass to avoid avatar overlap.
  for (let iteration = 0; iteration < 120; iteration += 1) {
    let moved = false;
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const left = nodes[i];
        const right = nodes[j];
        if (!left || !right) {
          continue;
        }
        const dx = right.x - left.x;
        const dy = right.y - left.y;
        const distance = Math.max(0.0001, Math.hypot(dx, dy));
        const minDistance = left.radius + right.radius + 32;
        if (distance >= minDistance) {
          continue;
        }
        const overlap = minDistance - distance;
        const ux = dx / distance;
        const uy = dy / distance;
        const shift = overlap * 0.5;
        left.x -= ux * shift;
        left.y -= uy * shift;
        right.x += ux * shift;
        right.y += uy * shift;
        moved = true;
      }
    }
    if (!moved) {
      break;
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  if (nodes.length > 0) {
    for (const node of nodes) {
      minX = Math.min(minX, node.x - node.radius);
      maxX = Math.max(maxX, node.x + node.radius);
      minY = Math.min(minY, node.y - node.radius);
      maxY = Math.max(maxY, node.y + node.radius);
    }
  } else {
    minX = centerX - 1;
    maxX = centerX + 1;
    minY = centerY - 1;
    maxY = centerY + 1;
  }

  const innerWidth = Math.max(1, maxX - minX);
  const innerHeight = Math.max(1, maxY - minY);
  const targetWidth = width - padding * 2;
  const targetHeight = mapBottom - padding;
  const scale = Math.min(targetWidth / innerWidth, targetHeight / innerHeight, 1.12);
  const offsetX = (width - innerWidth * scale) / 2 - minX * scale;
  const offsetY = (targetHeight - innerHeight * scale) / 2 + padding - minY * scale;

  const laidOutConnectedNodes = nodes.map((node) => ({
    ...node,
    x: clamp(node.x * scale + offsetX, padding + node.radius, width - padding - node.radius),
    y: clamp(node.y * scale + offsetY, padding + node.radius, mapBottom - node.radius),
  }));
  const isolatedNodes: LayoutNode[] = isolatedAgentIds.map((agentId) => {
    const metric = getResponsibilityMetricValue(view.agentResponsibilities[agentId], selectedRight);
    const sizeNorm = maxResponsibility > 0 ? Math.sqrt(metric / maxResponsibility) : 0.3;
    return {
      agentId,
      metric,
      radius: 22 + sizeNorm * 34,
      x: 0,
      y: 0,
    };
  });
  let currentX = padding;
  const isolatedY = height - 84;
  for (const node of isolatedNodes) {
    currentX += node.radius;
    node.x = clamp(currentX, padding + node.radius, width - padding - node.radius);
    node.y = isolatedY;
    currentX += node.radius + 18;
  }
  const laidOutNodes = [...laidOutConnectedNodes, ...isolatedNodes];

  const uncoveredMetric = getUncoveredMetricValue(view.rightUncovered[selectedRight], selectedRight);
  const uncoveredRadius = uncoveredMetric > 0
    ? 18 + (maxResponsibility > 0 ? Math.sqrt(uncoveredMetric / maxResponsibility) * 30 : 24)
    : 16;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panDragRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  const handlePointerDown: PointerEventHandler<SVGSVGElement> = (event) => {
    if (event.button !== 0) {
      return;
    }
    if (event.target !== event.currentTarget) {
      return;
    }
    panDragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: pan.x,
      baseY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove: PointerEventHandler<SVGSVGElement> = (event) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) {
      return;
    }
    const scaleX = width / rect.width;
    const scaleY = height / rect.height;
    setPan({
      x: drag.baseX + (((event.clientX - drag.startX) * scaleX) / zoom),
      y: drag.baseY + (((event.clientY - drag.startY) * scaleY) / zoom),
    });
  };

  const handlePointerEnd: PointerEventHandler<SVGSVGElement> = (event) => {
    const drag = panDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    panDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const zoomIn = () => {
    const nextZoom = clamp(zoom * 1.15, 0.55, 3.2);
    setPan((current) => ({
      x: centerX - ((centerX - current.x) * (nextZoom / zoom)),
      y: centerY - ((centerY - current.y) * (nextZoom / zoom)),
    }));
    setZoom(nextZoom);
  };

  const zoomOut = () => {
    const nextZoom = clamp(zoom * 0.87, 0.55, 3.2);
    setPan((current) => ({
      x: centerX - ((centerX - current.x) * (nextZoom / zoom)),
      y: centerY - ((centerY - current.y) * (nextZoom / zoom)),
    }));
    setZoom(nextZoom);
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };
  const inverseZoom = 1 / zoom;

  return (
    <div className="permission-overlap-diagram-shell">
      <div className="permission-overlap-diagram-controls">
        <div className="permission-relationship-zoom-controls">
          <button type="button" className="permission-context-mini-button" onClick={zoomIn} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="permission-context-mini-button" onClick={zoomOut} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="permission-context-mini-button" onClick={resetView} aria-label="Reset view">
            Fit
          </button>
        </div>
        {overlay ? (
          <div className="permission-overlap-diagram-overlay">
            {overlay}
          </div>
        ) : null}
      </div>
      <svg
        ref={svgRef}
        className="permission-overlap-diagram permission-relationship-map"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Agent relationship map"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={handlePointerEnd}
        style={{ touchAction: 'none', cursor: panDragRef.current ? 'grabbing' : 'grab' }}
      >
        <defs>
          {laidOutNodes.map((node) => {
            const agent = agentsById.get(node.agentId);
            const avatar = agent ? getAvatarUrl(agent) : null;
            if (!agent || !avatar) {
              return null;
            }
            return (
              <pattern key={`rel-avatar-${agent.id}`} id={`rel-avatar-${agent.id}`} width="1" height="1" patternContentUnits="objectBoundingBox">
                <image href={avatar} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
              </pattern>
            );
          })}
        </defs>
        <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          {laidOutNodes.flatMap((source, i) => laidOutNodes.slice(i + 1).map((target) => {
          const coverage = pairCoverage.get(pairKey(source.agentId, target.agentId)) ?? 0;
          if (coverage <= 0) {
            return null;
          }
          const alpha = 0.18 + coverage * 0.55;
          const strokeWidth = (1 + coverage * 6) * inverseZoom;
          const regionId = pairKey(source.agentId, target.agentId);
          return (
            <line
              key={`edge-${regionId}`}
              x1={source.x}
              y1={source.y}
              x2={target.x}
              y2={target.y}
              stroke={`hsl(210 60% 72% / ${alpha.toFixed(3)})`}
              strokeWidth={strokeWidth}
              className="permission-relationship-edge"
              onClick={() => onSelectPairRegion(regionId)}
            >
              <title>{`${source.agentId} × ${target.agentId} coverage ${(coverage * 100).toFixed(1)}%`}</title>
            </line>
          );
          }))}

          {laidOutNodes.map((node) => {
          const agent = agentsById.get(node.agentId);
          const hue = agent ? getAgentHue(agent) : 215;
          const avatar = agent ? getAvatarUrl(agent) : null;
          const active = node.agentId === selectedAgentId;
          return (
            <g
              key={node.agentId}
              className={`permission-overlap-region ${active ? 'permission-overlap-region-selected' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => onSelectAgent(node.agentId)}
              onDoubleClick={() => onOpenAgentPermissionFile?.(node.agentId)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onSelectAgent(node.agentId);
                }
              }}
            >
              <circle
                cx={node.x}
                cy={node.y}
                r={node.radius * inverseZoom}
                fill={avatar ? `url(#rel-avatar-${node.agentId})` : `hsl(${hue} 68% 56% / 0.24)`}
                stroke={`hsl(${hue} 70% 62% / ${active ? '1' : '0.82'})`}
                strokeWidth={(active ? 3 : 2) * inverseZoom}
              />
              {!avatar ? (
                <text
                  x={node.x}
                  y={node.y + ((node.radius * 0.08) * inverseZoom)}
                  textAnchor="middle"
                  className="permission-overlap-peer-initial"
                  style={{ fontSize: `${Math.max(10, node.radius * 0.55) * inverseZoom}px` }}
                >
                  {shortName(agent?.name ?? node.agentId)}
                </text>
              ) : null}
              <title>{`${agent?.name ?? node.agentId} — ${agent?.role ?? 'agent'} · responsibility ${node.metric.toLocaleString()}`}</title>
            </g>
          );
          })}

          <g className="permission-overlap-region permission-overlap-region-uncovered">
          <circle
            cx={centerX}
            cy={height - 38}
            r={uncoveredRadius * inverseZoom}
            fill="hsl(12 75% 58% / 0.24)"
            stroke="hsl(12 75% 62% / 0.95)"
            strokeWidth={2 * inverseZoom}
          />
          <text
            x={centerX}
            y={(height - 34) + ((1 - inverseZoom) * 4)}
            textAnchor="middle"
            className="permission-overlap-peer-name"
            style={{ fontSize: `${9 * inverseZoom}px` }}
          >
            UNC
          </text>
          <title>{`Uncovered area for ${selectedRight}: ${uncoveredMetric.toLocaleString()}`}</title>
          </g>
          {isolatedNodes.length > 0 ? (
            <text x={padding} y={height - 112} className="permission-overlap-peer-metric">
              no overlap
            </text>
          ) : null}
        </g>
      </svg>
    </div>
  );
}
