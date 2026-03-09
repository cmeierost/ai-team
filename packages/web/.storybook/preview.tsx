import type { Preview } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import '../src/styles.css';
import './preview.css';

const preview: Preview = {
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="storybook-shell">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
  parameters: {
    layout: 'padded',
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    backgrounds: {
      default: 'ai-team-dark',
      values: [
        {
          name: 'ai-team-dark',
          value: '#1e1e1e',
        },
        {
          name: 'panel',
          value: '#252526',
        },
        {
          name: 'light',
          value: '#ffffff',
        },
      ],
    },
    options: {
      storySort: {
        order: ['Foundations', 'Components'],
      },
    },
  },
};

export default preview;
