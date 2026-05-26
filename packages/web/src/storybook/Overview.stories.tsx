import type { Meta, StoryObj } from '@storybook/react-vite';

function StorybookOverview() {
  return (
    <div className="storybook-surface">
      <section className="card storybook-card">
        <h2 className="section-title">Web Storybook</h2>
        <p className="text-secondary mt-md">
          Storybook is wired as a quality surface for isolated React components in{' '}
          <code>packages/web</code>.
        </p>
      </section>

      <section className="card storybook-card">
        <h3 className="section-title">What is included</h3>
        <ul className="mt-md storybook-list">
          <li>Vite-native Storybook configuration</li>
          <li>Autodocs for CSF stories</li>
          <li>Accessibility addon for component review</li>
          <li>Shared story fixtures in <code>src/storybook/storyData.ts</code></li>
        </ul>
      </section>

      <section className="card storybook-card">
        <h3 className="section-title">Next coverage targets</h3>
        <ul className="mt-md storybook-list">
          <li>Route-aware shell components with targeted decorators</li>
          <li>Graph and dashboard states with mocked service data</li>
          <li>Interaction flows that benefit from browser-driven checks</li>
        </ul>
      </section>
    </div>
  );
}

const meta = {
  title: 'Foundations/Overview',
  component: StorybookOverview,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
} satisfies Meta<typeof StorybookOverview>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
