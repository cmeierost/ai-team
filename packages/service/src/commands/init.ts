import fs from 'node:fs/promises';
import path from 'node:path';
import type { InitOptions } from '@ai-team/api-contracts';
import type { SessionManager } from '../session-manager.js';
import type { InitRuntimeHooks } from './init/workflow-questions.js';
import { runInitWorkflowAsync } from './init-workflow.js';
import type { OnboardCommand } from './onboard.js';
import type { SetupCommand } from './setup.js';
import type { TestConnectionCommand } from './test-connection.js';
import type { CommandExecute } from './command-contract.js';

function writeLine(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'info', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

function writeWarn(hooks: InitRuntimeHooks | undefined, message: string) {
  hooks?.emit?.({ kind: 'log', level: 'warn', message });
  if (!hooks?.emit) process.stdout.write(`${message}\n`);
}

const FORCE_KEEP = new Set(['config.json', '.env']);

async function clearAiTeamDirectory(workspaceRoot: string, hooks?: InitRuntimeHooks) {
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
      writeLine(hooks, `  Removed: ${entry.name}`);
    } catch (err) {
      writeWarn(
        hooks,
        `  Could not remove ${entry.name}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}

export interface InitCommandParams {
  workspaceRoot: string;
  options: InitOptions;
  injected?: { sessionManager?: SessionManager };
}

export class InitCommand implements CommandExecute<
  InitCommandParams,
  InitRuntimeHooks | undefined,
  void
> {
  constructor(
    private readonly onboard: OnboardCommand,
    private readonly setup: SetupCommand,
    private readonly testConnection: TestConnectionCommand
  ) {}

  async execute(params: InitCommandParams, hooks?: InitRuntimeHooks): Promise<void> {
    const { workspaceRoot, options, injected } = params;

    await runInitWorkflowAsync(workspaceRoot, options, hooks, {
      writeLine,
      writeWarn,
      clearAiTeamDirectory,
      onboard: this.onboard,
      setup: this.setup,
      testConnection: this.testConnection,
      sessionManager: injected?.sessionManager,
    });
  }
}
