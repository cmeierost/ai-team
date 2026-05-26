import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { hhRefreshCommand } from './hh.js';
export const HhRefreshCommandMetadata = {
  key: 'refresh',
  description: 'Pull and refresh the skill catalog from GitHub',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'hr',
} satisfies ICommandDescriptor;

export class HhRefreshCommand implements ICommand<Record<string, never>, void> {
  readonly metadata = HhRefreshCommandMetadata;

  async execute(
    _payload: Record<string, never>,
    ctx: ExecutionContext
  ): Promise<CommandResponse<void>> {
    await hhRefreshCommand(ctx.workspaceRoot);
    return { status: 'ok' };
  }
}
