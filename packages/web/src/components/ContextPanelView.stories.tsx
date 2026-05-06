import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { AgentToolPermissionEntry } from '@ai-team/api-contracts';
import { ContextPanelView, type ContextSection } from './ContextPanelView';
import type { ContextPanelNoteItem } from '../utils/contextPanel';
import {
  TaskPriority,
  TaskStatus,
  TaskType,
  type ChatSession,
  type Note,
  type SessionActivatedTool,
  type Task,
} from '../types';
import type { SkillEntry } from '../hooks/useSkillsForAgent';

const sessions: ChatSession[] = [
  {
    id: 'session-current',
    agentId: 'daniel-navarro',
    agentIds: ['daniel-navarro'],
    developerId: 'clemens-meier',
    title: 'ContextPanel refactor',
    startedAt: '2026-03-09T07:45:00.000Z',
    lastActivityAt: '2026-03-09T08:58:00.000Z',
    messageCount: 18,
    artifacts: ['artifact-1'],
    allowedFiles: ['packages/web/src/components/ContextPanel.tsx'],
    notes: 'Keep views dumb and move fetch logic into Query hooks.',
  },
  {
    id: 'session-previous',
    agentId: 'daniel-navarro',
    agentIds: ['daniel-navarro'],
    developerId: 'clemens-meier',
    startedAt: '2026-03-08T14:15:00.000Z',
    lastActivityAt: '2026-03-08T15:05:00.000Z',
    messageCount: 11,
    artifacts: [],
    allowedFiles: ['packages/web/src/components/ChatPanel.tsx'],
  },
];

const tasks: Task[] = [
  {
    id: 'task-1',
    type: TaskType.FEATURE,
    title: 'Extract ContextPanel view',
    createdBy: 'clemens-meier',
    createdByType: 'human',
    assignedTo: 'daniel-navarro',
    status: TaskStatus.IN_PROGRESS,
    priority: TaskPriority.HIGH,
    requiresApproval: false,
    subtaskIds: ['task-1a', 'task-1b'],
    createdAt: '2026-03-09T07:00:00.000Z',
    updatedAt: '2026-03-09T08:55:00.000Z',
  },
];

const skillEntries: SkillEntry[] = [
  {
    name: 'tanstack-query-zustand-boundary',
    assignedToAgent: true,
    description: 'Split server state from runtime client state cleanly.',
  },
  {
    name: 'web-state-logic-unit-testing',
    assignedToAgent: true,
    description: 'Add direct unit coverage for extracted state logic.',
  },
  {
    name: 'frontend-quality-storybook',
    assignedToAgent: false,
    description: 'Keep Storybook useful as a frontend quality surface.',
  },
];

const recentToolEvents: SessionActivatedTool[] = [
  {
    toolName: 'apply_patch',
    toolPhase: 'result',
    message: 'ContextPanelView extracted successfully.',
    timestamp: '2026-03-09T08:57:00.000Z',
  },
  {
    toolName: 'read_file',
    toolPhase: 'start',
    message: 'Inspecting ContextPanel CSS.',
    timestamp: '2026-03-09T08:55:00.000Z',
  },
];

const baseNotes: Note[] = [
  {
    id: 'note-1',
    agentId: 'daniel-navarro',
    sessionId: 'session-current',
    title: 'Context panel delivery notes',
    content: 'Keep server state in Query and drafts local.',
    hiddenFromLlm: false,
    showOnDashboard: true,
    createdAt: '2026-03-09T08:20:00.000Z',
    updatedAt: '2026-03-09T08:52:00.000Z',
  },
  {
    id: 'note-2',
    agentId: 'daniel-navarro',
    sessionId: 'session-current',
    content: 'Attachment only note',
    attachment: {
      id: 'note-2-attachment-1',
      fileName: 'context-panel-wireframe.png',
      filePath: '.ai-team/private/note-attachments/context-panel-wireframe.png',
      sizeBytes: 24576,
      description: 'Draft wireframe',
    },
    hiddenFromLlm: false,
    showOnDashboard: false,
    createdAt: '2026-03-09T08:24:00.000Z',
    updatedAt: '2026-03-09T08:54:00.000Z',
  },
  {
    id: 'note-3',
    agentId: 'leah-brooks',
    sessionId: 'session-previous',
    title: 'Thread runtime follow-up',
    content: 'This one is visible in the thread but not yet shared.',
    hiddenFromLlm: false,
    showOnDashboard: false,
    createdAt: '2026-03-09T08:10:00.000Z',
    updatedAt: '2026-03-09T08:56:00.000Z',
  },
];

