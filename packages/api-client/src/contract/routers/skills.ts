import type { ApiDescription } from '@ts-http/core';

export interface SkillCatalogEntry {
  name: string;
  description: string;
  type?: string;
  contextLevel?: string;
  tools: string[];
}

export interface AgentSkillAssignmentEntry extends SkillCatalogEntry {
  assignedToAgent?: boolean;
}

export interface SearchSkillsResponse {
  entries: AgentSkillAssignmentEntry[];
  timestamp: string;
  agent?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface UpdateAgentSkillResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  skill: string;
  skills: string[];
  changed: boolean;
}

export interface ISkillsService {
  search(query?: { q?: string; agent?: string }): Promise<SearchSkillsResponse>;
  add(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse>;
  remove(body: { agent: string; skill: string }): Promise<UpdateAgentSkillResponse>;
}

export const skillsDesc: ApiDescription<ISkillsService> = {
  subRoute: '/api/skills',
  mapping: {
    search: { method: 'GET', path: '' },
    add: { method: 'POST', path: 'add' },
    remove: { method: 'POST', path: 'remove' },
  },
};
