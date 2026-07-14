/**
 * Onboard command — CEO + HR Director creation, business definition, team hiring.
 *
 * Requires LLM to be configured (via `setup` command first).
 * Creates the founding team, runs the business definition chat with the CEO,
 * then the team planning chat with the HR Director, and finally drops
 * into interactive CEO chat.
 */

import type {
  ICommandRegistry,
  IServiceContainer,
  ILlmService,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  ExecutionContext,
} from '@ai-team/core';
import { z } from 'zod';
import type { OnboardOptions } from '@ai-team/api-contracts';
import type { IEmitService } from '@ai-team/core';
import { COMMAND_FACTORY_TOKENS } from '../../types.js';

// ── OnboardCommand ────────────────────────────────────────────────────────────
const _onboardICommandSchema = z.object({
  options: z.any().optional(),
});

export const OnboardICommandMetadata = {
  key: 'onboard',
  description: 'Run team onboarding (CEO + HR + hiring)',
  availableIn: { cli: true, chat: true },
  group: 'hr',
  parameters: _onboardICommandSchema,
} satisfies ICommandDescriptor;

export interface OnboardCommandParams {
  options?: OnboardOptions;
}

type OnboardICommandParams = z.infer<typeof OnboardICommand.schema>;

export class OnboardICommand implements ICommand<OnboardICommandParams, void> {
  static readonly schema = _onboardICommandSchema;
  readonly metadata = OnboardICommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitService: IEmitService,
    private readonly serviceContainer?: IServiceContainer
  ) {}

  async execute(
    payload: OnboardICommandParams,
    ctxOrUnused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<void>> {
    const resolvedCtx = ctx ??
      (ctxOrUnused as ExecutionContext | undefined) ?? {
        history: [],
      };
    await this.executeOnboarding(
      {
        options: (payload.options ?? {}) as OnboardOptions,
      },
      resolvedCtx.signal,
      resolvedCtx.invocationSurface ?? 'cli'
    );
    return { status: 'ok' };
  }

  async executeOnboarding(
    _params: OnboardCommandParams = {},
    signal?: AbortSignal,
    invocationSurface: ExecutionContext['invocationSurface'] = 'cli'
  ): Promise<void> {
    if (!this.serviceContainer) {
      throw new Error('OnboardICommand requires IServiceContainer to run the onboarding workflow.');
    }

    const workspaceRoot = this.workspaceRoot;
    const emitService = this.emitService;

    const llmService = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.LlmService
    ) as ILlmService;
    await llmService.initialize();

    const registry = this.serviceContainer.resolve(
      COMMAND_FACTORY_TOKENS.CommandRegistry
    ) as ICommandRegistry;
    const workflowCommand =
      registry.resolve('onboard_workflow', this.serviceContainer) ??
      registry.resolve('hr_onboard_workflow', this.serviceContainer);
    if (!workflowCommand) {
      throw new Error("Onboarding workflow command 'onboard_workflow' is not registered.");
    }

    const commandResult = await workflowCommand.execute(
      { workspaceRoot },
      {
        signal,
        history: [],
        invocationSurface,
      }
    );

    if (commandResult && typeof commandResult === 'object' && 'status' in commandResult) {
      const status = (commandResult as { status?: string }).status;
      if (status === 'error') {
        const message =
          (commandResult as { message?: string }).message ?? 'Onboarding workflow failed.';
        throw new Error(message);
      }
    }

    emitService.log('info', '--- Onboarding Complete ---');
  }
}
