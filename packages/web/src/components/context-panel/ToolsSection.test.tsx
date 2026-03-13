import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { SessionActivatedTool } from '../../types';
import { ToolsSection } from './ToolsSection';

describe('ToolsSection structured rendering', () => {
  const baseProps = {
    allowedTools: ['fs_tree', 'fs_who_should'],
    activeToolNames: [],
    expandedSection: 'tools' as const,
    onToggleSection: () => undefined,
  };

  it('renders a rich who-should target list card', () => {
    const onSuggestedHandoff = vi.fn();
    const event: SessionActivatedTool = {
      toolName: 'fs_who_should',
      toolPhase: 'result',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolName: 'fs_who_should',
        outcome: 'result',
        result: {
          type: 'fs_who_should_result',
          task: 'update auth module',
          matches: [
            { agentId: 'alex-morgan', agentName: 'Alex Morgan', agentRole: 'backend lead' },
          ],
        },
      },
    };

    render(<ToolsSection {...baseProps} onSuggestedHandoff={onSuggestedHandoff} recentToolEvents={[event]} />);

    expect(screen.getByText('Suggested handoff targets')).toBeTruthy();
    expect(screen.getByText('Alex Morgan')).toBeTruthy();
    const handoffButton = screen.getByRole('button', { name: 'handoff' });
    expect(handoffButton).toBeTruthy();

    fireEvent.click(handoffButton);
    expect(onSuggestedHandoff).toHaveBeenCalledWith('alex-morgan', 'update auth module');
  });

  it('renders a file tree summary card for fs_tree payloads', () => {
    const event: SessionActivatedTool = {
      toolName: 'fs_tree',
      toolPhase: 'result',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolName: 'fs_tree',
        outcome: 'result',
        result: {
          path: 'src',
          tree: {
            name: 'src',
            isDirectory: true,
            children: [
              { name: 'components', isDirectory: true, children: [] },
              { name: 'App.tsx', isDirectory: false },
            ],
          },
        },
      },
    };

    render(<ToolsSection {...baseProps} recentToolEvents={[event]} />);

    expect(screen.getByText('File tree snapshot')).toBeTruthy();
    expect(screen.getByText(/src · 2 dirs · 1 files/i)).toBeTruthy();
    expect(screen.getByText(/components/i)).toBeTruthy();
    expect(screen.getByText(/App.tsx/i)).toBeTruthy();
  });

  it('renders a file tree summary card when payload is a JSON string', () => {
    const event: SessionActivatedTool = {
      toolName: 'fs_tree',
      toolPhase: 'result',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolName: 'fs_tree',
        outcome: 'result',
        result: JSON.stringify({
          path: 'src',
          tree: {
            name: 'src',
            isDirectory: true,
            children: [
              { name: 'components', isDirectory: true, children: [] },
              { name: 'App.tsx', isDirectory: false },
            ],
          },
        }),
      },
    };

    render(<ToolsSection {...baseProps} recentToolEvents={[event]} />);

    expect(screen.getByText('File tree snapshot')).toBeTruthy();
    expect(screen.getByText(/src · 2 dirs · 1 files/i)).toBeTruthy();
  });

  it('prefers toolResult.toolName and denial metadata fallback for display', () => {
    const event: SessionActivatedTool = {
      toolName: 'legacy_name',
      toolPhase: 'denied',
      timestamp: new Date().toISOString(),
      message: 'Tool call denied by policy.',
      toolResult: {
        toolName: 'fs_read',
        outcome: 'denied',
        denial: {
          kind: 'policy-denied',
          reasonCode: 'access_denied',
          message: 'Access denied for selected context.',
          blockedPaths: ['packages/service/src'],
          alternativeContexts: [{ contextId: 'alex-morgan', allowedPaths: ['packages/service/**'] }],
        },
      },
    };

    render(<ToolsSection {...baseProps} recentToolEvents={[event]} />);

    expect(screen.getByText('fs_read')).toBeTruthy();
    expect(screen.getByText(/reason: access_denied/i)).toBeTruthy();
    expect(screen.getByText(/blocked paths: 1/i)).toBeTruthy();
    expect(screen.getByText(/alternative contexts: 1/i)).toBeTruthy();
  });

  it('renders a question card for com_ask structured payloads', () => {
    const event: SessionActivatedTool = {
      toolName: 'com_ask',
      toolPhase: 'result',
      timestamp: new Date().toISOString(),
      toolResult: {
        toolName: 'com_ask',
        outcome: 'result',
        result: {
          request: {
            question: 'Who should own notifications?',
            questionType: 'select',
            choices: [
              { name: 'Alex', value: 'alex-morgan' },
              { name: 'Leah', value: 'leah-brooks' },
            ],
          },
          response: {
            question: 'Who should own notifications?',
            questionType: 'select',
            answer: 'alex-morgan',
          },
        },
      },
    };

    render(<ToolsSection {...baseProps} recentToolEvents={[event]} />);

    expect(screen.getByText('Question prompt')).toBeTruthy();
    expect(screen.getByText(/Who should own notifications\?/i)).toBeTruthy();
    expect(screen.getByText(/type: select · choices: 2/i)).toBeTruthy();
    expect(screen.getByText(/answer: alex-morgan/i)).toBeTruthy();
  });
});
