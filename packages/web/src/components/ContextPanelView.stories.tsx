import { useState, type ComponentProps } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { ContextPanelView, type ContextSection } from './ContextPanelView';
import { TaskPriority, TaskStatus, TaskType, type Artifact, type ChatSession, type SessionActivatedTool, type Task } from '../types';
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

const artifacts: Artifact[] = [
  {
    id: 'artifact-1',
    type: 'summary',
    title: 'ContextPanel first-slice brief',
    content: 'Summary content',
    createdAt: '2026-03-09T08:10:00.000Z',
    createdBy: 'clemens-meier',
    sourceSessionId: 'session-current',
    fromMessageIndex: 2,
    toMessageIndex: 12,
    filepath: '.ai-team/artifacts/briefs/context-panel-first-slice.md',
  },
  {
    id: 'artifact-2',
    type: 'brief',
    title: 'Chat runtime follow-up',
    content: 'Follow-up content',
    createdAt: '2026-03-08T15:00:00.000Z',
    createdBy: 'clemens-meier',
    sourceSessionId: 'session-previous',
    fromMessageIndex: 0,
    toMessageIndex: 8,
    filepath: '.ai-team/artifacts/briefs/chat-runtime-follow-up.md',
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

type DemoArgs = ComponentProps<typeof ContextPanelView>;

function ContextPanelStory(args: DemoArgs) {
  const [expandedSection, setExpandedSection] = useState<ContextSection | null>(args.expandedSection);
  const [notesDraft, setNotesDraft] = useState(args.notesDraft);
  const [selectedArtifacts, setSelectedArtifacts] = useState(args.artifacts);

  return (
    <div className="context-panel-story-shell">
      <ContextPanelView
        {...args}
        expandedSection={expandedSection}
        notesDraft={notesDraft}
        artifacts={selectedArtifacts}
        onToggleSection={(section) => setExpandedSection((current) => (current === section ? null : section))}
        onNotesDraftChange={setNotesDraft}
        onSaveNotes={() => undefined}
        onToggleArtifact={(artifactId) => {
          setSelectedArtifacts((current) =>
            current.includes(artifactId)
              ? current.filter((id) => id !== artifactId)
              : [...current, artifactId],
          );
        }}
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
    artifacts: ['artifact-1'],
    allowedTools: ['read_file', 'apply_patch', 'run_in_terminal'],
    allArtifacts: artifacts,
    sessions,
    tasks,
    skillEntries,
    recentToolEvents,
    activeToolNames: ['read_file'],
    notesDraft: 'Keep the panel prop-driven so Storybook can review it without API wiring.',
    hasSession: true,
    savingNotes: false,
    notesError: null,
    skillsLoading: false,
    skillsError: null,
    skillActionPending: null,
    loadingArtifacts: false,
    expandedSection: 'sessions',
    onToggleSection: () => undefined,
    onNotesDraftChange: () => undefined,
    onSaveNotes: () => undefined,
    onToggleSkill: () => undefined,
    onToggleArtifact: () => undefined,
    onSwitchSession: () => undefined,
    onDeleteSession: () => undefined,
    onCreateSession: () => undefined,
    onOpenSessionGraph: () => undefined,
  },
} satisfies Meta<typeof ContextPanelView>;

export default meta;

type Story = StoryObj<typeof meta>;

export const SessionsOverview: Story = {};

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
    allowedTools: ['com_ask', 'read_file', 'apply_patch'],
    recentToolEvents: questionToolEvents,
    activeToolNames: [],
  },
};