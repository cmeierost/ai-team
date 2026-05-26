import type { Meta, StoryObj } from '@storybook/react-vite';
import { RelativeTime } from './RelativeTime';
import { relativeTimestamps } from '../storybook/storyData';

const meta = {
  title: 'Components/RelativeTime',
  component: RelativeTime,
  tags: ['autodocs'],
  args: {
    timestamp: relativeTimestamps.thisHour,
  },
  argTypes: {
    className: {
      control: false,
    },
  },
} satisfies Meta<typeof RelativeTime>;

export default meta;

type Story = StoryObj<typeof meta>;

export const MinutesAgo: Story = {};

export const MixedExamples: Story = {
  render: () => (
    <div className="storybook-surface">
      <div className="storybook-row">
        <strong>Just now</strong>
        <RelativeTime timestamp={relativeTimestamps.justNow} />
      </div>
      <div className="storybook-row">
        <strong>This hour</strong>
        <RelativeTime timestamp={relativeTimestamps.thisHour} />
      </div>
      <div className="storybook-row">
        <strong>Yesterday</strong>
        <RelativeTime timestamp={relativeTimestamps.yesterday} />
      </div>
      <div className="storybook-row">
        <strong>Last month</strong>
        <RelativeTime timestamp={relativeTimestamps.lastMonth} />
      </div>
    </div>
  ),
};

export const InvalidTimestamp: Story = {
  args: {
    timestamp: 'definitely-not-a-date',
  },
};
