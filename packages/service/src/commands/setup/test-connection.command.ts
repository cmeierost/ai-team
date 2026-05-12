import { z } from 'zod';
import type {
  ICommand,
  IConfigurationStorage,
  IEnvironmentStorage,
  IAgentManager,
  ILlmProviderTester,
  ITextToolCallParser,
  ExecutionContext,
  CommandResponse,
} from '@ai-team/core';
import { TestConnectionCommand as TestConnectionCommandImpl } from './test-connection.js';

type Params = z.infer<typeof TestConnectionICommand.schema>;

export class TestConnectionICommand implements ICommand<Params, void> {
  static readonly schema = z.object({
    employee: z.string().optional().describe('Resolve employee and test their effective model'),
    provider: z.string().optional().describe('Provider reference key in config.providers'),
    modelKey: z.string().optional().describe('Model key from provider models dictionary'),
    model: z.string().optional().describe('Direct model ID override'),
    all: z.boolean().optional().describe('Test all configured model keys'),
    toolCall: z.boolean().optional().describe('Verify a simple tool-call roundtrip'),
  });

  readonly key = 'testConnection';
  readonly cli = { command: 'test-connection' };
  readonly description = 'Test LLM provider/model connectivity';
  readonly availableIn = { cli: true, chat: true, tool: true };
  readonly group = 'setup';
  readonly parameters = TestConnectionICommand.schema;

  constructor(
    private readonly configStorage: IConfigurationStorage,
    private readonly envStorage: IEnvironmentStorage,
    private readonly agentManager: IAgentManager,
    private readonly llmProviderTester: ILlmProviderTester,
    private readonly textToolCallParser: ITextToolCallParser
  ) {}

  async execute(payload: Params, ctx: ExecutionContext): Promise<CommandResponse<void>> {
    const cmd = new TestConnectionCommandImpl(
      this.configStorage,
      this.envStorage,
      this.agentManager,
      this.llmProviderTester,
      this.textToolCallParser
    );
    await cmd.executeAsync(ctx.workspaceRoot, payload);
    return { status: 'ok' };
  }
}
