import type { Meta, StoryObj } from '@storybook/react-vite';
import { TeamProvider } from '../context/TeamContext';
import { storyAgents } from '../storybook/storyData';
import { AgentList } from './AgentList';

const meta: Meta<typeof AgentList> = {
  title: 'Components/AgentList',
  component: AgentList,
  decorators: [
    (Story) => (
      <TeamProvider initialAgents={[]}>
        <Story />
      </TeamProvider>
    ),
  ],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: {},
};

export const WithAgents: Story = {
  decorators: [
    (Story) => (
      <TeamProvider initialAgents={Object.values(storyAgents)}>
        <Story />
      </TeamProvider>
    ),
  ],
};
