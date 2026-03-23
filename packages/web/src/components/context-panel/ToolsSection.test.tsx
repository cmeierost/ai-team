import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolsSection } from './ToolsSection';

describe('ToolsSection', () => {
  const baseProps = {
    allowedTools: ['fs_tree', 'fs_who_should', 'com_ask'],
    activeToolNames: [],
    recentToolEvents: [],
    expandedSection: 'tools' as const,
    onToggleSection: () => undefined,
  };

  it('renders allowed tool chips', () => {
    render(<ToolsSection {...baseProps} />);
    expect(screen.getByText('fs_tree')).toBeTruthy();
    expect(screen.getByText('fs_who_should')).toBeTruthy();
    expect(screen.getByText('com_ask')).toBeTruthy();
  });

  it('highlights active tools', () => {
    render(<ToolsSection {...baseProps} activeToolNames={['fs_tree']} />);
    const chip = screen.getByText('fs_tree').closest('span');
    expect(chip?.className).toContain('is-active');
  });

  it('shows session tool call count when events exist', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    expect(screen.getByText(/1 tool call this session/i)).toBeTruthy();
  });
});
