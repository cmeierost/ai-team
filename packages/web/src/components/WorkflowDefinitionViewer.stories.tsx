import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { WorkflowDefinitionApiResponse } from '@ai-team/api-client';
import type { Meta, StoryObj } from '@storybook/react-vite';
import type { ReactNode } from 'react';
import { TeamProvider } from '../context/TeamContext';
import { contextPanelQueryKeys } from '../hooks/contextPanelQueryKeys';
import { WorkflowDefinitionViewer } from './WorkflowDefinitionViewer';

const DEFAULT_WORKFLOW_ID = 'chat-full-loop';

const workflowResponse: WorkflowDefinitionApiResponse = {
  workflowId: DEFAULT_WORKFLOW_ID,
  format: 'workflow/v1',
  definitionJson: {
    format: 'workflow/v1',
    id: DEFAULT_WORKFLOW_ID,
    initial: 'preturn',
    states: {
      preturn: {
        invoke: {
          src: 'runPreturnInterceptors',
        },
        transitions: [
          { event: 'done', target: 'routeAfterPreturn' },
          { event: 'error', target: 'failure' },
        ],
      },
      routeAfterPreturn: {
        transitions: [
          { event: 'always', guard: 'preturnConsumed', target: 'completed' },
          { event: 'always', guard: 'preturnForwarded', target: 'prepareForwardedAutoReact' },
          { event: 'always', target: 'sendTurn' },
        ],
      },
      prepareForwardedAutoReact: {
        transitions: [{ event: 'always', target: 'sendTurn' }],
      },
      sendTurn: {
        invoke: {
          src: 'runSendTurn',
        },
        transitions: [
          { event: 'done', target: 'routeAfterSendTurn' },
          { event: 'error', target: 'failure' },
        ],
      },
      routeAfterSendTurn: {
        transitions: [
          { event: 'always', guard: 'sendTurnNeedsToolRound', target: 'toolRound' },
          { event: 'always', target: 'postTurnResolution' },
        ],
      },
      toolRound: {
        invoke: {
          src: 'runToolRound',
        },
        transitions: [
          { event: 'done', target: 'routeAfterToolRound' },
          { event: 'error', target: 'failure' },
        ],
      },
      routeAfterToolRound: {
        transitions: [
          { event: 'always', guard: 'toolRoundResumeLlm', target: 'sendTurn' },
          { event: 'always', target: 'postTurnResolution' },
        ],
      },
      postTurnResolution: {
        invoke: {
          src: 'runPostTurnResolution',
        },
        transitions: [
          { event: 'done', target: 'routeAfterPostTurn' },
          { event: 'error', target: 'failure' },
        ],
      },
      routeAfterPostTurn: {
        transitions: [
          { event: 'always', guard: 'postTurnNormalComplete', target: 'completed' },
          { event: 'always', guard: 'postTurnHandoffRequired', target: 'handoffTransition' },
          { event: 'always', target: 'completed' },
        ],
      },
      handoffTransition: {
        invoke: {
          src: 'runHandoffTransition',
        },
        transitions: [
          { event: 'done', target: 'sendTurn' },
          { event: 'error', target: 'failure' },
        ],
      },
      failure: {
        invoke: {
          src: 'runFailure',
        },
        transitions: [{ event: 'done', target: 'failed' }],
      },
      completed: {
        type: 'final',
        transitions: [],
      },
      failed: {
        type: 'final',
        transitions: [],
      },
    },
  },
  definitionYaml: [
    'format: workflow/v1',
    `id: ${DEFAULT_WORKFLOW_ID}`,
    'initial: preturn',
    'states:',
    '  preturn:',
    '    invoke:',
    '      src: runPreturnInterceptors',
    '    transitions:',
    '      - event: done',
    '        target: routeAfterPreturn',
    '      - event: error',
    '        target: failure',
  ].join('\n'),
};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Number.POSITIVE_INFINITY,
      gcTime: Number.POSITIVE_INFINITY,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    },
  },
});

queryClient.setQueryData(
  contextPanelQueryKeys.workflowDefinition(DEFAULT_WORKFLOW_ID),
  workflowResponse
);

function WorkflowDefinitionViewerStoryProvider({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <QueryClientProvider client={queryClient}>
      <TeamProvider initialAgents={[]}>{children}</TeamProvider>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof WorkflowDefinitionViewer> = {
  title: 'Components/WorkflowDefinitionViewer',
  component: WorkflowDefinitionViewer,
  tags: ['autodocs'],
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <WorkflowDefinitionViewerStoryProvider>
        <Story />
      </WorkflowDefinitionViewerStoryProvider>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof meta>;

export const Default: Story = {};
