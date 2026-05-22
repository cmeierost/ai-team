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
  ICommandDescriptor,
} from '@ai-team/core';
import { TestConnectionCommand as TestConnectionCommandImpl } from './test-connection.js';

type Params = z.infer<typeof TestConnectionICommand.schema>;
const _testConnectionICommandSchema = z.object({
  employee: z.string().optional().describe('Resolve employee and test their effective model'),
  provider: z.string().optional().describe('Provider reference key in config.providers'),
  modelKey: z.string().optional().describe('Model key from provider models dictionary'),
  model: z.string().optional().describe('Direct model ID override'),
  all: z.boolean().optional().describe('Test all configured model keys'),
  toolCall: z.boolean().optional().describe('Verify a simple tool-call roundtrip'),
});

export const TestConnectionICommandMetadata = {
  key: 'testConnection',
  cli: { command: 'test-connection' },
  description: 'Test LLM provider/model connectivity',
  availableIn: { cli: true, chat: true, tool: true },
  group: 'setup',
  parameters: _testConnectionICommandSchema,
} satisfies ICommandDescriptor;

export class TestConnectionICommand implements ICommand<Params, void> {
  static readonly schema = _testConnectionICommandSchema;
  readonly metadata = TestConnectionICommandMetadata;

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
