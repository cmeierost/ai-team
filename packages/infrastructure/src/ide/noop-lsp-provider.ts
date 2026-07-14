import type { LspOperation, LspParams, LspProvider, LspResult } from '@ai-team/core';

export class NoopLspProvider implements LspProvider {
  async execute(_operation: LspOperation, _params: LspParams): Promise<LspResult> {
    return { kind: 'locations', locations: [] };
  }

  isAvailable(): boolean {
    return false;
  }
}
