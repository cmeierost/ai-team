import type { ApiDescription } from '@ts-http/core';

export interface ToolCatalogEntry {
  name: string;
  description: string;
  group?: string;
  schema: Record<string, unknown>;
  tags?: string[];
  examples?: string[];
  /** True when the tool's allowed/denied status is governed by file-path permissions at runtime rather than static agent config. */
  fileRightsDependent?: boolean;
}

export interface AgentToolPermissionEntry extends ToolCatalogEntry {
  allowedForAgent?: boolean;
  deniedReason?: string;
}

export interface ListToolsResponse {
  entries: AgentToolPermissionEntry[];
  timestamp: string;
  agent?: {
    id: string;
    name: string;
    role: string;
  };
}

export interface UpdateAgentToolResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  tool: string;
  tools: string[];
  changed: boolean;
}

export interface GovernanceMutationOptions {
  requestedBy: string;
  approvedByUser: boolean;
}

export interface IToolsService {
  list(query?: { agent?: string }): Promise<ListToolsResponse>;
  allow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse>;
  disallow(body: { agent: string; tool: string }): Promise<UpdateAgentToolResponse>;
  toolAllow(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse>;
  toolDeny(body: {
    agent: string;
    tool: string;
    requestedBy: string;
    approvedByUser: boolean;
  }): Promise<UpdateAgentToolResponse>;
}

export const toolsDesc: ApiDescription<IToolsService> = {
  subRoute: '/api/tools',
  mapping: {
    list: { method: 'GET', path: '' },
    allow: { method: 'POST', path: 'allow' },
    disallow: { method: 'POST', path: 'disallow' },
    toolAllow: { method: 'POST', path: 'tool-allow' },
    toolDeny: { method: 'POST', path: 'tool-deny' },
  },
};
