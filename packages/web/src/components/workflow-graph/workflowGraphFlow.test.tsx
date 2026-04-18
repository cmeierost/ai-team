import { describe, expect, it } from 'vitest';
import type { WorkflowDefinitionDocument } from '@ai-team/api-client';
import {
  buildWorkflowCallFlowMermaid,
  transformWorkflowDefinitionToReactFlow,
} from './workflowCallGraphFlow';

const definition: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'chat-full-loop',
  initial: 'start',
  states: {
    start: {
      transitions: [{ event: 'continue', target: 'tool' }],
    },
    tool: {
      transitions: [{ event: 'continue', target: 'finalize' }],
      invoke: {
        src: 'tool-round',
      },
    },
    finalize: {
      transitions: [{ event: 'done', target: 'notify' }],
    },
    notify: {
      transitions: [
        { event: 'ok', target: 'finish' },
        { event: 'failed', target: 'finish' },
      ],
      invoke: {
        src: 'notify',
      },
    },
    finish: {
      type: 'final',
      transitions: [],
    },
  },
};

const definitionWithErrorInvoke: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'error-bottom-sink',
  initial: 'start',
  states: {
    start: {
      transitions: [{ event: 'continue', target: 'main' }],
    },
    main: {
      transitions: [
        { event: 'ok', target: 'finish' },
        { event: 'error', target: 'failure' },
      ],
      invoke: {
        src: 'main-call',
      },
    },
    failure: {
      transitions: [{ event: 'done', target: 'failed' }],
      invoke: {
        src: 'runFailure',
      },
    },
    finish: {
      type: 'final',
      transitions: [],
    },
    failed: {
      type: 'final',
      transitions: [],
    },
  },
};

const definitionWithRightwardEdge: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'rightward-edge-left-entry',
  initial: 'start',
  states: {
    start: {
      transitions: [
        { event: 'toAlpha', target: 'alpha' },
        { event: 'toBeta', target: 'beta' },
      ],
    },
    alpha: {
      transitions: [{ event: 'then', target: 'beta' }],
      invoke: {
        src: 'alphaCall',
      },
    },
    beta: {
      transitions: [],
      invoke: {
        src: 'betaCall',
      },
    },
  },
};

const definitionWithReturnEdge: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'return-edge-outside',
  initial: 'start',
  states: {
    start: {
      transitions: [{ event: 'toFirst', target: 'first' }],
    },
    first: {
      transitions: [{ event: 'next', target: 'second' }],
      invoke: {
        src: 'firstCall',
      },
    },
    second: {
      transitions: [
        { event: 'retry', target: 'first' },
        { event: 'done', target: 'final' },
      ],
      invoke: {
        src: 'secondCall',
      },
    },
    final: {
      type: 'final',
      transitions: [],
    },
  },
};

const definitionWithGuardedDone: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'guarded-done-routing',
  initial: 'start',
  states: {
    start: {
      transitions: [{ event: 'go', target: 'worker' }],
    },
    worker: {
      transitions: [{ event: 'done', target: 'routeAfterWorker' }],
      invoke: {
        src: 'workerCall',
      },
    },
    routeAfterWorker: {
      transitions: [
        { event: 'always', guard: 'needsRetry', target: 'retry' },
        { event: 'always', guard: 'complete', target: 'finished' },
      ],
    },
    retry: {
      transitions: [],
      invoke: {
        src: 'retryCall',
      },
    },
    finished: {
      type: 'final',
      transitions: [],
    },
  },
};

const definitionWithGuardedDoneViaBridge: WorkflowDefinitionDocument = {
  format: 'workflow/v1',
  id: 'guarded-done-via-bridge',
  initial: 'start',
  states: {
    start: {
      transitions: [{ event: 'go', target: 'worker' }],
    },
    worker: {
      transitions: [{ event: 'done', target: 'routeAfterWorker' }],
      invoke: {
        src: 'workerCall',
      },
    },
    routeAfterWorker: {
      transitions: [
        { event: 'always', guard: 'preturnConsumed', target: 'completed' },
        { event: 'always', guard: 'preturnForwarded', target: 'forwardedBridge' },
        { event: 'always', target: 'sendTurn' },
      ],
    },
    forwardedBridge: {
      transitions: [{ event: 'always', target: 'sendTurn' }],
    },
    sendTurn: {
      transitions: [],
      invoke: {
        src: 'sendTurnCall',
      },
    },
    completed: {
      type: 'final',
      transitions: [],
    },
  },
};

