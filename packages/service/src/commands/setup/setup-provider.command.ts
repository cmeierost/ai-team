import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import { ProviderCommand } from './provider.js';

type ProviderSubCommand = 'configure' | 'add' | 'set';

const _providerCommandSchema = z.object({
  subCommand: z.enum(['configure', 'add', 'set']).optional(),
  fromInit: z.boolean().optional(),
  keepCurrentDefault: z.boolean().optional(),
  makeDefault: z.boolean().optional(),
  setup: z.any().optional(),
});

export const ProviderCommandMetadata = {
  key: 'provider',
  description: 'Manage LLM provider configuration (configure, add, set)',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  aliases: [
    'provider-configure',
    'provider_configure',
    'provider-add',
    'provider_add',
    'provider-set',
    'provider_set',
  ],
  parameters: _providerCommandSchema,
} satisfies ICommandDescriptor;

export class ProviderICommand implements ICommand<z.infer<typeof _providerCommandSchema>, void> {
  static readonly schema = _providerCommandSchema;
  readonly metadata = ProviderCommandMetadata;

  constructor(private readonly providerCommand: ProviderCommand) {}

  async execute(
    payload: z.infer<typeof _providerCommandSchema>,
    _ctx: ExecutionContext
  ): Promise<CommandResponse<void>> {
    const sub = (payload.subCommand as ProviderSubCommand) ?? 'configure';
    switch (sub) {
      case 'configure':
        await this.providerCommand.configureAsync({
          fromInit: payload.fromInit,
          keepCurrentDefault: payload.keepCurrentDefault,
          setup: payload.setup,
        });
        break;
      case 'add':
        await this.providerCommand.addAsync({
          makeDefault: payload.makeDefault,
          setup: payload.setup,
        });
        break;
      case 'set':
        await this.providerCommand.setAsync({
          fromInit: payload.fromInit,
          keepCurrentDefault: payload.keepCurrentDefault,
          setup: payload.setup,
        });
        break;
    }
    return { status: 'ok' };
  }
}
