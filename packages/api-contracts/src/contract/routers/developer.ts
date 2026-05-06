import type { ApiDescription } from '@ts-http/core';

export interface IDeveloperService {
  getMe(): Promise<{ id: string; name: string; email?: string }>;
}

export const developerDesc: ApiDescription<IDeveloperService> = {
  subRoute: '/api/developer',
  mapping: {
    getMe: { method: 'GET', path: 'me' },
  },
};
