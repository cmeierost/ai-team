import type { Meta, StoryObj } from '@storybook/react-vite';
import { Avatar } from './Avatar';
import { storyAgents } from '../storybook/storyData';

const meta = {
  title: 'Components/Avatar',
  component: Avatar,
  tags: ['autodocs'],
  args: {
    agent: storyAgents.adrian,
    size: 'medium',
  },
  argTypes: {
    className: {
      control: false,
    },
  },
} satisfies Meta<typeof Avatar>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithImageAvatar: Story = {
  args: {
    agent: storyAgents.clara,
  },
};

export const InitialsFallback: Story = {
  args: {
    agent: storyAgents.sarah,
  },
};

export const SizeScale: Story = {
  render: (args) => (
    <div className="storybook-row">
      <Avatar {...args} size="small" />
      <Avatar {...args} size="medium" />
      <Avatar {...args} size="large" />
    </div>
  ),
};
