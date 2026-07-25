import fs from 'node:fs/promises';
import path from 'node:path';
import type { InitOptions, InitResult } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import type { IEmitService } from '@ai-team/core';
import type { WorkflowDefinition, IWorkflowRunnerFactory } from '../../workflow/index.js';
import type { OnboardingWorkflowResult } from '../hr/onboarding-workflow.js';

export interface InitWorkflowState {
  workspaceRoot: string;
  options: InitOptions;
  signal?: AbortSignal;
  workflowState?: unknown;
  aiTeamDir: string;
  shouldSkip: boolean;
  shouldClear: boolean;
  onboarding?: OnboardingWorkflowResult;
}

interface OnboardExecutor {
  execute(
    params: { options?: Record<string, never> },
    signal?: AbortSignal
  ): Promise<OnboardingWorkflowResult>;
}

interface SetupExecutor {
  execute(
    params: { workspaceRoot: string; options?: { force?: boolean } },
    context: ExecutionContext
  ): Promise<void>;
}

interface TestConnectionExecutor {
  execute(params: { workspaceRoot: string; options?: Record<string, never> }): Promise<void>;
}

export interface InitWorkflowDependencies {
  onboard: OnboardExecutor;
  setup: SetupExecutor;
  testConnection: TestConnectionExecutor;
}

const FORCE_KEEP = new Set(['config.json', '.env']);
const INIT_RUNTIME_ARTIFACTS = new Set(['agents', 'logs', 'private', '.ide-server.json']);

async function clearAiTeamDirectory(
  workspaceRoot: string,
  emitService: IEmitService
): Promise<void> {
  const aiTeamDir = path.join(workspaceRoot, '.ai-team');
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
      emitService.log('info', `  Removed: ${entry.name}`);
    } catch (err) {
      emitService.log(
        'warn',
        `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export function createInitWorkflowDefinition(
  deps: InitWorkflowDependencies,
  emitService: IEmitService
): WorkflowDefinition<InitWorkflowState> {
  return {
    id: 'init-command',
    version: '1',
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
                emitService.log(
                  'warn',
                  hasAgentFiles
                    ? '  Force flag detected - reinitializing...'
                    : '  Force flag detected - clearing existing AI Team scaffold...'
                );
                return { ...state, shouldClear: true };
              }

              if (hasAgentFiles) {
                emitService.log('warn', 'AI Team is already initialized in this workspace');
                emitService.log('info', `  Location: ${state.aiTeamDir}`);
                emitService.log('info', '  Use --force to fully reinitialize team onboarding.');
                emitService.log('info', '  Skipping initialization.');
                return { ...state, shouldSkip: true };
              }

              if (!hasNonAgentArtifacts) {
                return state;
              }

              emitService.log(
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
        skipWhen: 'shouldClear !== true',
        execute: async (state) => {
          await clearAiTeamDirectory(state.workspaceRoot, emitService);
          return state;
        },
      },
      {
        id: 'setup-llm',
        skipWhen: 'shouldSkip === true',
        execute: async (state, ctx) => {
          await deps.setup.execute(
            { workspaceRoot: state.workspaceRoot, options: { force: state.options.force } },
            ctx
          );
          return state;
        },
      },
      {
        id: 'test-llm-connection',
        skipWhen: 'shouldSkip === true',
        execute: async (state) => {
          emitService.log('info', '');
          emitService.log('info', 'Verifying LLM connection...');
          await deps.testConnection.execute({ workspaceRoot: state.workspaceRoot, options: {} });
          return state;
        },
      },
      {
        id: 'emit-welcome',
        skipWhen: 'shouldSkip === true',
        execute: async (state) => {
          emitService.log('info', '');
          emitService.log('info', 'Welcome to AI Team!');
          emitService.log('info', "Let's set up your virtual development team.");
          return state;
        },
      },
      {
        id: 'run-onboarding',
        skipWhen: 'shouldSkip === true',
        execute: async (state) => {
          const onboarding = await deps.onboard.execute({ options: {} }, state.signal);
          return { ...state, onboarding };
        },
      },
    ],
  };
}

export async function runInitWorkflowAsync(
  workspaceRoot: string,
  options: InitOptions,
  emitService: IEmitService,
  signal: AbortSignal | undefined,
  workflowState: unknown | undefined,
  deps: InitWorkflowDependencies,
  workflowRunnerFactory: IWorkflowRunnerFactory
): Promise<InitResult> {
  const initialState: InitWorkflowState = {
    workspaceRoot,
    options,
    signal,
    workflowState,
    aiTeamDir: path.join(workspaceRoot, '.ai-team'),
    shouldSkip: false,
    shouldClear: false,
  };

  const result = await workflowRunnerFactory
    .create()
    .run(createInitWorkflowDefinition(deps, emitService), initialState, {
      signal,
      executionContext: {
        workspaceRoot,
        history: [],
      } as ExecutionContext,
    });

  if (result.aborted) {
    throw new Error(result.abortedError ?? 'Initialization workflow aborted.');
  }

  const agentId = result.state.onboarding?.ceoAgentId;
  const workflowSystemPrompt = result.state.onboarding?.businessSystemPrompt;
  const introductionText = result.state.onboarding?.businessOpeningMessage;
  return {
    ...(agentId && workflowSystemPrompt && introductionText
      ? {
          chat: {
            agentId,
            createNewSession: true as const,
            workflowMode: true as const,
            workflowSystemPrompt,
            workflowExitWords: ['done', 'clear', 'finished'],
            workflowToolAllowlist: [
              'com_ask',
              'hr_name_suggestions',
              'hr_hire_agent',
              'access_set_permissions',
              'com_handoff',
            ],
            introductionText,
            suppressAutoIntroduction: true as const,
          },
        }
      : {}),
  };
}
