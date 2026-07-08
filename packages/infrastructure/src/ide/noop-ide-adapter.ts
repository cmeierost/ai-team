import type { IdeAdapter, IdeCodeEditProposal, LspProvider } from '@ai-team/core';
import { NoopLspProvider } from './noop-lsp-provider.js';

export class NoopIdeAdapter implements IdeAdapter {
  readonly lsp: LspProvider = new NoopLspProvider();

  openFile(_filePath: string, _line?: number): Promise<void> {
    return Promise.resolve();
  }

  notifyCodeEditProposal(_proposal: IdeCodeEditProposal): Promise<void> {
    return Promise.resolve();
  }

  isConnected(): boolean {
    return false;
  }

  onAck(_handler: (proposalId: string, action: 'accept' | 'reject') => void): void {
    // no-op
  }

  dispose(): void {
    // no-op
  }
}
