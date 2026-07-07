/**
 * CLI-routing wrapper for the unified provider command.
 * Receives ProviderCommand via constructor and delegates to it.
 */
import type { ExecutionContext, CommandResponse } from '@ai-team/core';
import { ProviderCommandMetadata } from './setup-provider.command.js';
import { ProviderCommand } from './provider.js';

export class ProviderICommand {
  readonly key = 'provider';
  readonly cli = { command: 'provider', parentKey: undefined } as const;
  readonly metadata = ProviderCommandMetadata;

  constructor(private readonly providerCommand: ProviderCommand) {}

  async execute(
    payload: Record<string, unknown>,
    _unused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    const sub = (payload.subCommand as string) ?? 'configure';
    switch (sub) {
      case 'configure':
        await this.providerCommand.configureAsync(payload as any);
        break;
      case 'add':
        await this.providerCommand.addAsync(payload as any);
        break;
      case 'set':
        await this.providerCommand.setAsync(payload as any);
        break;
    }
    return { status: 'ok' };
  }
}
