import { z } from 'zod';
import type {
  ICommand,
  IConfigurationStorage,
  IEnvironmentStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  ExecutionContext,
  CommandResponse,
  ICommandDescriptor,
} from '@ai-team/core';
import type { IInteractionService } from '../../questions/question-service.js';
import { ProviderCommand } from './provider.js';

type ConfigureParams = z.infer<typeof ProviderConfigureICommand.schema>;
type AddParams = z.infer<typeof ProviderAddICommand.schema>;
type SetParams = z.infer<typeof ProviderSetICommand.schema>;
const _providerConfigureICommandSchema = z.object({
  fromInit: z.boolean().optional(),
  keepCurrentDefault: z.boolean().optional(),
  setup: z.any().optional(),
});

export const ProviderConfigureICommandMetadata = {
  key: 'providerConfigure',
  cli: { command: 'configure', parentKey: 'provider' },
  description: 'Configure default LLM provider',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerConfigureICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderConfigureICommand implements ICommand<ConfigureParams, void> {
  static readonly schema = _providerConfigureICommandSchema;
  readonly metadata = ProviderConfigureICommandMetadata;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IInteractionService
  ) {}

  async execute(payload: ConfigureParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ProviderCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.llmProviderTester,
      this.modelDiscoveryRegistry
    );
    await cmd.configureAsync(ctx.workspaceRoot, payload, this.questionService, ctx);
    return { status: 'ok' };
  }
}
const _providerAddICommandSchema = z.object({
  makeDefault: z.boolean().optional(),
  setup: z.any().optional(),
});

export const ProviderAddICommandMetadata = {
  key: 'providerAdd',
  cli: { command: 'add', parentKey: 'provider' },
  description: 'Add a provider profile',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerAddICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderAddICommand implements ICommand<AddParams, void> {
  static readonly schema = _providerAddICommandSchema;
  readonly metadata = ProviderAddICommandMetadata;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IInteractionService
  ) {}

  async execute(payload: AddParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ProviderCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.llmProviderTester,
      this.modelDiscoveryRegistry
    );
    await cmd.addAsync(ctx.workspaceRoot, payload, this.questionService, ctx);
    return { status: 'ok' };
  }
}
const _providerSetICommandSchema = z.object({
  fromInit: z.boolean().optional(),
  keepCurrentDefault: z.boolean().optional(),
  setup: z.any().optional(),
});

export const ProviderSetICommandMetadata = {
  key: 'providerSet',
  cli: { command: 'set', parentKey: 'provider' },
  description: 'Configure default LLM provider',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  parameters: _providerSetICommandSchema,
} satisfies ICommandDescriptor;

export class ProviderSetICommand implements ICommand<SetParams, void> {
  static readonly schema = _providerSetICommandSchema;
  readonly metadata = ProviderSetICommandMetadata;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IInteractionService
  ) {}

  async execute(payload: SetParams, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new ProviderCommand(
      this.configurationStorage,
      this.environmentStorage,
      this.llmProviderTester,
      this.modelDiscoveryRegistry
    );
    await cmd.setAsync(ctx.workspaceRoot, payload, this.questionService, ctx);
    return { status: 'ok' };
  }
}
