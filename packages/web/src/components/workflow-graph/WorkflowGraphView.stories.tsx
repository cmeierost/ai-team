import type { Meta, StoryObj } from '@storybook/react-vite';
import type { WorkflowDefinitionDocument } from '@ai-team/api-client';
import { WorkflowGraphView } from './WorkflowGraphView';

const workflowDefinition: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'chat-full-loop',
  initial: 'preturn-interceptors',
  states: {
    'preturn-interceptors': {
      transitions: [
        { event: 'continue', target: 'send-turn' },
        { event: 'consumed', target: 'complete' },
      ],
    },
    'send-turn': {
      transitions: [
        { event: 'toolRoundNeeded', target: 'tool-round' },
        { event: 'postTurn', target: 'post-turn-resolution' },
      ],
      invoke: {
        src: 'send-turn',
      },
    },
    'tool-round': {
      transitions: [{ event: 'resumeLlm', target: 'send-turn' }],
      invoke: {
        src: 'tool-round',
      },
    },
    'post-turn-resolution': {
      transitions: [
        { event: 'handoffRequired', target: 'handoff-transition' },
        { event: 'normalComplete', target: 'complete' },
      ],
    },
    'handoff-transition': {
      transitions: [{ event: 'done', target: 'complete' }],
    },
    complete: {
      type: 'final',
      transitions: [],
    },
  },
};

const meta: Meta<typeof WorkflowGraphView> = {
  title: 'Planning/WorkflowGraphView',
  component: WorkflowGraphView,
  tags: ['autodocs'],
  decorators: [
    (Story) => (
      <div className="workflow-graph-story-shell">
        <Story />
      </div>
    ),
  ],
  args: {
    definition: workflowDefinition,
  },
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
