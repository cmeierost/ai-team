import { useState, useRef, useEffect, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';

interface HelpTooltipProps {
  text: string;
}

/**
 * Compute fixed position for the popover so it appears above the icon
 * and stays within the viewport.
 */
function computePosition(iconRect: DOMRect): React.CSSProperties {
  const popoverWidth = 260;
  const popoverGap = 8;

  let left = iconRect.left + iconRect.width / 2 - popoverWidth / 2;
  // Clamp to viewport
  if (left < 8) left = 8;
  if (left + popoverWidth > window.innerWidth - 8) left = window.innerWidth - 8 - popoverWidth;

  // Prefer above; fall back to below if not enough space
  const spaceAbove = iconRect.top;
  const placeBelow = spaceAbove < 120;

  return {
    position: 'fixed',
    left,
    width: popoverWidth,
    ...(placeBelow
      ? { top: iconRect.bottom + popoverGap }
      : { bottom: window.innerHeight - iconRect.top + popoverGap }),
  };
}

function HelpTooltipInner({ text }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);
  const iconRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<React.CSSProperties>({});

  // Recompute position whenever opened (or on scroll/resize while open)
  const updatePos = useCallback(() => {
    if (!iconRef.current) return;
    setPos(computePosition(iconRef.current.getBoundingClientRect()));
  }, []);

  useEffect(() => {
    if (!open) return;
    updatePos();
    // Close on outside click
    function handleClick(e: MouseEvent) {
      const target = e.target as Node;
      if (
        iconRef.current && !iconRef.current.contains(target) &&
        popoverRef.current && !popoverRef.current.contains(target)
      ) {
        setOpen(false);
      }
    }
    // Reposition on scroll/resize (any scrollable ancestor)
    function handleReposition() { updatePos(); }
    document.addEventListener('mousedown', handleClick);
    window.addEventListener('scroll', handleReposition, true);
    window.addEventListener('resize', handleReposition);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      window.removeEventListener('scroll', handleReposition, true);
      window.removeEventListener('resize', handleReposition);
    };
  }, [open, updatePos]);

  const iconStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 14,
    height: 14,
    borderRadius: '50%',
    fontSize: 10,
    fontWeight: 700,
    lineHeight: 1,
    cursor: 'pointer',
    userSelect: 'none',
    color: open ? '#3b82f6' : '#94a3b8',
    border: `1px solid ${open ? '#3b82f6' : '#cbd5e1'}`,
    background: open ? '#eff6ff' : 'transparent',
    marginLeft: 3,
    flexShrink: 0,
    verticalAlign: 'middle',
  };

  const popoverStyle: React.CSSProperties = {
    ...pos,
    zIndex: 999999,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.16)',
    padding: '8px 10px',
    maxWidth: 280,
    minWidth: 180,
    fontSize: 12,
    lineHeight: 1.5,
    color: '#334155',
    fontWeight: 400,
    textTransform: 'none',
    letterSpacing: 'normal',
    whiteSpace: 'normal',
    textAlign: 'left',
    pointerEvents: 'auto',
  };

  return (
    <span ref={iconRef} style={{ display: 'inline-flex', alignItems: 'center' }}>
      <span style={iconStyle} onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}>?</span>
      {open && createPortal(
        <div ref={popoverRef} style={popoverStyle}>{text}</div>,
        document.body,
      )}
    </span>
  );
}

export const HelpTooltip = memo(HelpTooltipInner);
