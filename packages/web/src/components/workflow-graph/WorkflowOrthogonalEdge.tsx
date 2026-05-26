import { BaseEdge, Position, type EdgeProps } from '@xyflow/react';

interface WorkflowEdgeData {
  laneX?: number;
}

interface WorkflowPoint {
  x: number;
  y: number;
}

const EDGE_EXIT_GAP = 34;
const SIDE_ENTRY_DETOUR_GAP = 72;
const EDGE_CORNER_RADIUS = 18;

function offsetByPosition(position: Position | undefined, origin: number): number {
  if (position === Position.Left || position === Position.Top) {
    return origin - EDGE_EXIT_GAP;
  }

  if (position === Position.Right || position === Position.Bottom) {
    return origin + EDGE_EXIT_GAP;
  }

  return origin;
}

function isSamePoint(left: WorkflowPoint, right: WorkflowPoint): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function compactPoints(points: readonly WorkflowPoint[]): WorkflowPoint[] {
  return points.filter((point, index) => index === 0 || !isSamePoint(point, points[index - 1]));
}

function buildRoundedPath(pointsInput: readonly WorkflowPoint[], cornerRadius: number): string {
  const points = compactPoints(pointsInput);
  if (points.length === 0) {
    return '';
  }

  if (points.length === 1) {
    const point = points[0];
    return `M ${point.x},${point.y}`;
  }

  let path = `M ${points[0].x},${points[0].y}`;

  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];

    const inDx = current.x - previous.x;
    const inDy = current.y - previous.y;
    const outDx = next.x - current.x;
    const outDy = next.y - current.y;

    const inLength = Math.hypot(inDx, inDy);
    const outLength = Math.hypot(outDx, outDy);
    const turnDeterminant = inDx * outDy - inDy * outDx;
    const isTurn = Math.abs(turnDeterminant) > 0.001;

    if (!isTurn || inLength < 0.001 || outLength < 0.001) {
      path += ` L ${current.x},${current.y}`;
      continue;
    }

    const turnRadius = Math.min(cornerRadius, inLength / 2, outLength / 2);
    const startX = current.x - (inDx / inLength) * turnRadius;
    const startY = current.y - (inDy / inLength) * turnRadius;
    const endX = current.x + (outDx / outLength) * turnRadius;
    const endY = current.y + (outDy / outLength) * turnRadius;

    path += ` L ${startX},${startY}`;
    path += ` Q ${current.x},${current.y} ${endX},${endY}`;
  }

  const last = points.reduce((_, point) => point, points[0]);
  path += ` L ${last.x},${last.y}`;

  return path;
}

export function WorkflowOrthogonalEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  style,
  label,
  labelShowBg,
  data,
}: Readonly<EdgeProps>) {
  const edgeData = (data ?? {}) as WorkflowEdgeData;
  const laneX =
    typeof edgeData.laneX === 'number' ? edgeData.laneX : sourceX + (targetX - sourceX) / 2;

  const sourceExitX =
    sourcePosition === Position.Left || sourcePosition === Position.Right
      ? offsetByPosition(sourcePosition, sourceX)
      : sourceX;
  const sourceExitY =
    sourcePosition === Position.Top || sourcePosition === Position.Bottom
      ? offsetByPosition(sourcePosition, sourceY)
      : sourceY;

  const targetEntryX =
    targetPosition === Position.Left || targetPosition === Position.Right
      ? offsetByPosition(targetPosition, targetX)
      : targetX;
  const targetEntryY =
    targetPosition === Position.Top || targetPosition === Position.Bottom
      ? offsetByPosition(targetPosition, targetY)
      : targetY;

  const entersRightFromLeft = targetPosition === Position.Right && laneX < targetEntryX;
  const entersLeftFromRight = targetPosition === Position.Left && laneX > targetEntryX;
  const requiresSideDetour = entersRightFromLeft || entersLeftFromRight;

  const detourY = Math.max(sourceExitY, targetEntryY) + SIDE_ENTRY_DETOUR_GAP;

  const points: WorkflowPoint[] = requiresSideDetour
    ? [
        { x: sourceX, y: sourceY },
        { x: sourceExitX, y: sourceExitY },
        { x: laneX, y: sourceExitY },
        { x: laneX, y: detourY },
        { x: targetEntryX, y: detourY },
        { x: targetEntryX, y: targetEntryY },
        { x: targetX, y: targetY },
      ]
    : [
        { x: sourceX, y: sourceY },
        { x: sourceExitX, y: sourceExitY },
        { x: laneX, y: sourceExitY },
        { x: laneX, y: targetEntryY },
        { x: targetEntryX, y: targetEntryY },
        { x: targetX, y: targetY },
      ];

  const path = buildRoundedPath(points, EDGE_CORNER_RADIUS);

  const labelX = laneX;
  const labelY = sourceExitY + (targetEntryY - sourceExitY) / 2;

  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelShowBg={labelShowBg}
      labelX={labelX}
      labelY={labelY}
    />
  );
}
