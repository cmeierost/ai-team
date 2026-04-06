/**
 * @aspect/viewer — OverviewBar
 *
 * Compact horizontal bar at the top of the viewer showing key metrics.
 */

import type { StructuralPipelineResult } from '../types.js';
import { healthColor } from '../types.js';

export interface OverviewBarProps {
  data: StructuralPipelineResult;
  hideTypeOnly?: boolean;
  onToggleHideTypeOnly?: () => void;
  showFullPath?: boolean;
  onToggleShowFullPath?: () => void;
  showSuperclusters?: boolean;
  onToggleShowSuperclusters?: () => void;
}

const barStyle: React.CSSProperties = {
  height: 40,
  background: '#252526',
  borderBottom: '1px solid #3e3e42',
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: 20,
  padding: '0 16px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  color: '#ccc',
  flexShrink: 0,
  fontSize: 12,
};

const separatorStyle: React.CSSProperties = {
  width: 1,
  height: 16,
  background: '#3e3e42',
  flexShrink: 0,
};

const statStyle: React.CSSProperties = {
  fontSize: 12,
  whiteSpace: 'nowrap',
};

const countStyle: React.CSSProperties = {
  fontWeight: 600,
  color: '#e0e0e0',
  fontVariantNumeric: 'tabular-nums',
};

const labelStyle: React.CSSProperties = {
  color: '#888',
  marginLeft: 4,
};

function Separator() {
  return <span style={separatorStyle} />;
}

function Stat({ count, label }: { count: number | string; label: string }) {
  return (
    <span style={statStyle}>
      <span style={countStyle}>{count}</span>
      <span style={labelStyle}>{label}</span>
    </span>
  );
}

function ToggleButton({ active, onClick, activeLabel, inactiveLabel, activeTitle, inactiveTitle, activeColor = '#0078d4' }: {
  active: boolean;
  onClick: () => void;
  activeLabel: string;
  inactiveLabel: string;
  activeTitle: string;
  inactiveTitle: string;
  activeColor?: string;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11,
        fontWeight: 600,
        padding: '3px 9px',
        borderRadius: 12,
        border: 'none',
        cursor: 'pointer',
        background: active ? activeColor : '#2d2d30',
        color: active ? '#fff' : '#a0a0a0',
        transition: 'background 0.15s, color 0.15s',
        whiteSpace: 'nowrap',
      }}
      title={active ? activeTitle : inactiveTitle}
    >
      {active ? activeLabel : inactiveLabel}
    </button>
  );
}

export function OverviewBar({
  data,
  hideTypeOnly,
  onToggleHideTypeOnly,
  showFullPath,
  onToggleShowFullPath,
  showSuperclusters,
  onToggleShowSuperclusters,
}: OverviewBarProps) {
  const { summary, healthScore, communities } = data;

  const scoreDisplay = healthScore != null ? Math.round(healthScore) : '—';
  const scoreColor = healthScore != null ? healthColor(healthScore) : '#94a3b8';

  // Show community count when available, cluster count as fallback
  const groupCount = (communities?.communities ?? []).filter(
    (c) => c.memberFileIds.length >= 2,
  ).length || summary.clusterCount;

  // Count code vs non-code files
  const codeFiles = data.fileClassifications.filter((f) => f.category === 'code').length;
  const nonCodeFiles = summary.totalFiles - codeFiles;

  return (
    <div style={barStyle}>
      <span style={{ fontSize: 18, fontWeight: 800, color: scoreColor }}>
        🏥 {scoreDisplay}
      </span>

      <Separator />
      <Stat count={codeFiles} label=" code files" />

      <Separator />
      <Stat count={groupCount} label=" groups" />

      <Separator />
      <span style={{ ...statStyle, color: '#666' }}>
        <span style={countStyle}>{nonCodeFiles}</span>
        <span style={labelStyle}> non-code</span>
      </span>

      <Separator />
      <span style={statStyle}>
        <span style={{ color: summary.criticalWarningCount > 0 ? '#f44336' : '#888' }}>
          ⚠ <span style={countStyle}>{summary.criticalWarningCount}</span>
        </span>
        <span style={labelStyle}>critical</span>
      </span>

      <Separator />
      <Stat count={summary.misplacedFileCount ?? 0} label=" misplaced" />

      <Separator />
      <Stat count={summary.warningCount} label=" warnings" />

      {/* Spacer to push toggles to the right */}
      <span style={{ flex: 1 }} />

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        {onToggleHideTypeOnly && (
          <ToggleButton
            active={!!hideTypeOnly}
            onClick={onToggleHideTypeOnly}
            activeLabel="⊘ Types hidden"
            inactiveLabel="◉ Types"
            activeTitle="Showing only value imports — click to show all"
            inactiveTitle="Click to hide type-only imports"
          />
        )}
        {onToggleShowFullPath && (
          <ToggleButton
            active={!!showFullPath}
            onClick={onToggleShowFullPath}
            activeLabel="⇶ Full path"
            inactiveLabel="⇢ Direct"
            activeTitle="Showing resolved paths through barrels — click for direct edges"
            inactiveTitle="Click to resolve edges through barrel files to actual targets"
            activeColor="#2d7a4f"
          />
        )}
        {onToggleShowSuperclusters && (
          <ToggleButton
            active={!!showSuperclusters}
            onClick={onToggleShowSuperclusters}
            activeLabel="▣ Superclusters"
            inactiveLabel="□ Superclusters"
            activeTitle="Showing supercluster overlays"
            inactiveTitle="Click to show supercluster overlays"
            activeColor="#6b7280"
          />
        )}
      </div>
    </div>
  );
}
