import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentToolPermissionEntry } from '@ai-team/api-contracts';
import { ToolsSection } from './ToolsSection';

afterEach(() => {
  cleanup();
});

describe('ToolsSection', () => {
  const baseToolEntries: AgentToolPermissionEntry[] = [
    { name: 'fs_tree', description: 'Tree tool', group: 'fs', schema: {}, allowedForAgent: true },
    {
      name: 'fs_who_should',
      description: 'Who should tool',
      group: 'fs',
      schema: {},
      allowedForAgent: true,
    },
    {
      name: 'com_ask',
      description: 'Ask tool',
      group: 'com',
      schema: {},
      allowedForAgent: false,
      deniedReason: 'Disabled',
    },
  ];

  const baseProps = {
    toolEntries: baseToolEntries,
    activeToolNames: [],
    recentToolEvents: [],
    expandedSection: 'tools' as const,
    onToggleSection: () => undefined,
  };

  it('renders all tool names', () => {
    render(<ToolsSection {...baseProps} />);
    expect(screen.getByText('fs_tree')).toBeTruthy();
    expect(screen.getByText('fs_who_should')).toBeTruthy();
    expect(screen.getByText('com_ask')).toBeTruthy();
  });

  it('marks allowed (uncalled) tools as is-allowed chips', () => {
    render(<ToolsSection {...baseProps} />);
    const chip = screen.getByText('fs_tree').closest('span');
    expect(chip?.className).toContain('is-allowed');
  });

  it('marks denied tools as is-denied chips', () => {
    render(<ToolsSection {...baseProps} />);
    const chip = screen.getByText('com_ask').closest('span');
    expect(chip?.className).toContain('is-denied');
  });

  it('shows called tools as rows with call-count badge', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    // call count badge shows the number
    expect(screen.getByText('3')).toBeTruthy();
    // tool name appears in a row, not a chip
    const nameEl = screen.getByText('fs_tree');
    expect(nameEl.closest('.context-tool-row')).toBeTruthy();
  });

  it('marks running called tool rows with is-running', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'start' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} activeToolNames={['fs_tree']} recentToolEvents={events} />);
    const row = screen.getByText('fs_tree').closest('.context-tool-row');
    expect(row?.className).toContain('is-running');
  });

  it('marks running uncalled tools with is-running', () => {
    render(<ToolsSection {...baseProps} activeToolNames={['fs_who_should']} />);
    const chip = screen.getByText('fs_who_should').closest('span');
    expect(chip?.className).toContain('is-running');
  });

  it('shows used/total count in badge when tools have been called', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    // 1 distinct tool called out of 2 allowed
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('moves called tools to row section and leaves uncalled as chips', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'result' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    // fs_tree should be in a row
    expect(screen.getByText('fs_tree').closest('.context-tool-row')).toBeTruthy();
    // fs_who_should should remain a chip
    expect(screen.getByText('fs_who_should').closest('.context-tool-chip')).toBeTruthy();
  });

  it('marks file-rights-dependent tools as is-file-gated', () => {
    const fileGatedEntries: AgentToolPermissionEntry[] = [
      {
        name: 'fs_read',
        description: 'File read',
        group: 'fs',
        schema: {},
        allowedForAgent: true,
        fileRightsDependent: true,
      },
    ];
    render(<ToolsSection {...baseProps} toolEntries={fileGatedEntries} />);
    const chip = screen.getByText('fs_read').closest('span');
    expect(chip?.className).toContain('is-file-gated');
  });

  it('shows group name inline with tool', () => {
    render(<ToolsSection {...baseProps} />);
    // Group appears as "fs ·" (with dot separator) - at least 2 fs tools
    const groupSpans = screen.getAllByText(/fs\s·/, { selector: '.context-tool-chip-group' });
    expect(groupSpans.length).toBeGreaterThanOrEqual(2);
  });

  it('counts tools with no toolPhase (legacy stored events)', () => {
    // Sessions loaded from notes may not have toolPhase stored
    const events = [
      { toolName: 'fs_tree', timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    expect(screen.getByText('2')).toBeTruthy();
    expect(screen.getByText('fs_tree').closest('.context-tool-row')).toBeTruthy();
  });

  it('does not count start/request/denied phase events', () => {
    const events = [
      { toolName: 'fs_tree', toolPhase: 'start' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'request' as const, timestamp: new Date().toISOString() },
      { toolName: 'fs_tree', toolPhase: 'denied' as const, timestamp: new Date().toISOString() },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    // fs_tree should still be a chip (not called)
    expect(screen.getByText('fs_tree').closest('.context-tool-chip')).toBeTruthy();
  });

  it('shows called tool as row even when not in toolEntries catalog', () => {
    const events = [
      {
        toolName: 'unknown_tool',
        toolPhase: 'result' as const,
        timestamp: new Date().toISOString(),
      },
      {
        toolName: 'unknown_tool',
        toolPhase: 'result' as const,
        timestamp: new Date().toISOString(),
      },
    ];
    render(<ToolsSection {...baseProps} recentToolEvents={events} />);
    expect(screen.getByText('unknown_tool').closest('.context-tool-row')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
  });

  it('shows empty state when no tools', () => {
    render(<ToolsSection {...baseProps} toolEntries={[]} />);
    expect(screen.getByText('No tools are available for this agent.')).toBeTruthy();
  });
});
