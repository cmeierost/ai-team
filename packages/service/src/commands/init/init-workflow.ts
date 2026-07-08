import fs from 'node:fs/promises';
import path from 'node:path';
import type { InitOptions } from '@ai-team/api-contracts';
import type { ExecutionContext } from '@ai-team/core';
import type { IEmitService } from '@ai-team/core';
import { EmitService } from '../../orchestrator/services/emit-service.js';
import type { WorkflowDefinition } from '../../workflow/types.js';
import type { IWorkflowRunnerFactory } from '../../workflow/runner.js';
import type { InitRuntimeHooks } from './workflow-questions.js';

export interface InitWorkflowState {
  workspaceRoot: string;
  options: InitOptions;
  hooks?: InitRuntimeHooks;
  aiTeamDir: string;
  shouldSkip: boolean;
  shouldClear: boolean;
}

interface OnboardExecutor {
  execute(params: { options?: Record<string, never> }, signal?: AbortSignal): Promise<void>;
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
    description: 'Initialize the ai-team workspace configuration',
    availableIn: {},
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
        skipWhen: (state) => state.shouldSkip || !state.shouldClear,
        execute: async (state) => {
          await clearAiTeamDirectory(state.workspaceRoot, emitService);
          return state;
        },
      },
      {
        id: 'setup-llm',
        skipWhen: (state) => state.shouldSkip,
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
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          emitService.log('info', '');
          emitService.log('info', 'Verifying LLM connection...');
          await deps.testConnection.execute({ workspaceRoot: state.workspaceRoot, options: {} });
          return state;
        },
      },
      {
        id: 'emit-welcome',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          emitService.log('info', '');
          emitService.log('info', 'Welcome to AI Team!');
          emitService.log('info', "Let's set up your virtual development team.");
          return state;
        },
      },
      {
        id: 'run-onboarding',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          await deps.onboard.execute({ options: {} }, state.hooks?.signal);
          return state;
        },
      },
    ],
  };
}

export async function runInitWorkflowAsync(
  workspaceRoot: string,
  options: InitOptions,
  hooks: InitRuntimeHooks | undefined,
  deps: InitWorkflowDependencies,
  runnerFactory: IWorkflowRunnerFactory
): Promise<void> {
  const initialState: InitWorkflowState = {
    workspaceRoot,
    options,
    hooks,
    aiTeamDir: path.join(workspaceRoot, '.ai-team'),
    shouldSkip: false,
    shouldClear: false,
  };
  const emitService = hooks?.emitService ?? EmitService.forConsole();

  await runnerFactory.create().run(createInitWorkflowDefinition(deps, emitService), initialState, {
    signal: hooks?.signal,
    executionContext: {
      workspaceRoot,
      history: [],
    } as ExecutionContext,
  });
}
