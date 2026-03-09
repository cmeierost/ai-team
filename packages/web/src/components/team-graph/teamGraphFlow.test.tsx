import { describe, expect, it } from 'vitest';
import type { GraphData } from '../../types';
import { transformGraphDataToReactFlow } from './teamGraphFlow';

const graphData: GraphData = {
  nodes: [
    {
      id: 'sarah-lee',
      type: 'agent',
      data: {
        label: 'Sarah Lee',
        agent: {
          id: 'sarah-lee',
          name: 'Sarah Lee',
          role: 'Chief Architect',
          status: 'available',
        },
      },
    },
    {
      id: 'daniel-navarro',
      type: 'agent',
      data: {
        label: 'Daniel Navarro',
        agent: {
          id: 'daniel-navarro',
          name: 'Daniel Navarro',
          role: 'Frontend Lead',
          status: 'busy',
        },
      },
    },
  ],
  edges: [
    {
      id: 'edge-1',
      source: 'daniel-navarro',
      target: 'sarah-lee',
      type: 'reports-to',
    },
  ],
};

describe('transformGraphDataToReactFlow', () => {
  it('creates react-flow nodes for graph agents', () => {
    const result = transformGraphDataToReactFlow(graphData);

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes.map((node) => node.id)).toEqual(['sarah-lee', 'daniel-navarro']);
  });

  it('swaps reports-to edges into top-down manager-to-report edges', () => {
    const result = transformGraphDataToReactFlow(graphData);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toMatchObject({
      source: 'sarah-lee',
      target: 'daniel-navarro',
      type: 'smoothstep',
    });
  });

  it('keeps managers visually aligned with their own subteams', () => {
    const result = transformGraphDataToReactFlow({
      nodes: [
        {
          id: 'michael-brown',
          type: 'agent',
          data: {
            label: 'Michael Brown',
            agent: { id: 'michael-brown', name: 'Michael Brown', role: 'CEO', status: 'available' },
          },
        },
        {
          id: 'sarah-lee',
          type: 'agent',
          data: {
            label: 'Sarah Lee',
            agent: { id: 'sarah-lee', name: 'Sarah Lee', role: 'Chief Architect', status: 'available' },
          },
        },
        {
          id: 'taylor-reed',
          type: 'agent',
          data: {
            label: 'Taylor Reed',
            agent: { id: 'taylor-reed', name: 'Taylor Reed', role: 'Project Secretary', status: 'available' },
          },
        },
        {
          id: 'daniel-navarro',
          type: 'agent',
          data: {
            label: 'Daniel Navarro',
            agent: { id: 'daniel-navarro', name: 'Daniel Navarro', role: 'Frontend Lead', status: 'busy' },
          },
        },
        {
          id: 'alex-morgan',
          type: 'agent',
          data: {
            label: 'Alex Morgan',
            agent: { id: 'alex-morgan', name: 'Alex Morgan', role: 'Backend Lead', status: 'available' },
          },
        },
        {
          id: 'clara-bishop',
          type: 'agent',
          data: {
            label: 'Clara Bishop',
            agent: { id: 'clara-bishop', name: 'Clara Bishop', role: 'Frontend QA', status: 'available' },
          },
        },
        {
          id: 'samuel-ceeses',
          type: 'agent',
          data: {
            label: 'Samuel Ceeses',
            agent: { id: 'samuel-ceeses', name: 'Samuel Ceeses', role: 'UI Specialist', status: 'available' },
          },
        },
      ],
      edges: [
        { id: 'edge-1', source: 'sarah-lee', target: 'michael-brown', type: 'reports-to' },
        { id: 'edge-2', source: 'taylor-reed', target: 'michael-brown', type: 'reports-to' },
        { id: 'edge-3', source: 'daniel-navarro', target: 'sarah-lee', type: 'reports-to' },
        { id: 'edge-4', source: 'alex-morgan', target: 'sarah-lee', type: 'reports-to' },
        { id: 'edge-5', source: 'clara-bishop', target: 'daniel-navarro', type: 'reports-to' },
        { id: 'edge-6', source: 'samuel-ceeses', target: 'daniel-navarro', type: 'reports-to' },
      ],
    });

    const positions = new Map(result.nodes.map((node) => [node.id, node.position]));
    const michael = positions.get('michael-brown');
    const sarah = positions.get('sarah-lee');
    const taylor = positions.get('taylor-reed');
    const daniel = positions.get('daniel-navarro');
    const alex = positions.get('alex-morgan');
    const clara = positions.get('clara-bishop');
    const samuel = positions.get('samuel-ceeses');

    expect(michael).toBeDefined();
    expect(sarah).toBeDefined();
    expect(taylor).toBeDefined();
    expect(daniel).toBeDefined();
    expect(alex).toBeDefined();
    expect(clara).toBeDefined();
    expect(samuel).toBeDefined();

    expect(michael!.y).toBeLessThan(sarah!.y);
    expect(sarah!.y).toBeLessThan(daniel!.y);
    expect(daniel!.y).toBeLessThan(clara!.y);

    const michaelCenter = michael!.x + 100;
    const danielCenter = daniel!.x + 100;
    const sarahCenter = sarah!.x + 100;
    const taylorCenter = taylor!.x + 100;
    const alexCenter = alex!.x + 100;
    const claraCenter = clara!.x + 100;
    const samuelCenter = samuel!.x + 100;

    const michaelSubteamMin = Math.min(sarahCenter, taylorCenter);
    const michaelSubteamMax = Math.max(sarahCenter, taylorCenter);
    const sarahSubteamMin = Math.min(danielCenter, alexCenter);
    const sarahSubteamMax = Math.max(danielCenter, alexCenter);
    const danielSubteamMin = Math.min(claraCenter, samuelCenter);
    const danielSubteamMax = Math.max(claraCenter, samuelCenter);

    expect(michaelCenter).toBeGreaterThanOrEqual(michaelSubteamMin);
    expect(michaelCenter).toBeLessThanOrEqual(michaelSubteamMax);
    expect(sarahCenter).toBeGreaterThanOrEqual(sarahSubteamMin);
    expect(sarahCenter).toBeLessThanOrEqual(sarahSubteamMax);
    expect(danielCenter).toBeGreaterThanOrEqual(danielSubteamMin);
    expect(danielCenter).toBeLessThanOrEqual(danielSubteamMax);
    expect(alexCenter).toBeLessThan(claraCenter);
    expect(alexCenter).toBeLessThan(samuelCenter);
  });

  it('keeps sibling nodes on the same level from overlapping', () => {
    const result = transformGraphDataToReactFlow({
      nodes: [
        {
          id: 'boss',
          type: 'agent',
          data: {
            label: 'Boss',
            agent: { id: 'boss', name: 'Boss', role: 'Boss', status: 'available' },
          },
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          id: `report-${index + 1}`,
          type: 'agent' as const,
          data: {
            label: `Report ${index + 1}`,
            agent: {
              id: `report-${index + 1}`,
              name: `Report ${index + 1}`,
              role: 'Engineer',
              status: 'available' as const,
            },
          },
        })),
      ],
      edges: Array.from({ length: 5 }, (_, index) => ({
        id: `edge-${index + 1}`,
        source: `report-${index + 1}`,
        target: 'boss',
        type: 'reports-to' as const,
      })),
    });

    const reportNodes = result.nodes
      .filter((node) => node.id.startsWith('report-'))
      .sort((left, right) => left.position.x - right.position.x);

    for (let index = 1; index < reportNodes.length; index += 1) {
      const previousRightEdge = reportNodes[index - 1].position.x + 200;
      expect(reportNodes[index].position.x).toBeGreaterThan(previousRightEdge);
    }
  });
});