const notes: ContextPanelNoteItem[] = [
  {
    note: baseNotes[0]!,
    ownerSession: {
      sessionId: 'session-current',
      agentIds: ['daniel-navarro'],
      agentNames: ['Daniel Navarro'],
      developerId: 'clemens-meier',
      title: 'ContextPanel refactor',
      startedAt: '2026-03-09T07:45:00.000Z',
      lastActivityAt: '2026-03-09T08:58:00.000Z',
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 18,
      messages: [],
    },
    isOwnedByCurrentSession: true,
    isSharedWithCurrentSession: true,
    canPullIntoCurrentSession: false,
  },
  {
    note: baseNotes[1]!,
    ownerSession: {
      sessionId: 'session-current',
      agentIds: ['daniel-navarro'],
      agentNames: ['Daniel Navarro'],
      developerId: 'clemens-meier',
      title: 'ContextPanel refactor',
      startedAt: '2026-03-09T07:45:00.000Z',
      lastActivityAt: '2026-03-09T08:58:00.000Z',
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 18,
      messages: [],
    },
    isOwnedByCurrentSession: true,
    isSharedWithCurrentSession: true,
    canPullIntoCurrentSession: false,
  },
  {
    note: baseNotes[2]!,
    ownerSession: {
      sessionId: 'session-previous',
      agentIds: ['leah-brooks'],
      agentNames: ['Leah Brooks'],
      developerId: 'clemens-meier',
      title: 'Runtime follow-up',
      startedAt: '2026-03-09T08:10:00.000Z',
      lastActivityAt: '2026-03-09T08:56:00.000Z',
      previousSessionId: 'session-current',
      mergedFromSessionIds: null,
      messageCount: 12,
      messages: [],
    },
    isOwnedByCurrentSession: false,
    isSharedWithCurrentSession: false,
    canPullIntoCurrentSession: true,
  },
];

const questionToolEvents: SessionActivatedTool[] = [
  {
    toolName: 'com_ask',
    toolPhase: 'result',
    message: 'Question answered',
    timestamp: '2026-03-09T08:58:30.000Z',
    toolResult: {
      toolName: 'com_ask',
      outcome: 'result',
      result: {
        request: {
          question: 'Who should own the context panel orchestration flow?',
          questionType: 'select',
          choices: [
            { name: 'Daniel Navarro', value: 'daniel-navarro' },
            { name: 'Leah Brooks', value: 'leah-brooks' },
            { name: 'Marcus Vale', value: 'marcus-vale' },
          ],
        },
        response: {
          question: 'Who should own the context panel orchestration flow?',
          questionType: 'select',
          answer: 'daniel-navarro',
        },
      },
    },
  },
  {
    toolName: 'com_ask',
    toolPhase: 'error',
    message: 'questionType "select" requires a non-empty choices array.',
    timestamp: '2026-03-09T08:59:00.000Z',
    toolResult: {
      toolName: 'com_ask',
      outcome: 'error',
      result: {
        request: {
          question: 'Pick a teammate',
          questionType: 'select',
        },
        error: 'questionType "select" requires a non-empty choices array.',
      },
    },
  },
];

function ContextPanelStory(args: ComponentProps<typeof ContextPanelView>) {
  const [expandedSection, setExpandedSection] = useState<ContextSection | null>(
    args.expandedSection
  );

  return (
    <div className="context-panel-story-shell">
      <ContextPanelView
        {...args}
        expandedSection={expandedSection}
        onToggleSection={(section) =>
          setExpandedSection((current) => (current === section ? null : section))
        }
        onSelectNote={() => undefined}
        onNewNote={() => undefined}
      />
    </div>
  );
}

const meta = {
  title: 'Components/ContextPanelView',
  component: ContextPanelView,
  parameters: {
    layout: 'fullscreen',
  },
  tags: ['autodocs'],
  render: (args) => <ContextPanelStory {...args} />,
  args: {
    agentId: 'daniel-navarro',
    sessionId: 'session-current',
    toolEntries: [
      {
        name: 'read_file',
        description: 'Read a file',
        group: 'fs',
        schema: {},
        allowedForAgent: true,
        fileRightsDependent: true,
      },
      {
        name: 'apply_patch',
        description: 'Apply a patch',
        group: 'fs',
        schema: {},
        allowedForAgent: true,
        fileRightsDependent: true,
      },
      {
        name: 'run_in_terminal',
        description: 'Run command',
        group: 'exec',
        schema: {},
        allowedForAgent: true,
      },
    ] as AgentToolPermissionEntry[],
    sessions,
    tasks,
    skillEntries,
    recentToolEvents,
    activeToolNames: ['read_file'],
    notes,
    notesLoading: false,
    sharingNoteId: null,
    hasSession: true,
    skillsLoading: false,
    skillsError: null,
    skillActionPending: null,
    expandedSection: 'sessions',
    onToggleSection: () => undefined,
    onSelectNote: () => undefined,
    onNewNote: () => undefined,
    onToggleSkill: () => undefined,
    onSwitchSession: () => undefined,
    onDeleteSession: () => undefined,
    onCreateSession: () => undefined,
    onOpenSessionGraph: () => undefined,
  },
} satisfies Meta<typeof ContextPanelView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SessionsOverview: Story = {
  args: {},
};

export const NotesFocused: Story = {
  args: {
    expandedSection: 'notes',
  },
};

export const ToolsAndArtifacts: Story = {
  args: {
    expandedSection: 'tools',
  },
};

export const QuestionToolStructuredResults: Story = {
  args: {
    expandedSection: 'tools',
    toolEntries: [
      {
        name: 'com_ask',
        description: 'Ask a question',
        group: 'com',
        schema: {},
        allowedForAgent: true,
      },
      {
        name: 'read_file',
        description: 'Read a file',
        group: 'fs',
        schema: {},
        allowedForAgent: true,
        fileRightsDependent: true,
      },
      {
        name: 'apply_patch',
        description: 'Apply a patch',
        group: 'fs',
        schema: {},
        allowedForAgent: false,
        deniedReason: 'Not in agent tools list',
      },
    ] as AgentToolPermissionEntry[],
    recentToolEvents: questionToolEvents,
    activeToolNames: [],
  },
};
