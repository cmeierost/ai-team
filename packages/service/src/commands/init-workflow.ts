import path from 'node:path';
import type { InitOptions, InteractionContext } from '@ai-team/api-client';
import { runWorkflowAsync } from '../workflow/runner.js';
import type { WorkflowDefinition } from '../workflow/types.js';
import type { InitRuntimeHooks } from './init/workflow-questions.js';

export interface InitWorkflowState {
  workspaceRoot: string;
  options: InitOptions;
  hooks?: InitRuntimeHooks;
  aiTeamDir: string;
  shouldSkip: boolean;
  shouldClear: boolean;
}

export interface InitWorkflowDependencies {
  writeLine: (hooks: InitRuntimeHooks | undefined, message: string) => void;
  writeWarn: (hooks: InitRuntimeHooks | undefined, message: string) => void;
  clearAiTeamDirectory: (workspaceRoot: string, hooks?: InitRuntimeHooks) => Promise<void>;
}

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
              deps.writeWarn(state.hooks, 'AI Team is already initialized in this workspace');
              deps.writeLine(state.hooks, `  Location: ${state.aiTeamDir}`);
              deps.writeLine(state.hooks, '  Use --force to fully reinitialize team onboarding.');

              if (!state.options.force) {
                deps.writeLine(state.hooks, '  Skipping initialization.');
                return {
                  ...state,
                  shouldSkip: true,
                };
              }

              deps.writeWarn(state.hooks, '  Force flag detected - reinitializing...');
              return {
                ...state,
                shouldClear: true,
              };
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
          const { setupCommand } = await import('./setup.js');
          await setupCommand(state.workspaceRoot, { force: state.options.force }, state.hooks);
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
          const { onboardCommand } = await import('./onboard.js');
          await onboardCommand(
            state.workspaceRoot,
            { template: state.options.template },
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
