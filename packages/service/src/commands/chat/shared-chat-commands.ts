import type { ICommand } from '@ai-team/core';
import { emitLog } from '../../orchestrator/stream-events.js';
import type { OrchestratorContext } from '../../orchestrator/pipeline-context.js';

export type ChatSlashCommand = ICommand<string, OrchestratorContext, void>;

export function write(ctx: OrchestratorContext, msg: string): void {
  emitLog(ctx.hooks, 'info', msg);
}