describe('transformWorkflowDefinitionToReactFlow', () => {
  it('maps only invoke states to nodes in call-flow mode', () => {
    const result = transformWorkflowDefinitionToReactFlow(definition);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.id)).toEqual(['tool', 'notify']);
  });

  it('connects invoke states by reachable call-flow transitions', () => {
    const result = transformWorkflowDefinitionToReactFlow(definition);

    expect(result.edges).toHaveLength(1);
    expect(result.edges).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: 'tool', target: 'notify' })])
    );

    expect(result.edges[0]).toEqual(
      expect.objectContaining({
        sourceHandle: 'out-success-left',
        targetHandle: 'in-left',
      })
    );
  });

  it('marks invoke states with dedicated node class', () => {
    const result = transformWorkflowDefinitionToReactFlow(definition);
    const nodeClasses = new Map(result.nodes.map((node) => [node.id, node.className]));

    expect(nodeClasses.get('tool')).toContain('workflow-graph-node-invoked');
    expect(nodeClasses.get('notify')).toContain('workflow-graph-node-invoked');
  });

  it('pushes error invoke state to the bottom sink row', () => {
    const result = transformWorkflowDefinitionToReactFlow(definitionWithErrorInvoke);

    const nodeById = new Map(result.nodes.map((node) => [node.id, node]));
    const mainNode = nodeById.get('main');
    const failureNode = nodeById.get('failure');

    expect(mainNode).toBeDefined();
    expect(failureNode).toBeDefined();
    expect(failureNode?.position.y).toBeGreaterThan(mainNode?.position.y ?? 0);
  });

  it('connects to left target handle when approaching from left side', () => {
    const result = transformWorkflowDefinitionToReactFlow(definitionWithRightwardEdge);

    const alphaToBetaEdge = result.edges.find(
      (edge) => edge.source === 'alpha' && edge.target === 'beta'
    );

    expect(alphaToBetaEdge).toBeDefined();
    expect(alphaToBetaEdge).toEqual(
      expect.objectContaining({
        sourceHandle: 'out-success-right',
        targetHandle: 'in-left',
      })
    );
  });

  it('routes return arrows farther to the outside lanes', () => {
    const result = transformWorkflowDefinitionToReactFlow(definitionWithReturnEdge);

    const returnEdge = result.edges.find(
      (edge) => edge.source === 'second' && edge.target === 'first'
    );

    expect(returnEdge).toBeDefined();
    expect(returnEdge?.className).toContain('workflow-graph-edge-return');

    const laneX = (returnEdge?.data as { laneX?: number } | undefined)?.laneX;
    expect(typeof laneX).toBe('number');
    expect(laneX ?? 0).toBeLessThan(-300);
  });

  it('creates Mermaid fallback for call flow', () => {
    const mermaid = buildWorkflowCallFlowMermaid(definitionWithErrorInvoke);

    expect(mermaid).toContain('flowchart TB');
    expect(mermaid).toContain('❌ error');
    expect(mermaid).toContain('n1');
  });

  it('hides error paths and keeps error-handler signal on nodes', () => {
    const result = transformWorkflowDefinitionToReactFlow(definitionWithErrorInvoke, {
      includeErrorPaths: false,
    });

    expect(result.nodes.map((node) => node.id)).toEqual(['main']);
    expect(
      result.edges.every((edge) => !String(edge.className).includes('workflow-graph-edge-error'))
    ).toBe(true);

    const nodeData = result.nodes[0]?.data as {
      hasErrorHandler?: boolean;
      showErrorDetails?: boolean;
    };
    expect(nodeData.hasErrorHandler).toBe(true);
    expect(nodeData.showErrorDetails).toBe(false);
  });

  it('hides Mermaid error edges but indicates handler in node text', () => {
    const mermaid = buildWorkflowCallFlowMermaid(definitionWithErrorInvoke, {
      includeErrorPaths: false,
    });

    expect(mermaid).not.toContain('❌ error');
    expect(mermaid).toContain('⚠ error handler');
  });

  it('uses guard names for post-done branch labels', () => {
    const graphResult = transformWorkflowDefinitionToReactFlow(definitionWithGuardedDone);
    const workerToRetryEdge = graphResult.edges.find(
      (edge) => edge.source === 'worker' && edge.target === 'retry'
    );

    expect(workerToRetryEdge).toBeDefined();
    expect(String(workerToRetryEdge?.label)).toContain('needsRetry');
    expect(String(workerToRetryEdge?.label)).not.toContain('done');

    const mermaid = buildWorkflowCallFlowMermaid(definitionWithGuardedDone);
    expect(mermaid).toContain('✅ then: needsRetry');
  });

  it('keeps guarded branch labels even when branch reaches call through a bridge state', () => {
    const graphResult = transformWorkflowDefinitionToReactFlow(definitionWithGuardedDoneViaBridge);
    const workerToSendTurnEdge = graphResult.edges.find(
      (edge) => edge.source === 'worker' && edge.target === 'sendTurn'
    );

    expect(workerToSendTurnEdge).toBeDefined();
    expect(String(workerToSendTurnEdge?.label)).toContain('preturnForwarded');
    expect(String(workerToSendTurnEdge?.label)).toContain('always');
    expect(String(workerToSendTurnEdge?.label)).not.toContain('done');

    const mermaid = buildWorkflowCallFlowMermaid(definitionWithGuardedDoneViaBridge);
    expect(mermaid).toContain('✅ then: always, preturnForwarded');
  });
});
