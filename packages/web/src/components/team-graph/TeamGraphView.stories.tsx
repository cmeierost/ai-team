import type { Meta, StoryObj } from '@storybook/react-vite';
import type { GraphData } from '../../types';
import { TeamGraphNodeCard } from './TeamGraphNodeCard';
import { TeamGraphView } from './TeamGraphView';

const graphData: GraphData = {
  nodes: [
    {
      id: 'sarah-lee',
      type: 'agent',
      data: {
        label: 'Sarah Lee',
        agent: {
          id: 'sarah-lee',
          name: 'Sarah Lee',
          role: 'Chief Architect',
          type: 'executive',
          status: 'available',
        },
      },
    },
    {
      id: 'daniel-navarro',
      type: 'agent',
      data: {
        label: 'Daniel Navarro',
        agent: {
          id: 'daniel-navarro',
          name: 'Daniel Navarro',
          role: 'Frontend Lead',
          type: 'team-lead',
          status: 'busy',
        },
      },
    },
    {
      id: 'clara-bishop',
      type: 'agent',
      data: {
        label: 'Clara Bishop',
        agent: {
          id: 'clara-bishop',
          name: 'Clara Bishop',
          role: 'Frontend Quality Engineer',
          type: 'quality-gate',
          status: 'available',
        },
      },
    },
  ],
  edges: [
    { id: 'edge-1', source: 'daniel-navarro', target: 'sarah-lee', type: 'reports-to' },
    { id: 'edge-2', source: 'clara-bishop', target: 'daniel-navarro', type: 'reports-to' },
  ],
};

const danielAgent = graphData.nodes[1]?.data.agent;

const meta: Meta<typeof TeamGraphView> = {
  title: 'Organization/TeamGraphView',
  component: TeamGraphView,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="team-graph-story-shell">
        <Story />
      </div>
    ),
  ],
  args: {
    graphData,
    onNodeSelect: () => undefined,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const NodeCard: Story = {
  render: () => (
    <div className="team-graph-story-shell team-graph-story-shell--card">
      <div className="team-graph-node-shell">
        {danielAgent ? <TeamGraphNodeCard agent={danielAgent} /> : null}
      </div>
    </div>
  ),
};