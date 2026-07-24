import { z } from 'zod';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { InitOptions } from '@ai-team/api-contracts';
import type {
  ICommand,
  CommandResponse,
  ICommandDescriptor,
  ExecutionContext,
} from '@ai-team/core';
import type { OnboardICommand } from '../hr/onboard.js';
import type { SetupCommand } from '../setup/setup.js';
import type { TestConnectionCommand } from '../setup/test-connection.js';
import type { IWorkflowRunnerFactory, WorkflowDefinition } from '../../workflow/index.js';
import type { IEmitService } from '@ai-team/core';

type Params = z.infer<typeof InitICommand.schema>;
const _initICommandSchema = z.object({
  options: z.any().optional(),
});

export const InitICommandMetadata = {
  key: 'init',
  description: 'Initialize AI Team in current workspace',
  availableIn: { cli: true, chat: true },
  group: 'setup',
  path: ['init'],
  parameters: _initICommandSchema,
} satisfies ICommandDescriptor;

interface InitWorkflowState {
  workspaceRoot: string;
  options: InitOptions;
  signal?: AbortSignal;
  workflowState?: unknown;
  aiTeamDir: string;
  shouldSkip: boolean;
  shouldClear: boolean;
}

const FORCE_KEEP = new Set(['config.json', '.env']);
const INIT_RUNTIME_ARTIFACTS = new Set(['agents', 'logs', 'private', '.ide-server.json']);

export class InitICommand implements ICommand<Params, void> {
  static readonly schema = _initICommandSchema;
  readonly metadata = InitICommandMetadata;

  constructor(
    private readonly workspaceRoot: string,
    private readonly emitService: IEmitService,
    private readonly onboard: Pick<OnboardICommand, 'executeOnboarding'>,
    private readonly setup: SetupCommand,
    private readonly testConnection: TestConnectionCommand,
    private readonly workflowRunnerFactory: IWorkflowRunnerFactory
  ) {}

  async execute(
    payload: Params,
    _ctxOrUnused?: unknown,
    ctx?: any
  ): Promise<CommandResponse<void>> {
    const resolvedCtx = (ctx ?? _ctxOrUnused) as unknown as any;
    const options = (payload.options ?? {}) as InitOptions;

    const initialState: InitWorkflowState = {
      workspaceRoot: this.workspaceRoot,
      options,
      signal: resolvedCtx?.signal,
      workflowState: resolvedCtx?.workflowState,
      aiTeamDir: path.join(this.workspaceRoot, '.ai-team'),
      shouldSkip: false,
      shouldClear: false,
    };

    const result = await this.workflowRunnerFactory
      .create()
      .run(this.createWorkflowDefinition(), initialState, {
        signal: resolvedCtx?.signal,
        executionContext: {
          workspaceRoot: this.workspaceRoot,
          history: [],
        } as ExecutionContext,
      });

    if (result.aborted) {
      return {
        status: 'error',
        message: result.abortedError ?? 'Initialization workflow aborted.',
      };
    }

    return { status: 'ok' };
  }

  private async clearAiTeamDirectory(): Promise<void> {
    const aiTeamDir = path.join(this.workspaceRoot, '.ai-team');
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(aiTeamDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (FORCE_KEEP.has(entry.name)) continue;
      const target = path.join(aiTeamDir, entry.name);
      try {
        await fs.rm(target, { recursive: true, force: true });
        this.emitService.log('info', `  Removed: ${entry.name}`);
      } catch (err) {
        this.emitService.log(
          'warn',
          `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  private createWorkflowDefinition(): WorkflowDefinition<InitWorkflowState> {
    return {
      id: 'init-command',
      description: 'Initialize workspace with bootstrap files and onboarding',
      availableIn: { tool: true },
      steps: [
        {
          id: 'inspect-existing',
          execute: async (state, _ctx) => {
            try {
              const stats = await fs.stat(state.aiTeamDir);
              if (stats.isDirectory()) {
                const agentsDir = path.join(state.aiTeamDir, 'agents');
                let hasAgentFiles = false;
                let hasNonAgentArtifacts = false;

                try {
                  const rootEntries = await fs.readdir(state.aiTeamDir, { withFileTypes: true });
                  hasNonAgentArtifacts = rootEntries.some(
                    (entry) => !INIT_RUNTIME_ARTIFACTS.has(entry.name)
                  );
                } catch {
                  hasNonAgentArtifacts = false;
                }

                try {
                  const entries = await fs.readdir(agentsDir);
                  hasAgentFiles = entries.some((entry) => entry.endsWith('.agent.md'));
                } catch {
                  hasAgentFiles = false;
                }

                if (state.options.force) {
                  this.emitService.log(
                    'warn',
                    hasAgentFiles
                      ? '  Force flag detected - reinitializing...'
                      : '  Force flag detected - clearing existing AI Team scaffold...'
                  );
                  return { ...state, shouldClear: true };
                }

                if (hasAgentFiles) {
                  this.emitService.log('warn', 'AI Team is already initialized in this workspace');
                  this.emitService.log('info', `  Location: ${state.aiTeamDir}`);
                  this.emitService.log(
                    'info',
                    '  Use --force to fully reinitialize team onboarding.'
                  );
                  this.emitService.log('info', '  Skipping initialization.');
                  return { ...state, shouldSkip: true };
                }

                if (!hasNonAgentArtifacts) {
                  return state;
                }

                this.emitService.log(
                  'warn',
                  `Found existing .ai-team scaffold without agents at ${state.aiTeamDir}; continuing initialization.`
                );
              }
            } catch {
              // Missing .ai-team directory is expected on first init.
            }

            return state;
          },
        },
        {
          id: 'clear-existing',
          skipWhen: 'shouldSkip === true || shouldClear !== true',
          execute: async (state) => {
            await this.clearAiTeamDirectory();
            return state;
          },
        },
        {
          id: 'setup-llm',
          skipWhen: 'shouldSkip === true',
          execute: async (state) => {
            await this.setup.execute({
              workspaceRoot: state.workspaceRoot,
              options: { force: state.options.force },
            });
            return state;
          },
        },
        {
          id: 'test-llm-connection',
          skipWhen: 'shouldSkip === true',
          execute: async (state) => {
            this.emitService.log('info', '');
            this.emitService.log('info', 'Verifying LLM connection...');
            await this.testConnection.execute({ workspaceRoot: state.workspaceRoot, options: {} });
            return state;
          },
        },
        {
          id: 'emit-welcome',
          skipWhen: 'shouldSkip === true',
          execute: async (state) => {
            this.emitService.log('info', '');
            this.emitService.log('info', 'Welcome to AI Team!');
            this.emitService.log('info', "Let's set up your virtual development team.");
            return state;
          },
        },
        {
          id: 'run-onboarding',
          skipWhen: 'shouldSkip === true',
          execute: async (state) => {
            await this.onboard.executeOnboarding({ options: {} }, state.signal);
            return state;
          },
        },
      ],
    };
  }
}
