import type { IdeAdapter, IIdeAdapterFactory } from '@ai-team/core';
import { createIdeAdapter } from './create-ide-adapter.js';

export class InfrastructureIdeAdapterFactory implements IIdeAdapterFactory {
  createAsync(workspaceRoot: string, channel: 'cli' | 'web'): Promise<IdeAdapter> {
    return createIdeAdapter(workspaceRoot, channel);
  }
}
