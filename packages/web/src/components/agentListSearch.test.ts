import { describe, expect, it } from 'vitest';
import type { Agent } from '../types';
import { rankAgentsBySearch } from './agentListSearch';

const agents: Agent[] = [
  {
    id: 'daniel-navarro',
    name: 'Daniel Navarro',
    role: 'Frontend Lead',
    specializations: ['React architecture', 'Zustand'],
    markdown: 'Owns frontend architecture and web package delivery.',
  },
  {
    id: 'clara-bishop',
    name: 'Clara Bishop',
    role: 'Frontend Quality Engineer',
    reportsTo: 'daniel-navarro',
    specializations: ['Storybook', 'Browser testing'],
    markdown: 'Reports to Daniel Navarro and focuses on frontend quality.',
  },
  {
    id: 'samuel-ceeses',
    name: 'Samuel Ceeses',
    role: 'CSS and UI styling specialist',
    reportsTo: 'daniel-navarro',
    specializations: ['Visual polish'],
    markdown: 'Improves visual appearance and styling consistency.',
  },
];

describe('rankAgentsBySearch', () => {
  it('keeps a direct name hit above agents that only mention that person in relationship text', () => {
    const results = rankAgentsBySearch(agents, 'Daniel Navarro');

    expect(results.map((agent) => agent.id)).toEqual([
      'daniel-navarro',
      'clara-bishop',
      'samuel-ceeses',
    ]);
  });

  it('matches broader profile text when the query is not a name hit', () => {
    const results = rankAgentsBySearch(agents, 'browser testing');

    expect(results[0]?.id).toBe('clara-bishop');
  });

  it('returns all agents unchanged when the search term is empty', () => {
    expect(rankAgentsBySearch(agents, '')).toEqual(agents);
  });

  it('supports searching by role and specialization text', () => {
    const results = rankAgentsBySearch(agents, 'React architecture');

    expect(results[0]?.id).toBe('daniel-navarro');
  });
});