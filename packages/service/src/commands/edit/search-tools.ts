import { z } from 'zod';
import type {
  ICommand,
  ExecutionContext,
  CommandResponse,
  LspDiagnostic,
  IIdeAdapterFactory,
  LspProvider,
  ICommandDescriptor,
} from '@ai-team/core';
import { collectPostWriteDiagnostics } from '../../tooling/catalog/diagnostics-helper.js';

// ─── GetErrors ────────────────────────────────────────────────────────────────
export const GetErrorsToolMetadata = {
  key: 'get_errors',
  group: 'tool',
  availableIn: { tool: true },
  description:
    'Collect LSP diagnostics (type errors, linting issues) for one or more files. ' +
    'Returns an empty list when no LSP provider is connected.',
  parameters: z.object({
    filePaths: z.array(z.string()).min(1).describe('Relative or absolute file paths to check'),
    delayMs: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe('Milliseconds to wait before collecting diagnostics (default 500)'),
  }),
} satisfies ICommandDescriptor;

export interface GetErrorsParams {
  filePaths: string[];
  delayMs?: number;
}

export interface GetErrorsResult {
  filePaths: string[];
  diagnostics: LspDiagnostic[];
  available: boolean;
}

export class GetErrorsTool implements ICommand<GetErrorsParams, GetErrorsResult> {
  readonly metadata = GetErrorsToolMetadata;
  readonly name = 'get_errors';

  constructor(
    private readonly workspaceRoot: string,
    private readonly ideAdapterFactory: IIdeAdapterFactory
  ) {}

  private async resolveLsp(context: ExecutionContext): Promise<LspProvider> {
    const channel = context.invocationSurface === 'cli' ? 'cli' : 'web';
    const adapter = await this.ideAdapterFactory.createAsync(this.workspaceRoot, channel);
    return adapter.lsp;
  }

  async execute(
    params: GetErrorsParams,
    context: ExecutionContext
  ): Promise<CommandResponse<GetErrorsResult>> {
    const { filePaths, delayMs } = params;
    const lsp = await this.resolveLsp(context);
    const diagnostics = (await collectPostWriteDiagnostics(lsp, filePaths, delayMs)) ?? [];
    return {
      status: 'ok',
      data: { filePaths, diagnostics, available: diagnostics.length > 0 },
    };
  }
}
