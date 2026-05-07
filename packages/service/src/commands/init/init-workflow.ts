import path from 'node:path';
import type { InitOptions, InteractionContext } from '@ai-team/api-contracts';
import type { SessionManager } from '../../session-manager.js';
import { runWorkflowAsync } from '../../workflow/runner.js';
import type { WorkflowDefinition } from '../../workflow/types.js';
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
  execute(
    params: {
      options?: { template?: string };
      injected?: { sessionManager?: SessionManager };
    },
    context?: InitRuntimeHooks
  ): Promise<void>;
}

interface SetupExecutor {
  execute(
    params: { workspaceRoot: string; options?: { force?: boolean } },
    context?: InitRuntimeHooks
  ): Promise<void>;
}

interface TestConnectionExecutor {
  execute(params: { workspaceRoot: string; options?: Record<string, never> }): Promise<void>;
}

export interface InitWorkflowDependencies {
  writeLine: (hooks: InitRuntimeHooks | undefined, message: string) => void;
  writeWarn: (hooks: InitRuntimeHooks | undefined, message: string) => void;
  clearAiTeamDirectory: (workspaceRoot: string, hooks?: InitRuntimeHooks) => Promise<void>;
  onboard: OnboardExecutor;
  setup: SetupExecutor;
  testConnection: TestConnectionExecutor;
  sessionManager?: SessionManager;
}

const INIT_RUNTIME_ARTIFACTS = new Set(['agents', 'logs', 'private', '.ide-server.json']);

export function createInitWorkflowDefinition(
  deps: InitWorkflowDependencies
): WorkflowDefinition<InitWorkflowState> {
  return {
    id: 'init-command',
    steps: [
      {
        id: 'inspect-existing',
        kind: 'action',
        execute: async (state) => {
          try {
            const fs = await import('node:fs/promises');
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
                deps.writeWarn(
                  state.hooks,
                  hasAgentFiles
                    ? '  Force flag detected - reinitializing...'
                    : '  Force flag detected - clearing existing AI Team scaffold...'
                );
                return {
                  ...state,
                  shouldClear: true,
                };
              }

              if (hasAgentFiles) {
                deps.writeWarn(state.hooks, 'AI Team is already initialized in this workspace');
                deps.writeLine(state.hooks, `  Location: ${state.aiTeamDir}`);
                deps.writeLine(state.hooks, '  Use --force to fully reinitialize team onboarding.');
                deps.writeLine(state.hooks, '  Skipping initialization.');
                return {
                  ...state,
                  shouldSkip: true,
                };
              }

              if (!hasNonAgentArtifacts) {
                return state;
              }

              deps.writeWarn(
                state.hooks,
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
        kind: 'action',
        skipWhen: (state) => state.shouldSkip || !state.shouldClear,
        execute: async (state) => {
          await deps.clearAiTeamDirectory(state.workspaceRoot, state.hooks);
          return state;
        },
      },
      {
        id: 'setup-llm',
        kind: 'action',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          await deps.setup.execute(
            { workspaceRoot: state.workspaceRoot, options: { force: state.options.force } },
            state.hooks
          );
          return state;
        },
      },
      {
        id: 'test-llm-connection',
        kind: 'action',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          deps.writeLine(state.hooks, '');
          deps.writeLine(state.hooks, 'Verifying LLM connection...');
          await deps.testConnection.execute({ workspaceRoot: state.workspaceRoot, options: {} });
          return state;
        },
      },
      {
        id: 'emit-welcome',
        kind: 'action',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          deps.writeLine(state.hooks, '');
          deps.writeLine(state.hooks, 'Welcome to AI Team!');
          deps.writeLine(state.hooks, "Let's set up your virtual development team.");
          return state;
        },
      },
      {
        id: 'run-onboarding',
        kind: 'action',
        skipWhen: (state) => state.shouldSkip,
        execute: async (state) => {
          await deps.onboard.execute(
            {
              options: { template: state.options.template },
              injected: { sessionManager: deps.sessionManager },
            },
            state.hooks
          );
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
  deps: InitWorkflowDependencies
): Promise<void> {
  const initialState: InitWorkflowState = {
    workspaceRoot,
    options,
    hooks,
    aiTeamDir: path.join(workspaceRoot, '.ai-team'),
    shouldSkip: false,
    shouldClear: false,
  };

  await runWorkflowAsync(
    createInitWorkflowDefinition(deps),
    initialState,
    (hooks ?? {}) as InteractionContext
  );
}
