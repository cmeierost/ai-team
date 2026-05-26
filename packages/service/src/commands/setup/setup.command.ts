import { z } from 'zod';
import type { SetupOptions } from '@ai-team/api-contracts';
import type { ICommand, CommandResponse, ICommandDescriptor } from '@ai-team/core';
import type { SetupCommand } from './setup.js';

type Params = z.infer<typeof SetupICommand.schema>;
const _setupICommandSchema = z.object({
  options: z.any().optional(),
});

export const SetupICommandMetadata = {
  key: 'setup',
  description: 'Configure LLM provider connection',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _setupICommandSchema,
} satisfies ICommandDescriptor;

export class SetupICommand implements ICommand<Params, void> {
  static readonly schema = _setupICommandSchema;
  readonly metadata = SetupICommandMetadata;

  constructor(private readonly setupCommand: Pick<SetupCommand, 'execute'>) {}

  async execute(
    payload: Params,
    _unusedOrCtx?: unknown,
    ctx?: any
  ): Promise<CommandResponse<void>> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resolvedCtx = (ctx ?? _unusedOrCtx) as unknown as any;
    await this.setupCommand.execute(
      {
        workspaceRoot: resolvedCtx?.workspaceRoot ?? '',
        options: (payload.options ?? {}) as SetupOptions,
      },
      resolvedCtx
    );
    return { status: 'ok' };
  }
}
