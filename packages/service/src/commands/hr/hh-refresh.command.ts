import type { ICommand, CommandRuntime } from '@ai-team/core';
import { hhRefreshCommand } from './hh.js';

export class HhRefreshCommand implements ICommand<Record<string, never>, void, void> {
  readonly key = 'hhRefresh';
  readonly cli = { command: 'refresh', parentKey: 'hh' };
  readonly description = 'Pull and refresh the skill catalog from GitHub';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'hr';

  async execute(
    _payload: Record<string, never>,
    _ctx: void,
    runtime: CommandRuntime
  ): Promise<void> {
    return hhRefreshCommand(runtime.workspaceRoot);
  }
}
