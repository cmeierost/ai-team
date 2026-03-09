import type { Meta, StoryObj } from '@storybook/react-vite';
import '../../components/SessionGraph.css';
import type { SessionThread } from '../../types';
import { storyAgents } from '../../storybook/storyData';
import { SessionGraphView } from './SessionGraphView';

const thread: SessionThread = {
  rootSessionId: 'session-1',
  currentSessionId: 'session-3',
  depth: 2,
  sessions: [
    {
      sessionId: 'session-1',
      agentIds: ['sarah-lee'],
      agentNames: ['Sarah Lee'],
      developerId: 'dev',
      title: 'Architecture kickoff',
      startedAt: '2026-03-09T09:00:00.000Z',
      lastActivityAt: '2026-03-09T09:20:00.000Z',
      previousSessionId: null,
      mergedFromSessionIds: null,
      messageCount: 12,
      messages: [],
    },
    {
      sessionId: 'session-2',
      agentIds: ['adrian-foster'],
      agentNames: ['Adrian Foster'],
      developerId: 'dev',
      title: 'Research handoff',
      startedAt: '2026-03-09T09:25:00.000Z',
      lastActivityAt: '2026-03-09T09:55:00.000Z',
      previousSessionId: 'session-1',
      mergedFromSessionIds: null,
      messageCount: 18,
      messages: [],
    },
    {
      sessionId: 'session-3',
      agentIds: ['clara-bishop'],
      agentNames: ['Clara Bishop'],
      developerId: 'dev',
      title: 'Quality review',
      startedAt: '2026-03-09T10:00:00.000Z',
      lastActivityAt: '2026-03-09T10:08:00.000Z',
      previousSessionId: 'session-2',
      mergedFromSessionIds: null,
      messageCount: 6,
      messages: [],
    },
  ],
  handoffs: [
    {
      handoffId: 'handoff-1',
      fromSessionId: 'session-1',
      toSessionId: 'session-2',
      fromAgentIds: ['sarah-lee'],
      toAgentIds: ['adrian-foster'],
    },
    {
      handoffId: 'handoff-2',
      fromSessionId: 'session-2',
      toSessionId: 'session-3',
      fromAgentIds: ['adrian-foster'],
      toAgentIds: ['clara-bishop'],
    },
  ],
};

const meta: Meta<typeof SessionGraphView> = {
  title: 'Components/SessionGraphView',
  component: SessionGraphView,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="session-graph-story-shell">
        <Story />
      </div>
    ),
  ],
  args: {
    thread,
    agents: [storyAgents.sarah, storyAgents.adrian, storyAgents.clara],
    activeSessionId: 'session-3',
    onSelectSession: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithGhostSession: Story = {
  args: {
    thread: {
      ...thread,
      handoffs: [
        ...thread.handoffs,
        {
          handoffId: 'handoff-3',
          fromSessionId: 'ghost-session',
          toSessionId: 'session-1',
          fromAgentIds: ['adrian-foster'],
          toAgentIds: ['sarah-lee'],
        },
      ],
    },
  },
};