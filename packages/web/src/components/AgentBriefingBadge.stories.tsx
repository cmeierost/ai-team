import type { Meta, StoryObj } from '@storybook/react-vite';
import { AgentBriefingBadge } from './AgentBriefingBadge';

const meta = {
  title: 'Components/AgentBriefingBadge',
  component: AgentBriefingBadge,
  tags: ['autodocs'],
  args: {
    targetAgentName: 'Sarah Lee',
  },
} satisfies Meta<typeof AgentBriefingBadge>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const InMessageRow: Story = {
  render: (args) => (
    <div className="storybook-card card">
      <div className="storybook-row">
        <strong>Agent briefing</strong>
        <AgentBriefingBadge {...args} />
      </div>
    </div>
  ),
};
