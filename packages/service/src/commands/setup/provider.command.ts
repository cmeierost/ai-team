import { z } from 'zod';
import type {
  ICommand,
  IConfigurationStorage,
  IEnvironmentStorage,
  ILlmProviderTester,
  IModelDiscoveryRegistry,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import type { IQuestionService } from '../../questions/question-service.js';
import { ProviderCommand } from './provider.js';

type ConfigureParams = z.infer<typeof ProviderConfigureICommand.schema>;
type AddParams = z.infer<typeof ProviderAddICommand.schema>;
type SetParams = z.infer<typeof ProviderSetICommand.schema>;

export class ProviderConfigureICommand implements ICommand<ConfigureParams, void> {
  static readonly schema = z.object({
    fromInit: z.boolean().optional(),
    keepCurrentDefault: z.boolean().optional(),
    setup: z.any().optional(),
  });

  readonly key = 'providerConfigure';
  readonly cli = { command: 'configure', parentKey: 'provider' };
  readonly description = 'Configure default LLM provider';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderConfigureICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IQuestionService
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

export class ProviderAddICommand implements ICommand<AddParams, void> {
  static readonly schema = z.object({
    makeDefault: z.boolean().optional(),
    setup: z.any().optional(),
  });

  readonly key = 'providerAdd';
  readonly cli = { command: 'add', parentKey: 'provider' };
  readonly description = 'Add a provider profile';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderAddICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IQuestionService
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

export class ProviderSetICommand implements ICommand<SetParams, void> {
  static readonly schema = z.object({
    fromInit: z.boolean().optional(),
    keepCurrentDefault: z.boolean().optional(),
    setup: z.any().optional(),
  });

  readonly key = 'providerSet';
  readonly cli = { command: 'set', parentKey: 'provider' };
  readonly description = 'Configure default LLM provider';
  readonly availableIn = { cli: true, chat: true };
  readonly group = 'setup';
  readonly parameters = ProviderSetICommand.schema;

  constructor(
    private readonly configurationStorage: IConfigurationStorage,
    private readonly environmentStorage: IEnvironmentStorage,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly modelDiscoveryRegistry: IModelDiscoveryRegistry,
    private readonly questionService: IQuestionService
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
