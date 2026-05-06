import type { ApiDescription } from '@ts-http/core';

export interface SystemInfo {
  workspace: string;
  branch: string | null;
  apiUrl: string;
  package: {
    name: string | null;
    version: string | null;
    description: string | null;
  } | null;
}

export interface ISystemService {
  health(): Promise<{ status: 'ok' }>;
  info(): Promise<SystemInfo>;
}

export const systemDesc: ApiDescription<ISystemService> = {
  subRoute: '/api',
  mapping: {
    health: { method: 'GET', path: 'health' },
    info: { method: 'GET', path: 'info' },
  },
};
