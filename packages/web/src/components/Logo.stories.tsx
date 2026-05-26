import type { Meta, StoryObj } from '@storybook/react-vite';
import { Logo } from './Logo';

const meta = {
  title: 'Foundations/Logo',
  component: Logo,
  tags: ['autodocs'],
  args: {
    size: 64,
  },
  argTypes: {
    className: {
      control: false,
    },
  },
} satisfies Meta<typeof Logo>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ScaleRamp: Story = {
  render: () => (
    <div className="storybook-row storybook-row-end">
      <Logo size={32} />
      <Logo size={64} />
      <Logo size={96} />
    </div>
  ),
};
