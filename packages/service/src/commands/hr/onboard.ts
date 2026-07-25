/**
 * Onboard command — bootstrap the workspace, create the founding CEO, and
 * run the business-definition workflow phase.
 *
 * The command returns onboarding outputs for the next workflow phase.
 */

import type {
  ICommandRegistry,
  IServiceContainer,
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  ExecutionContext,
  IEmitService,
} from '@ai-team/core';
import { z } from 'zod';
import type { OnboardOptions } from '@ai-team/api-contracts';
import { CORE_SERVICE_TOKENS } from '../../types.js';
import type { OnboardingWorkflowResult } from './onboarding-workflow.js';

// ── OnboardCommand ────────────────────────────────────────────────────────────
const _onboardICommandSchema = z.object({
  options: z.any().optional(),
});

export const OnboardICommandMetadata = {
  key: 'onboard',
  description: 'Bootstrap the workspace and create its founding CEO',
  availableIn: { cli: true, chat: true },
  group: 'hr',
  parameters: _onboardICommandSchema,
} satisfies ICommandDescriptor;

export interface OnboardCommandParams {
  options?: OnboardOptions;
}

type OnboardICommandParams = z.infer<typeof OnboardICommand.schema>;

export class OnboardICommand implements ICommand<OnboardICommandParams, OnboardingWorkflowResult> {
  static readonly schema = _onboardICommandSchema;
  readonly metadata = OnboardICommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitService: IEmitService,
    private readonly serviceContainer: IServiceContainer
  ) {}

  async execute(
    payload: OnboardICommandParams,
    ctxOrUnused?: unknown,
    ctx?: ExecutionContext
  ): Promise<CommandResponse<OnboardingWorkflowResult>> {
    const resolvedCtx = ctx ??
      (ctxOrUnused as ExecutionContext | undefined) ?? {
        history: [],
      };
    const data = await this.executeOnboarding(
      {
        options: (payload.options ?? {}) as OnboardOptions,
      },
      resolvedCtx.signal,
      resolvedCtx.invocationSurface ?? 'cli',
      resolvedCtx
    );
    return { status: 'ok', data };
  }

  async executeOnboarding(
    _params: OnboardCommandParams = {},
    signal?: AbortSignal,
    invocationSurface: ExecutionContext['invocationSurface'] = 'cli',
    executionContext?: ExecutionContext
  ): Promise<OnboardingWorkflowResult> {
    if (!this.serviceContainer) {
      throw new Error('OnboardICommand requires IServiceContainer to run the onboarding workflow.');
    }

    const workspaceRoot = this.workspaceRoot;
    const emitService = this.emitService;

    const llmService = this.serviceContainer.resolve(CORE_SERVICE_TOKENS.LlmService);
    await llmService.initialize();

    const registry = this.serviceContainer.resolve(
      CORE_SERVICE_TOKENS.CommandRegistry
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
        history: executionContext?.history ?? [],
        ...(executionContext?.sessionId ? { sessionId: executionContext.sessionId } : {}),
        ...(executionContext?.agentId ? { agentId: executionContext.agentId } : {}),
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

    const data = (commandResult as { data?: OnboardingWorkflowResult } | undefined)?.data;
    if (!data?.ceoAgentId) {
      throw new Error('Onboarding completed without creating a CEO agent.');
    }

    emitService.log('info', `CEO ${data.ceoName ?? data.ceoAgentId} is ready.`);
    return data;
  }
}
