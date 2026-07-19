import type { ApiDescription } from '@ts-http/core';

export type PathMode = 'read' | 'write' | 'list';

export interface FilePatternCollections {
  readPaths: string[];
  writePaths: string[];
  listPaths: string[];
}

export interface GetFilePatternsResponse {
  global: {
    allowPaths: string[];
  } & FilePatternCollections;
  agent?: {
    id: string;
  } & FilePatternCollections;
}

export interface UpdateGlobalPathResponse {
  mode: PathMode;
  paths: string[];
}

export interface UpdateAgentPathResponse {
  agent: {
    id: string;
    name: string;
    role: string;
  };
  mode: PathMode;
  paths: string[];
}

export interface IPermissionService {
  getPatterns(query?: { agent?: string }): Promise<GetFilePatternsResponse>;
  getTree(query?: {
    maxDepth?: number;
    includeHidden?: boolean;
    rootSubPath?: string;
  }): Promise<unknown>;
  allowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse>;
  disallowAll(body: { path: string; mode?: PathMode }): Promise<UpdateGlobalPathResponse>;
  allow(body: {
    agent: string;
    path: string;
    mode?: PathMode;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse>;
  disallow(body: {
    agent: string;
    path: string;
    mode?: PathMode;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse>;
  permissionAllow(body: {
    agent: string;
    path: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse>;
  permissionDeny(body: {
    agent: string;
    path: string;
    requestedBy?: string;
    approvedByUser?: boolean;
  }): Promise<UpdateAgentPathResponse>;
}

export const permissionDesc: ApiDescription<IPermissionService> = {
  subRoute: '/api/permission',
  mapping: {
    getPatterns: { method: 'GET', path: 'patterns' },
    getTree: { method: 'GET', path: 'tree' },
    allowAll: { method: 'POST', path: 'allow' },
    disallowAll: { method: 'DELETE', path: 'allow' },
    allow: { method: 'POST', path: 'agent-allow' },
    disallow: { method: 'POST', path: 'agent-disallow' },
    permissionAllow: { method: 'POST', path: 'permission-allow' },
    permissionDeny: { method: 'POST', path: 'permission-deny' },
  },
};
